//! Copia de recuperación del proyecto (pedido de Martin del 2026-11-12: si la app
//! se cierra de golpe, lo que no se guardó se perdía; pasó cuando `tauri dev`
//! reinició la app de desarrollo).
//!
//! Mientras el proyecto tiene cambios sin guardar, cada `EVERY` se copia a
//! `recovery.json` en la carpeta de configuración de la app (al lado de
//! `settings.json`), con su archivo de origen. Al guardar, al quedar sin cambios
//! o al cerrar normalmente, la copia se borra: si al abrir el programa todavía
//! está, la sesión anterior terminó de golpe, y la pantalla ofrece recuperarla.
//!
//! JSON y no un `.db`: un proyecto con referencias colgadas no se puede guardar
//! en el archivo (claves foráneas), pero igual se tiene que poder recuperar.
//! Si una versión nueva del programa no la puede leer, se descarta.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::model::project::ProjectData;
use crate::state::AppState;

const EVERY: Duration = Duration::from_secs(10);

/// La copia que hay en el disco es de esta sesión (o ya se respondió qué hacer con
/// la de la anterior). Mientras no, no se toca: espera la respuesta.
static OWNED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize)]
pub struct Recovery {
    /// Archivo del proyecto (None = nunca se guardó).
    pub path: Option<String>,
    /// Cuándo se hizo la copia (milisegundos desde 1970, para la pantalla).
    pub saved_at_ms: u64,
    pub project: ProjectData,
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("recovery.json"))
}

/// La copia que dejó una sesión anterior, si hay y se puede leer (si no, se borra).
pub fn pending(app: &AppHandle) -> Option<Recovery> {
    let file = file(app)?;
    let text = std::fs::read_to_string(&file).ok()?;
    match serde_json::from_str(&text) {
        Ok(recovery) => Some(recovery),
        Err(_) => {
            let _ = std::fs::remove_file(&file);
            None
        }
    }
}

/// La copia anterior se recuperó: desde ahora es de esta sesión (queda en el disco
/// hasta que se guarde, por si la app se vuelve a cerrar de golpe).
pub fn adopt() {
    OWNED.store(true, Ordering::SeqCst);
}

/// Se descartó la copia anterior, o el proyecto se guardó.
pub fn discard(app: &AppHandle) {
    OWNED.store(true, Ordering::SeqCst);
    if let Some(file) = file(app) {
        let _ = std::fs::remove_file(file);
    }
}

/// Al cerrar normalmente: lo que no se guardó se descartó a propósito (la app
/// pregunta antes de cerrar). Una copia de otra sesión sin responder queda.
pub fn on_exit(app: &AppHandle) {
    if OWNED.load(Ordering::SeqCst) {
        discard(app);
    }
}

/// Escribe a un temporal y lo renombra: una copia a medio escribir no pisa la anterior.
fn write(file: &PathBuf, recovery: &Recovery) -> Result<(), String> {
    let text = serde_json::to_string(recovery).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

/// El hilo que hace la copia mientras dura la app.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut copied_revision = None;
        loop {
            std::thread::sleep(EVERY);
            let Some(file) = file(&app) else { continue };
            if !OWNED.load(Ordering::SeqCst) {
                if file.exists() {
                    continue; // la de la sesión anterior, sin responder todavía
                }
                OWNED.store(true, Ordering::SeqCst);
            }
            let state = app.state::<AppState>();
            // Se copia el proyecto y se suelta el candado antes de escribir.
            let (unsaved, snapshot) = match state.project.lock().unwrap().as_ref() {
                Some(h) if h.unsaved() => (
                    true,
                    (copied_revision != Some(h.revision()))
                        .then(|| (h.revision(), h.get().clone())),
                ),
                _ => (false, None),
            };
            if let Some((revision, project)) = snapshot {
                let recovery = Recovery {
                    path: state.project_path.lock().unwrap().clone(),
                    saved_at_ms: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map_or(0, |d| d.as_millis() as u64),
                    project,
                };
                if write(&file, &recovery).is_ok() {
                    copied_revision = Some(revision);
                }
            } else if !unsaved {
                copied_revision = None;
                let _ = std::fs::remove_file(&file);
            }
        }
    });
}
