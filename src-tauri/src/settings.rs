//! Lo que la app recuerda entre sesiones, en `settings.json` dentro de la
//! carpeta de configuración del usuario (en Windows,
//! `%APPDATA%\com.martinbinaghi.arneses`): por ahora, qué biblioteca abrir.
//!
//! La biblioteca de la primera vez es una copia de la que viene con el
//! instalador (`resources/default-library.db`), en la carpeta de datos de la
//! app: así se puede editar sin tocar la instalación.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Settings {
    pub library_path: Option<String>,
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// Sin archivo o ilegible: valores por defecto (no es un error que valga la pena mostrar).
pub fn load(app: &AppHandle) -> Settings {
    settings_file(app)
        .ok()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_file(app)?, text).map_err(|e| e.to_string())
}

/// La biblioteca por defecto en la carpeta de datos; la primera vez se copia
/// la que trae el instalador.
pub fn default_library_path(app: &AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("library.db");
    if !path.exists() {
        let bundled = bundled(app, "default-library.db")?;
        std::fs::copy(&bundled, &path)
            .map_err(|e| format!("Couldn't copy the default library: {e}"))?;
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Un archivo de `src-tauri/resources/` (incluido en el instalador).
pub fn bundled(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(format!("resources/{name}"), BaseDirectory::Resource)
        .map_err(|e| e.to_string())
}
