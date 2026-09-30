mod calc;
mod checks;
mod db;
mod demo;
mod gauge;
mod model;
mod topology;
mod undo;

use model::{library::Library, project::ProjectData};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_library(path: String) -> Result<Library, String> {
    let conn = db::open_library(&path).map_err(|e| e.to_string())?;
    model::library::load(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_library(path: String, library: Library) -> Result<(), String> {
    let mut conn = db::open_library(&path).map_err(|e| e.to_string())?;
    model::library::save(&mut conn, &library).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_project(path: String) -> Result<ProjectData, String> {
    let conn = db::open_project(&path).map_err(|e| e.to_string())?;
    model::project::load(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project(path: String, project: ProjectData) -> Result<(), String> {
    let mut conn = db::open_project(&path).map_err(|e| e.to_string())?;
    model::project::save(&mut conn, &project).map_err(|e| e.to_string())
}

#[tauri::command]
fn demo_project() -> ProjectData {
    demo::sample_project()
}

#[tauri::command]
fn demo_library() -> Library {
    demo::sample_library()
}

#[tauri::command]
fn wire_route(project: ProjectData, wire_id: i64) -> Option<Vec<i64>> {
    topology::wire_route(&project, wire_id)
}

#[tauri::command]
fn wire_net(project: ProjectData, wire_id: i64) -> Vec<i64> {
    topology::net_of_wire(&project, wire_id)
}

#[tauri::command]
fn run_checks(project: ProjectData, library: Library) -> Vec<checks::Finding> {
    checks::run_checks(&project, &library)
}

#[tauri::command]
fn compute_costs(project: ProjectData, library: Library) -> calc::CostReport {
    calc::compute_cost_report(&project, &library)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            open_library,
            save_library,
            open_project,
            save_project,
            demo_project,
            demo_library,
            wire_route,
            wire_net,
            run_checks,
            compute_costs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
