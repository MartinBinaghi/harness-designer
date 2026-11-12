mod base_library;
#[cfg(test)]
mod bundled;
mod calc;
mod checks;
mod contacts;
mod db;
#[cfg(test)]
mod demo;
mod gauge;
mod model;
mod recovery;
mod revisions;
mod settings;
mod state;
mod topology;
mod undo;

use serde::Serialize;
use tauri::{AppHandle, State};

use model::{library::Library, project::ProjectData};
use state::{AppState, CalcResults, HistoryStatus, ProjectStatus};
use undo::History;

/// Biblioteca abierta y su archivo (donde se autoguarda).
#[derive(Serialize)]
struct OpenedLibrary {
    library: Library,
    path: String,
    /// Aviso para mostrar (ej. la biblioteca recordada no se pudo abrir).
    notice: Option<String>,
}

/// Abre un archivo de biblioteca y la deja como la actual (autoguardado ahí).
/// Con `remember`, además queda como la que se abre al iniciar el programa.
fn use_library_file(
    app: &AppHandle,
    state: &AppState,
    path: &str,
    remember: bool,
) -> Result<Library, String> {
    let conn = db::open_library(path)?;
    let library = model::library::load(&conn).map_err(|e| e.to_string())?;
    // Fotos de conectores borrados en una sesión anterior (en la sesión se
    // guardan, por si se deshace el borrado). Si no se pueden limpiar, se
    // limpian la próxima vez: no impide abrir.
    let _ = model::library::remove_orphan_images(&conn);
    *state.library.lock().unwrap() = History::new(library.clone());
    *state.library_path.lock().unwrap() = Some(path.to_string());
    *state.library_in_sync.lock().unwrap() = true;
    if remember {
        remember_library(app, path);
    }
    Ok(library)
}

/// Solo afecta qué se abre la próxima vez: si no se puede escribir la
/// configuración, se sigue trabajando igual.
fn remember_library(app: &AppHandle, path: &str) {
    let _ = settings::save(
        app,
        &settings::Settings {
            library_path: Some(path.to_string()),
        },
    );
}

/// Al abrir el programa: la última biblioteca usada o, la primera vez, la que
/// trae el instalador. Si la recordada no se puede abrir (ej. un pendrive que
/// no está), se abre la de fábrica sin olvidar la recordada.
#[tauri::command]
fn startup_library(app: AppHandle, state: State<AppState>) -> Result<OpenedLibrary, String> {
    // Ya hay una abierta (la ventana se recargó, o el arranque se pidió dos
    // veces): se devuelve esa, que es la de verdad, sin volver a abrir nada.
    if let Some(path) = state.library_path.lock().unwrap().clone() {
        let library = state.library.lock().unwrap().get().clone();
        return Ok(OpenedLibrary {
            library,
            path,
            notice: None,
        });
    }
    let mut notice = None;
    if let Some(path) = settings::load(&app).library_path {
        match use_library_file(&app, &state, &path, true) {
            Ok(library) => {
                return Ok(OpenedLibrary {
                    library,
                    path,
                    notice,
                })
            }
            Err(e) => {
                notice = Some(format!(
                    "Couldn't open the last library ({path}): {e}. Opened the default one for now."
                ))
            }
        }
    }
    let path = settings::default_library_path(&app)?;
    let library = use_library_file(&app, &state, &path, notice.is_none())?;
    Ok(OpenedLibrary {
        library,
        path,
        notice,
    })
}

#[tauri::command]
fn open_library(path: String, app: AppHandle, state: State<AppState>) -> Result<Library, String> {
    use_library_file(&app, &state, &path, true)
}

