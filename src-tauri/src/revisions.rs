//! Revisiones congeladas de un arnés (plan 4.2, Revision; formato 6): Rev A,
//! Rev B…, cada una con fecha, notas y una copia entera del proyecto tal como
//! estaba, dentro del mismo archivo (tabla `revisions`).
//!
//! La copia es un archivo de proyecto (los bytes del SQLite, `db::project_to_bytes`)
//! en el formato del programa que la congeló: al leerla se pone al día en memoria
//! con las mismas migraciones que cualquier archivo, sin reescribirla. Así un
//! cambio de formato futuro no necesita una migración aparte para las revisiones.
//!
//! No entran en deshacer ni en "guardar": se escriben directo en el archivo, como
//! las fotos de la biblioteca.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::db;
use crate::model::project::{self, ProjectData};

/// Lo que se muestra de cada revisión (sin la copia).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RevisionInfo {
    pub id: i64,
    pub label: String,
    pub frozen_at_ms: i64,
    pub notes: String,
    pub size_bytes: i64,
}

pub fn list(conn: &Connection) -> Result<Vec<RevisionInfo>, String> {
    let mut stmt = conn
        .prepare("SELECT id, label, frozen_at_ms, notes, length(snapshot) FROM revisions ORDER BY frozen_at_ms, id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RevisionInfo {
                id: row.get(0)?,
                label: row.get(1)?,
                frozen_at_ms: row.get(2)?,
                notes: row.get(3)?,
                size_bytes: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Congela `data` como la revisión `label` (que no puede repetirse).
pub fn freeze(
    conn: &Connection,
    label: &str,
    notes: &str,
    data: &ProjectData,
) -> Result<i64, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("the revision needs a name (A, B, 2…)".into());
    }
    if label_taken(conn, label)? {
        return Err(format!("there's already a revision {label} in this file"));
    }
    let bytes = db::project_to_bytes(data)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO revisions (label, frozen_at_ms, notes, snapshot) VALUES (?1, ?2, ?3, ?4)",
        params![label, now, notes.trim(), bytes],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

pub fn label_taken(conn: &Connection, label: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM revisions WHERE label = ?1",
        [label.trim()],
        |_| Ok(()),
    )
    .optional()
    .map(|found| found.is_some())
    .map_err(|e| e.to_string())
}

/// El arnés tal como quedó en esa revisión.
pub fn load(conn: &Connection, id: i64) -> Result<ProjectData, String> {
    let (label, bytes) = snapshot(conn, id)?;
    let copy = db::project_from_bytes(&bytes, &format!("Revision {label}"))?;
    project::load(&copy).map_err(|e| e.to_string())
}

/// Nombre y bytes de la copia (un archivo de proyecto completo, para exportarla).
pub fn snapshot(conn: &Connection, id: i64) -> Result<(String, Vec<u8>), String> {
    conn.query_row(
        "SELECT label, snapshot FROM revisions WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "that revision isn't in the file anymore".to_string())
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM revisions WHERE id = ?1", [id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// "Save as" a otro archivo: las revisiones viajan con el arnés. Las que tenía
/// el archivo de destino eran de lo que se pisó, así que se reemplazan (por
/// ninguna, si el arnés todavía no tenía archivo).
pub fn replace_all(from: Option<&Connection>, to: &mut Connection) -> Result<(), String> {
    let rows: Vec<(String, i64, String, Vec<u8>)> = match from {
        Some(from) => {
            let mut stmt = from
                .prepare("SELECT label, frozen_at_ms, notes, snapshot FROM revisions ORDER BY id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| e.to_string())?;
            rows
        }
        None => Vec::new(),
    };
    let tx = to.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM revisions", [])
        .map_err(|e| e.to_string())?;
    for (label, at, notes, bytes) in rows {
        tx.execute(
            "INSERT INTO revisions (label, frozen_at_ms, notes, snapshot) VALUES (?1, ?2, ?3, ?4)",
            params![label, at, notes, bytes],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::project::test_fixtures::sample;

    fn file() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(db::PROJECT_SCHEMA).unwrap();
        conn
    }

    #[test]
    fn a_frozen_revision_comes_back_as_it_was() {
        let mut conn = file();
        let mut data = sample();
        project::save(&mut conn, &data).unwrap();
        let a = freeze(&conn, " A ", "First delivery", &data).unwrap();

        // Seguir editando y guardar no cambia la revisión.
        data.project.name = "Changed".into();
        project::save(&mut conn, &data).unwrap();
        let b = freeze(&conn, "B", "", &data).unwrap();
        assert_eq!(load(&conn, a).unwrap(), sample());
        assert_eq!(load(&conn, b).unwrap().project.name, "Changed");

        let listed = list(&conn).unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|r| (r.label.as_str(), r.notes.as_str()))
                .collect::<Vec<_>>(),
            [("A", "First delivery"), ("B", "")]
        );
        assert!(listed[0].size_bytes > 0);

        // El nombre no se repite ni queda vacío.
        assert!(freeze(&conn, "A", "", &data)
            .unwrap_err()
            .contains("already"));
        assert!(freeze(&conn, "  ", "", &data).is_err());

        // La copia es un archivo de proyecto entero: exportada, se abre sola.
        let (label, bytes) = snapshot(&conn, a).unwrap();
        assert_eq!(label, "A");
        let exported = db::project_from_bytes(&bytes, "export").unwrap();
        assert_eq!(project::load(&exported).unwrap(), sample());

        delete(&conn, a).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert!(load(&conn, a).is_err());
    }

    #[test]
    fn save_as_takes_the_revisions_along_and_drops_the_overwritten_ones() {
        let data = sample();
        let from = file();
        freeze(&from, "A", "", &data).unwrap();
        freeze(&from, "B", "", &data).unwrap();
        let mut to = file();
        freeze(&to, "Z", "another harness", &data).unwrap();

        replace_all(Some(&from), &mut to).unwrap();
        assert_eq!(
            list(&to)
                .unwrap()
                .iter()
                .map(|r| r.label.clone())
                .collect::<Vec<_>>(),
            ["A", "B"]
        );
        replace_all(None, &mut to).unwrap();
        assert!(list(&to).unwrap().is_empty());
    }
}
