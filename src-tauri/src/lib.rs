mod base_library;
mod calc;
mod checks;
mod contacts;
mod db;
#[cfg(test)]
mod demo;
mod gauge;
mod model;
mod settings;
mod state;
mod topology;
mod undo;

use serde::Serialize;
use tauri::{AppHandle, State};

use model::{library::Library, project::ProjectData};
use state::{AppState, HistoryStatus, ProjectStatus};
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
    let conn = db::open_existing_library(path)?;
    let library = model::library::load(&conn).map_err(|e| e.to_string())?;
    *state.library.lock().unwrap() = History::new(library.clone());
    *state.library_path.lock().unwrap() = Some(path.to_string());
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

fn write_library(path: &str, library: &Library) -> Result<(), String> {
    let mut conn = db::create_or_open_library(path).map_err(|e| e.to_string())?;
    model::library::save(&mut conn, library).map_err(|e| e.to_string())
}

/// "Guardar como": copia la biblioteca a otro archivo, que pasa a ser el actual.
#[tauri::command]
fn save_library(path: String, app: AppHandle, state: State<AppState>) -> Result<(), String> {
    write_library(&path, state.library.lock().unwrap().get())?;
    *state.library_path.lock().unwrap() = Some(path.clone());
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

/// Autoguardado: cada cambio en la biblioteca va derecho a su archivo.
// ponytail: reescribe la biblioteca entera (imágenes incluidas) en cada cambio; si con muchas imágenes se nota, guardar solo las filas que cambian o hacerlo en otro hilo.
fn autosaved(state: &AppState, library: &Library) -> LibraryChange {
    let save_error = match state.library_path.lock().unwrap().as_deref() {
        Some(path) => write_library(path, library)
            .err()
            .map(|e| format!("Library changes aren't being saved to {path}: {e}")),
        None => None,
    };
    LibraryChange {
        library: library.clone(),
        save_error,
    }
}

#[tauri::command]
fn open_project(path: String, state: State<AppState>) -> Result<ProjectData, String> {
    let conn = db::open_existing_project(&path)?;
    let project = model::project::load(&conn).map_err(|e| e.to_string())?;
    *state.project.lock().unwrap() = Some(History::new(project.clone()));
    Ok(project)
}

#[tauri::command]
fn save_project(path: String, state: State<AppState>) -> Result<(), String> {
    let mut guard = state.project.lock().unwrap();
    let history = guard.as_mut().ok_or("no hay proyecto cargado")?;
    let dangling = model::project::dangling_references(history.get());
    if !dangling.is_empty() {
        let list: Vec<String> = dangling.into_iter().map(|d| d.message).collect();
        return Err(format!(
            "the project has broken references (see Checks): {}",
            list.join("; ")
        ));
    }
    let mut conn = db::create_or_open_project(&path).map_err(|e| e.to_string())?;
    model::project::save(&mut conn, history.get()).map_err(|e| e.to_string())?;
    history.mark_saved();
    Ok(())
}

#[tauri::command]
fn new_project(state: State<AppState>) -> ProjectData {
    let project = ProjectData::empty();
    *state.project.lock().unwrap() = Some(History::new(project.clone()));
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
    let conn = db::open_existing_project(&path.to_string_lossy())?;
    let project = model::project::load(&conn).map_err(|e| e.to_string())?;
    *state.project.lock().unwrap() = Some(History::new(project.clone()));
    let default = settings::default_library_path(&app).ok();
    let notice = (state.library_path.lock().unwrap().as_deref() != default.as_deref())
        .then(|| "The sample was made with the default library: with another library its parts may not match.".to_string());
    Ok(SampleProject { project, notice })
}

#[tauri::command]
fn edit_project(project: ProjectData, state: State<AppState>) -> Result<ProjectData, String> {
    let mut guard = state.project.lock().unwrap();
    let history = guard.as_mut().ok_or("no hay proyecto cargado")?;
    history.edit(project);
    Ok(history.get().clone())
}

#[tauri::command]
fn edit_library(library: Library, state: State<AppState>) -> LibraryChange {
    let mut history = state.library.lock().unwrap();
    history.edit(library);
    autosaved(&state, history.get())
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
    let mut history = state.library.lock().unwrap();
    history.undo();
    autosaved(&state, history.get())
}

#[tauri::command]
fn redo_library(state: State<AppState>) -> LibraryChange {
    let mut history = state.library.lock().unwrap();
    history.redo();
    autosaved(&state, history.get())
}

#[tauri::command]
fn project_status(state: State<AppState>) -> ProjectStatus {
    match state.project.lock().unwrap().as_ref() {
        Some(history) => ProjectStatus {
            loaded: true,
            can_undo: history.can_undo(),
            can_redo: history.can_redo(),
            unsaved: history.unsaved(),
        },
        None => ProjectStatus {
            loaded: false,
            can_undo: false,
            can_redo: false,
            unsaved: false,
        },
    }
}

#[tauri::command]
fn library_status(state: State<AppState>) -> HistoryStatus {
    let history = state.library.lock().unwrap();
    HistoryStatus {
        can_undo: history.can_undo(),
        can_redo: history.can_redo(),
    }
}

// Estas cuatro quedan como funciones puras sobre los datos que les pasa el
// frontend (no leen AppState): son consultas de solo lectura sobre lo que se
// ve en pantalla en este instante, que puede ir unos milisegundos adelante
// del último commit al historial (ver debounce en useBackedState.ts del
// frontend). Leer AppState acá las dejaría desactualizadas mientras el
// usuario tipea.
#[tauri::command]
fn wire_route(project: ProjectData, wire_id: i64) -> Option<Vec<i64>> {
    topology::wire_route(&project, wire_id)
}

#[tauri::command]
fn wire_net(project: ProjectData, wire_id: i64) -> Vec<i64> {
    topology::net_of_wire(&project, wire_id)
}

/// Distancia acumulada desde un nodo a cada nodo alcanzable (mm). Las claves
/// de un HashMap<i64, _> se serializan como texto en JSON.
#[tauri::command]
fn node_distances(project: ProjectData, from_node_id: i64) -> std::collections::HashMap<i64, f64> {
    topology::distances_from_node(&project, from_node_id)
}

/// La biblioteca recibida + las partes de la biblioteca base que le faltan.
/// No toca AppState: el frontend lo aplica como una edición (con su undo).
#[tauri::command]
fn merge_base_library(library: Library) -> Library {
    base_library::merge_base_library(&library)
}

#[tauri::command]
fn run_checks(project: ProjectData, library: Library) -> Vec<checks::Finding> {
    checks::run_checks(&project, &library)
}

#[tauri::command]
fn compute_costs(project: ProjectData, library: Library) -> calc::CostReport {
    calc::compute_cost_report(&project, &library)
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            startup_library,
            open_library,
            save_library,
            open_project,
            save_project,
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
            run_checks,
            compute_costs,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