/// "Guardar como": copia la biblioteca (con sus fotos) a otro archivo, que pasa
/// a ser el actual.
#[tauri::command]
fn save_library(path: String, app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let history = state.library.lock().unwrap();
    let mut target = db::library_for_saving(&path)?;
    model::library::save(&mut target, history.get()).map_err(|e| e.to_string())?;
    let current = state.library_path.lock().unwrap().clone();
    if let Some(current) = current.filter(|c| *c != path) {
        let source = db::open_library(&current)?;
        model::library::copy_images(&source, &mut target)
            .map_err(|e| format!("The library was saved, but not its connector photos: {e}"))?;
    }
    *state.library_path.lock().unwrap() = Some(path.clone());
    *state.library_in_sync.lock().unwrap() = true;
    remember_library(&app, &path);
    Ok(())
}

/// Resultado de un cambio en la biblioteca: la biblioteca (siempre, aunque
/// no se haya podido guardar) y, si el autoguardado falló, por qué.
#[derive(Serialize)]
struct LibraryChange {
    library: Library,
    save_error: Option<String>,
}

/// Autoguardado: cada cambio de la biblioteca va derecho a su archivo, y solo
/// lo que cambió entre `before` y `after` (las partes tocadas). Si el archivo
/// no estaba al día (falló un guardado anterior), se escribe entero. Devuelve
/// el error para mostrar, si hubo.
fn autosave(state: &AppState, before: &Library, after: &Library) -> Option<String> {
    let path = state.library_path.lock().unwrap().clone()?;
    let mut in_sync = state.library_in_sync.lock().unwrap();
    let result = db::library_for_saving(&path).and_then(|mut conn| {
        if *in_sync {
            let changes = model::library::changes(before, after);
            model::library::save_changes(&mut conn, after, &changes)
        } else {
            model::library::save(&mut conn, after)
        }
        .map_err(|e| e.to_string())
    });
    *in_sync = result.is_ok();
    result
        .err()
        .map(|e| format!("Library changes aren't being saved to {path}: {e}"))
}

/// Deshacer/rehacer de la biblioteca: guarda el paso y devuelve el estado.
fn library_step(state: &AppState, undo: bool) -> LibraryChange {
    let mut history = state.library.lock().unwrap();
    let moved = if undo { history.undo() } else { history.redo() };
    let before = if undo {
        history.redo_target()
    } else {
        history.undo_target()
    };
    let save_error = match (moved, before) {
        (true, Some(before)) => autosave(state, before, history.get()),
        _ => None,
    };
    LibraryChange {
        library: history.get().clone(),
        save_error,
    }
}

#[tauri::command]
fn open_project(path: String, state: State<AppState>) -> Result<ProjectData, String> {
    let conn = db::open_project(&path)?;
    let project = model::project::load(&conn).map_err(|e| e.to_string())?;
    *state.project.lock().unwrap() = Some(History::new(project.clone()));
    *state.project_path.lock().unwrap() = Some(path);
    Ok(project)
}

/// El proyecto que tiene el núcleo y su archivo: si la ventana se recarga, la
/// pantalla lo recupera de acá (no se pierde lo que no se guardó).
#[derive(Serialize)]
struct CurrentProject {
    project: ProjectData,
    path: Option<String>,
}

#[tauri::command]
fn current_project(state: State<AppState>) -> Option<CurrentProject> {
    let guard = state.project.lock().unwrap();
    let project = guard.as_ref()?.get().clone();
    Some(CurrentProject {
        project,
        path: state.project_path.lock().unwrap().clone(),
    })
}

#[tauri::command]
fn save_project(path: String, app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let mut guard = state.project.lock().unwrap();
    let history = guard.as_mut().ok_or("no hay proyecto cargado")?;
    save_to(&app, &state, history, &path)
}

/// Un proyecto con referencias colgadas no se guarda (Checks lo muestra como error).
fn check_savable(project: &ProjectData) -> Result<(), String> {
    let dangling = model::project::dangling_references(project);
    if dangling.is_empty() {
        return Ok(());
    }
    let list: Vec<String> = dangling.into_iter().map(|d| d.message).collect();
    Err(format!(
        "the project has broken references (see Checks): {}",
        list.join("; ")
    ))
}

