mod base_library;
mod calc;
mod checks;
mod contacts;
mod db;
mod demo;
mod gauge;
mod model;
mod state;
mod topology;
mod undo;

use tauri::State;

use model::{library::Library, project::ProjectData};
use state::{AppState, HistoryStatus, ProjectStatus};
use undo::History;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_library(path: String, state: State<AppState>) -> Result<Library, String> {
    let conn = db::open_existing_library(&path)?;
    let library = model::library::load(&conn).map_err(|e| e.to_string())?;
    *state.library.lock().unwrap() = History::new(library.clone());
    Ok(library)
}

#[tauri::command]
fn save_library(path: String, state: State<AppState>) -> Result<(), String> {
    let mut conn = db::create_or_open_library(&path).map_err(|e| e.to_string())?;
    let library = state.library.lock().unwrap();
    model::library::save(&mut conn, library.get()).map_err(|e| e.to_string())
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
    let guard = state.project.lock().unwrap();
    let history = guard.as_ref().ok_or("no hay proyecto cargado")?;
    let mut conn = db::create_or_open_project(&path).map_err(|e| e.to_string())?;
    model::project::save(&mut conn, history.get()).map_err(|e| e.to_string())
}

#[tauri::command]
fn new_project(state: State<AppState>) -> ProjectData {
    let project = ProjectData::empty();
    *state.project.lock().unwrap() = Some(History::new(project.clone()));
    project
}

#[tauri::command]
fn demo_project(state: State<AppState>) -> ProjectData {
    let project = demo::sample_project();
    *state.project.lock().unwrap() = Some(History::new(project.clone()));
    project
}

#[tauri::command]
fn demo_library(state: State<AppState>) -> Library {
    let library = demo::sample_library();
    *state.library.lock().unwrap() = History::new(library.clone());
    library
}

#[tauri::command]
fn edit_project(project: ProjectData, state: State<AppState>) -> Result<ProjectData, String> {
    let mut guard = state.project.lock().unwrap();
    let history = guard.as_mut().ok_or("no hay proyecto cargado")?;
    history.edit(project);
    Ok(history.get().clone())
}

#[tauri::command]
fn edit_library(library: Library, state: State<AppState>) -> Library {
    let mut history = state.library.lock().unwrap();
    history.edit(library);
    history.get().clone()
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
fn undo_library(state: State<AppState>) -> Library {
    let mut history = state.library.lock().unwrap();
    history.undo();
    history.get().clone()
}

#[tauri::command]
fn redo_library(state: State<AppState>) -> Library {
    let mut history = state.library.lock().unwrap();
    history.redo();
    history.get().clone()
}

#[tauri::command]
fn project_status(state: State<AppState>) -> ProjectStatus {
    match state.project.lock().unwrap().as_ref() {
        Some(history) => ProjectStatus {
            loaded: true,
            can_undo: history.can_undo(),
            can_redo: history.can_redo(),
        },
        None => ProjectStatus {
            loaded: false,
            can_undo: false,
            can_redo: false,
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
            greet,
            open_library,
            save_library,
            open_project,
            save_project,
            new_project,
            demo_project,
            demo_library,
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
