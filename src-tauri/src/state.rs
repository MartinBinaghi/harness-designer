//! Estado del backend: el proyecto y la biblioteca viven acá (no en el
//! frontend), cada uno con su propia pila de deshacer/rehacer (`History<T>`).
//! El frontend es un espejo de lo que el backend devuelve en cada comando;
//! toda edición pasa por `edit_project`/`edit_library` para que el undo/redo
//! sea real. Ver decisión en docs/BITACORA.md (sesión de conexión de undo/redo).

use std::sync::Mutex;

use serde::Serialize;

use crate::model::{library::Library, project::ProjectData};
use crate::undo::History;

pub struct AppState {
    pub project: Mutex<Option<History<ProjectData>>>,
    pub library: Mutex<History<Library>>,
    /// Archivo de la biblioteca abierta: cada cambio se guarda ahí solo
    /// (autoguardado). `None` mientras no hay archivo.
    pub library_path: Mutex<Option<String>>,
    /// Archivo del proyecto abierto (al abrir o guardar), para que una recarga
    /// de la ventana lo recupere junto con el proyecto.
    pub project_path: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project: Mutex::new(None),
            library: Mutex::new(History::new(Library::default())),
            library_path: Mutex::new(None),
            project_path: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryStatus {
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectStatus {
    pub loaded: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    /// Cambios sin guardar: se pregunta antes de cerrar o reemplazar el proyecto.
    pub unsaved: bool,
}