/// Guarda el proyecto del historial en `path`, que pasa a ser su archivo.
fn save_to(
    app: &AppHandle,
    state: &AppState,
    history: &mut History<ProjectData>,
    path: &str,
) -> Result<(), String> {
    check_savable(history.get())?;
    // Lo que había en el archivo queda como "<archivo>.bak" (una versión atrás),
    // por si se guardó algo que no se quería.
    if std::path::Path::new(path).is_file() {
        std::fs::copy(path, format!("{path}.bak"))
            .map_err(|e| format!("couldn't make the backup copy before saving: {e}"))?;
    }
    let mut conn = db::project_for_saving(path)?;
    model::project::save(&mut conn, history.get()).map_err(|e| e.to_string())?;
    // "Save as" a otro archivo: las revisiones congeladas viajan con el arnés.
    let previous = state.project_path.lock().unwrap().clone();
    if previous.as_deref() != Some(path) {
        let source = match previous.filter(|p| std::path::Path::new(p).is_file()) {
            Some(p) => Some(db::open_project(&p)?),
            None => None,
        };
        revisions::replace_all(source.as_ref(), &mut conn)
            .map_err(|e| format!("the harness was written, but not its revisions: {e}"))?;
    }
    history.mark_saved();
    *state.project_path.lock().unwrap() = Some(path.to_string());
    recovery::discard(app);
    Ok(())
}

/// Archivo del proyecto abierto, para las revisiones (viven adentro).
fn revisions_file(state: &AppState) -> Result<String, String> {
    state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .filter(|p| std::path::Path::new(p).is_file())
        .ok_or_else(|| {
            "Save the harness to a file first: its revisions are kept inside it.".to_string()
        })
}

/// Las revisiones congeladas del archivo abierto (ninguna si todavía no tiene archivo).
#[tauri::command]
fn list_revisions(state: State<AppState>) -> Result<Vec<revisions::RevisionInfo>, String> {
    match revisions_file(&state) {
        Ok(path) => revisions::list(&db::open_project(&path)?),
        Err(_) => Ok(Vec::new()),
    }
}

