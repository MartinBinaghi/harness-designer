//! Estado del backend: el proyecto y la biblioteca viven acá (no en el
//! frontend), cada uno con su propia pila de deshacer/rehacer (`History<T>`).
//! El frontend es un espejo de lo que el backend devuelve en cada comando;
//! toda edición pasa por `edit_project`/`edit_library` para que el undo/redo
//! sea real. Ver decisión en docs/BITACORA.md (sesión de conexión de undo/redo).

use std::sync::Mutex;

use serde::Serialize;

use crate::calc::CostReport;
use crate::checks::Finding;
use crate::contacts::GaugeFacts;
use crate::model::{library::Library, project::ProjectData};
use crate::topology::PinDestinations;
use crate::undo::History;

/// Todo lo que se calcula sobre el proyecto y la biblioteca en una revisión:
/// la pantalla lo muestra, no lo recalcula (cada regla vive en un solo lugar).
#[derive(Debug, Clone, Serialize)]
pub struct CalcResults {
    pub report: CostReport,
    pub findings: Vec<Finding>,
    /// "Termina en" de cada vía con cable (hojas de pinout, pestaña Connectors).
    pub destinations: Vec<PinDestinations>,
    /// Calibres ya interpretados, para elegir el tipo de un cable nuevo.
    pub gauges: GaugeFacts,
}

pub struct AppState {
    pub project: Mutex<Option<History<ProjectData>>>,
    pub library: Mutex<History<Library>>,
    /// Archivo de la biblioteca abierta: cada cambio se guarda ahí solo
    /// (autoguardado). `None` mientras no hay archivo.
    pub library_path: Mutex<Option<String>>,
    /// Archivo del proyecto abierto (al abrir o guardar), para que una recarga
    /// de la ventana lo recupere junto con el proyecto.
    pub project_path: Mutex<Option<String>>,
    /// Último cálculo, con las revisiones (proyecto, biblioteca) de las que
    /// sale: pedirlo de nuevo sin cambios no recalcula nada.
    pub calc: Mutex<Option<((u64, u64), CalcResults)>>,
    /// El archivo de la biblioteca tiene exactamente el estado actual del
    /// historial: el autoguardado puede escribir solo lo que cambia. Si un
    /// guardado falla, queda en `false` y el siguiente escribe todo.
    pub library_in_sync: Mutex<bool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project: Mutex::new(None),
            library: Mutex::new(History::new(Library::default())),
            library_path: Mutex::new(None),
            project_path: Mutex::new(None),
            calc: Mutex::new(None),
            library_in_sync: Mutex::new(false),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryStatus {
    pub can_undo: bool,
    pub can_redo: bool,
    /// Ver `History::revision`: la pantalla vuelve a pedir los cálculos cuando cambia.
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectStatus {
    pub loaded: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    /// Cambios sin guardar: se pregunta antes de cerrar o reemplazar el proyecto.
    pub unsaved: bool,
    /// Ver `History::revision` (0 sin proyecto).
    pub revision: u64,
}