/// Congela el arnés como la revisión `label`: su campo "revisión" pasa a ese
/// nombre, se guarda (si tenía cambios, también) y la copia queda en el archivo.
/// Devuelve el proyecto (cambió su revisión).
#[tauri::command]
fn freeze_revision(
    label: String,
    notes: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<ProjectData, String> {
    let label = label.trim().to_string();
    if label.is_empty() {
        return Err("the revision needs a name (A, B, 2…)".into());
    }
    let path = revisions_file(&state)?;
    if revisions::label_taken(&db::open_project(&path)?, &label)? {
        return Err(format!("there's already a revision {label} in this file"));
    }
    let mut guard = state.project.lock().unwrap();
    let history = guard.as_mut().ok_or("no hay proyecto cargado")?;
    // Antes de tocar el proyecto: si no se puede guardar, no queda el cambio de revisión a medias.
    check_savable(history.get())?;
    if history.get().project.revision.as_deref() != Some(label.as_str()) {
        let mut next = history.get().clone();
        next.project.revision = Some(label.clone());
        history.edit(next);
    }
    save_to(&app, &state, history, &path)?;
    revisions::freeze(&db::open_project(&path)?, &label, &notes, history.get())?;
    Ok(history.get().clone())
}

/// El arnés tal como quedó en una revisión (para comparar).
#[tauri::command]
fn revision_project(id: i64, state: State<AppState>) -> Result<ProjectData, String> {
    revisions::load(&db::open_project(&revisions_file(&state)?)?, id)
}

/// Una revisión como archivo de proyecto suelto (para mandarla).
#[tauri::command]
fn export_revision(id: i64, path: String, state: State<AppState>) -> Result<(), String> {
    let file = revisions_file(&state)?;
    if std::path::Path::new(&path) == std::path::Path::new(&file) {
        return Err("choose another file: that one is the open harness".into());
    }
    let (_, bytes) = revisions::snapshot(&db::open_project(&file)?, id)?;
    std::fs::write(&path, bytes).map_err(|e| format!("Couldn't write {path}: {e}"))
}

#[tauri::command]
fn delete_revision(id: i64, state: State<AppState>) -> Result<(), String> {
    revisions::delete(&db::open_project(&revisions_file(&state)?)?, id)
}

/// Otro arnés, solo para comparar: el archivo no se toca (ni se migra).
#[tauri::command]
fn read_other_project(path: String) -> Result<ProjectData, String> {
    model::project::load(&db::read_project_file(&path)?).map_err(|e| e.to_string())
}

/// Lo que dejó sin guardar una sesión que terminó de golpe (ver `recovery.rs`).
#[derive(Serialize)]
struct PendingRecovery {
    name: String,
    path: Option<String>,
    saved_at_ms: u64,
}

#[tauri::command]
fn pending_recovery(app: AppHandle) -> Option<PendingRecovery> {
    recovery::pending(&app).map(|r| PendingRecovery {
        name: r.project.project.name,
        path: r.path,
        saved_at_ms: r.saved_at_ms,
    })
}

/// Abre la copia de recuperación como el proyecto actual, con cambios sin guardar
/// respecto de su archivo: deshacer vuelve a lo que está en el archivo.
#[tauri::command]
fn recover_project(app: AppHandle, state: State<AppState>) -> Result<CurrentProject, String> {
    let r = recovery::pending(&app).ok_or("there's nothing to recover")?;
    let in_file = r
        .path
        .as_deref()
        .and_then(|p| db::open_project(p).ok())
        .and_then(|conn| model::project::load(&conn).ok());
    let mut history = History::new(in_file.unwrap_or_else(ProjectData::empty));
    history.edit(r.project.clone());
    *state.project.lock().unwrap() = Some(history);
    *state.project_path.lock().unwrap() = r.path.clone();
    recovery::adopt();
    Ok(CurrentProject {
        project: r.project,
        path: r.path,
    })
}

#[tauri::command]
fn discard_recovery(app: AppHandle) {
    recovery::discard(&app);
}

#[tauri::command]
fn new_project(state: State<AppState>) -> ProjectData {
    let project = ProjectData::empty();
    *state.project.lock().unwrap() = Some(History::new(project.clone()));
    *state.project_path.lock().unwrap() = None;
    project
}

#[derive(Serialize)]
struct SampleProject {
    project: ProjectData,
    notice: Option<String>,
}

/// El arnés de ejemplo que trae el instalador, como proyecto sin guardar (el
/// original no se toca). Está hecho con la biblioteca por defecto: con otra,
/// sus partes pueden no coincidir, y se avisa.
#[tauri::command]
fn sample_project(app: AppHandle, state: State<AppState>) -> Result<SampleProject, String> {
    let path = settings::bundled(&app, "sample-project.db")?;
    let conn = db::open_bundled_project(&path.to_string_lossy())?;
    let project = model::project::load(&conn).map_err(|e| e.to_string())?;
    *state.project.lock().unwrap() = Some(History::new(project.clone()));
    *state.project_path.lock().unwrap() = None;
    let default = settings::default_library_path(&app).ok();
    let notice = (state.library_path.lock().unwrap().as_deref() != default.as_deref())
        .then(|| "The sample was made with the default library: with another library its parts may not match.".to_string());
    Ok(SampleProject { project, notice })
}

/// Una edición del proyecto (la pantalla ya la tiene: no se devuelve de vuelta).
#[tauri::command]
fn edit_project(project: ProjectData, state: State<AppState>) -> Result<(), String> {
    let mut guard = state.project.lock().unwrap();
    let history = guard.as_mut().ok_or("no hay proyecto cargado")?;
    history.edit(project);
    Ok(())
}

/// Una edición de la biblioteca, guardada sola en su archivo. Devuelve el error
/// de guardado, si hubo (la biblioteca no se devuelve: la pantalla ya la tiene).
#[tauri::command]
fn edit_library(library: Library, state: State<AppState>) -> Option<String> {
    let mut history = state.library.lock().unwrap();
    history.edit(library);
    let before = history
        .undo_target()
        .expect("una edición deja el estado anterior para deshacer");
    autosave(&state, before, history.get())
}

#[tauri::command]
fn undo_project(state: State<AppState>) -> Result<ProjectData, String> {
    let mut guard = state.project.lock().unwrap();
    let history = guard.as_mut().ok_or("no hay proyecto cargado")?;
    history.undo();
    Ok(history.get().clone())
}

#[tauri::command]
fn redo_project(state: State<AppState>) -> Result<ProjectData, String> {
    let mut guard = state.project.lock().unwrap();
    let history = guard.as_mut().ok_or("no hay proyecto cargado")?;
    history.redo();
    Ok(history.get().clone())
}

#[tauri::command]
fn undo_library(state: State<AppState>) -> LibraryChange {
    library_step(&state, true)
}

#[tauri::command]
fn redo_library(state: State<AppState>) -> LibraryChange {
    library_step(&state, false)
}

#[tauri::command]
fn project_status(state: State<AppState>) -> ProjectStatus {
    match state.project.lock().unwrap().as_ref() {
        Some(history) => ProjectStatus {
            loaded: true,
            can_undo: history.can_undo(),
            can_redo: history.can_redo(),
            unsaved: history.unsaved(),
            revision: history.revision(),
        },
        None => ProjectStatus {
            loaded: false,
            can_undo: false,
            can_redo: false,
            unsaved: false,
            revision: 0,
        },
    }
}

#[tauri::command]
fn library_status(state: State<AppState>) -> HistoryStatus {
    let history = state.library.lock().unwrap();
    HistoryStatus {
        can_undo: history.can_undo(),
        can_redo: history.can_redo(),
        revision: history.revision(),
    }
}

// Consultas y cálculos: leen el proyecto y la biblioteca del estado (la copia
// de verdad), no los reciben en cada pedido. La pantalla los vuelve a pedir
// cuando cambia la revisión (ver `ProjectStatus::revision`).

/// Lo que se hace con el proyecto abierto (error si no hay ninguno).
fn with_project<R>(state: &AppState, f: impl FnOnce(&ProjectData) -> R) -> Result<R, String> {
    let guard = state.project.lock().unwrap();
    let history = guard.as_ref().ok_or("no project open")?;
    Ok(f(history.get()))
}

#[tauri::command]
fn wire_route(wire_id: i64, state: State<AppState>) -> Result<Option<Vec<i64>>, String> {
    with_project(&state, |p| topology::wire_route(p, wire_id))
}

#[tauri::command]
fn wire_net(wire_id: i64, state: State<AppState>) -> Result<Vec<i64>, String> {
    with_project(&state, |p| topology::net_of_wire(p, wire_id))
}

/// Distancia acumulada desde un nodo a cada nodo alcanzable (mm). Las claves
/// de un HashMap<i64, _> se serializan como texto en JSON.
#[tauri::command]
fn node_distances(
    from_node_id: i64,
    state: State<AppState>,
) -> Result<std::collections::HashMap<i64, f64>, String> {
    with_project(&state, |p| topology::distances_from_node(p, from_node_id))
}

/// La biblioteca recibida + las partes de la biblioteca base que le faltan.
/// No toca AppState: el frontend lo aplica como una edición (con su undo).
#[tauri::command]
fn merge_base_library(library: Library) -> Library {
    base_library::merge_base_library(&library)
}

/// Costos y chequeos del proyecto abierto con la biblioteca abierta, de una
/// sola pasada (comparten la memoria de recorridos y diámetros). Se guardan
/// por revisión: varias pantallas pidiendo lo mismo no recalculan.
#[tauri::command]
fn calc_results(state: State<AppState>) -> Result<CalcResults, String> {
    // Orden de los candados: proyecto, biblioteca, cálculo (igual en todo el programa).
    let project = state.project.lock().unwrap();
    let project = project.as_ref().ok_or("no project open")?;
    let library = state.library.lock().unwrap();
    let key = (project.revision(), library.revision());
    let mut cached = state.calc.lock().unwrap();
    if let Some((k, results)) = cached.as_ref() {
        if *k == key {
            return Ok(results.clone());
        }
    }
    let results = calc::with_cache(|| CalcResults {
        report: calc::compute_cost_report(project.get(), library.get()),
        findings: checks::run_checks(project.get(), library.get()),
        destinations: topology::pin_destinations(project.get()),
        gauges: contacts::gauge_facts(library.get()),
    });
    *cached = Some((key, results.clone()));
    Ok(results)
}

// --- Fotos de los conectores --------------------------------------------------
// Viven en el archivo de la biblioteca, aparte de las fichas (ver library.sql):
// la pantalla pide la lista y cada foto cuando la muestra, y cargar o sacar una
// foto se escribe directo (como un adjunto: no entra en deshacer).

/// Tamaño máximo de una foto ya achicada (800 px WebP pesa ~50–150 kB): un
/// límite para que un dato roto o malicioso no infle la biblioteca.
const MAX_IMAGE_CHARS: usize = 3_000_000;

fn library_file(state: &AppState) -> Result<String, String> {
    state
        .library_path
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no library open".to_string())
}

fn check_view(view: &str) -> Result<(), String> {
    if model::library::IMAGE_VIEWS.contains(&view) {
        Ok(())
    } else {
        Err(format!("unknown connector view: {view}"))
    }
}

/// Qué fotos hay: parte -> vistas.
#[tauri::command]
fn connector_image_index(
    state: State<AppState>,
) -> Result<std::collections::BTreeMap<i64, Vec<String>>, String> {
    let conn = db::open_library(&library_file(&state)?)?;
    model::library::image_index(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn connector_image(
    part_id: i64,
    view: String,
    state: State<AppState>,
) -> Result<Option<String>, String> {
    check_view(&view)?;
    let conn = db::open_library(&library_file(&state)?)?;
    model::library::image(&conn, part_id, &view).map_err(|e| e.to_string())
}

/// Pone o saca (`data: null`) una foto. Solo imágenes en data URL (se muestran
/// en `<img src>`: nada de otros esquemas), de un conector que existe.
#[tauri::command]
fn set_connector_image(
    part_id: i64,
    view: String,
    data: Option<String>,
    state: State<AppState>,
) -> Result<(), String> {
    check_view(&view)?;
    if let Some(data) = &data {
        let is_image =
            data.starts_with("data:image/") && data[..data.len().min(64)].contains(";base64,");
        if !is_image {
            return Err("that file isn't an image".into());
        }
        if data.len() > MAX_IMAGE_CHARS {
            return Err("the image is too big".into());
        }
    }
    if !state
        .library
        .lock()
        .unwrap()
        .get()
        .connector_defs
        .iter()
        .any(|d| d.part_id == part_id)
    {
        return Err(format!(
            "part #{part_id} isn't a connector of the open library"
        ));
    }
    let conn = db::open_library(&library_file(&state)?)?;
    model::library::set_image(&conn, part_id, &view, data.as_deref()).map_err(|e| e.to_string())
}

/// Guarda un texto exportado (ej. la lista de etiquetas en CSV) en la ruta
/// que el usuario eligió en el diálogo de guardar.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Couldn't write {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            startup_library,
            current_project,
            pending_recovery,
            recover_project,
            discard_recovery,
            open_library,
            save_library,
            open_project,
            save_project,
            list_revisions,
            freeze_revision,
            revision_project,
            export_revision,
            delete_revision,
            read_other_project,
            new_project,
            sample_project,
            edit_project,
            edit_library,
            undo_project,
            redo_project,
            undo_library,
            redo_library,
            project_status,
            library_status,
            wire_route,
            wire_net,
            node_distances,
            merge_base_library,
            calc_results,
            connector_image_index,
            connector_image,
            set_connector_image,
            write_text_file
        ])
        .setup(|app| {
            recovery::start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                recovery::on_exit(app);
            }
        });
}
