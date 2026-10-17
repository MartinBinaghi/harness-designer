use rusqlite::{Connection, OpenFlags};
use std::collections::HashSet;
use std::path::Path;

pub(crate) const LIBRARY_SCHEMA: &str = include_str!("../schema/library.sql");
pub(crate) const PROJECT_SCHEMA: &str = include_str!("../schema/project.sql");

/// Para guardar: crea el archivo y las tablas si no existen.
pub fn create_or_open_library(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.execute_batch(LIBRARY_SCHEMA)?;
    Ok(conn)
}

/// Para guardar: crea el archivo y las tablas si no existen.
pub fn create_or_open_project(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.execute_batch(PROJECT_SCHEMA)?;
    // Columnas sumadas cuando ya había un arnés real cargado: se agregan al
    // guardar (al abrir, `load` las toma como vacías).
    if !has_column(&conn, "splice_instances", "name") {
        conn.execute_batch("ALTER TABLE splice_instances ADD COLUMN name TEXT NOT NULL DEFAULT ''")?;
    }
    Ok(conn)
}

pub(crate) fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    conn.prepare(&format!("SELECT {column} FROM {table} LIMIT 0")).is_ok()
}

/// Para abrir: el archivo tiene que existir y no se modifica (ni se le crean
/// tablas). Antes, abrir una ruta inexistente creaba un archivo vacío y abrir
/// la biblioteca como proyecto le agregaba tablas de proyecto.
fn open_existing(path: &str) -> Result<(Connection, HashSet<String>), String> {
    if !Path::new(path).is_file() {
        return Err(format!("File not found: {path}"));
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Can't open {}: {e}", file_name(path)))?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    let tables = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .and_then(|mut stmt| stmt.query_map([], |row| row.get::<_, String>(0))?.collect())
        .map_err(|_| format!("{} isn't a Harness Designer file.", file_name(path)))?;
    Ok((conn, tables))
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

pub fn open_existing_project(path: &str) -> Result<Connection, String> {
    let (conn, tables) = open_existing(path)?;
    let has_project = tables.contains("project")
        && conn
            .query_row("SELECT COUNT(*) FROM project", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap_or(0)
            > 0;
    if has_project {
        Ok(conn)
    } else if tables.contains("parts") {
        Err(format!(
            "{} is a parts library, not a harness project — open it from the Library tab.",
            file_name(path)
        ))
    } else {
        Err(format!(
            "{} isn't a harness project (it's empty or from another program).",
            file_name(path)
        ))
    }
}

pub fn open_existing_library(path: &str) -> Result<Connection, String> {
    let (conn, tables) = open_existing(path)?;
    if tables.contains("parts") {
        Ok(conn)
    } else if tables.contains("project") {
        Err(format!(
            "{} is a harness project, not a parts library — open it from the Topology tab.",
            file_name(path)
        ))
    } else {
        Err(format!(
            "{} isn't a parts library (it's empty or from another program).",
            file_name(path)
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> String {
        let p = std::env::temp_dir().join(format!("harness-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_file(&p);
        p.to_string_lossy().into_owned()
    }

    fn table_names(path: &str) -> Vec<String> {
        let conn = Connection::open(path).unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    #[test]
    fn opening_never_creates_or_alters_a_file() {
        // Ruta inexistente: error, y no aparece un archivo vacío.
        let missing = temp_path("missing.db");
        assert!(open_existing_project(&missing)
            .unwrap_err()
            .starts_with("File not found"));
        assert!(!Path::new(&missing).exists());

        // Biblioteca abierta como proyecto: mensaje claro, y no se le agregan tablas de proyecto.
        let library = temp_path("library.db");
        drop(create_or_open_library(&library).unwrap());
        let before = table_names(&library);
        let err = open_existing_project(&library).unwrap_err();
        assert!(err.contains("parts library"), "{err}");
        assert_eq!(table_names(&library), before);
        assert!(open_existing_library(&library).is_ok());

        // Proyecto con tablas pero sin datos (los archivos vacíos que dejaba el bug): no es un proyecto.
        let empty = temp_path("empty.harness.db");
        drop(create_or_open_project(&empty).unwrap());
        assert!(open_existing_project(&empty)
            .unwrap_err()
            .contains("isn't a harness project"));
        assert!(open_existing_library(&empty)
            .unwrap_err()
            .contains("harness project"));

        for p in [library, empty] {
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn library_schema_applies_and_round_trips_a_wire() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(LIBRARY_SCHEMA).unwrap();

        conn.execute(
            "INSERT INTO parts (id, part_number, category, purchase_unit, price_usd, price_date)
             VALUES (1, 'M22759/32-22', 'wire', 'meter', 0.45, '2026-09-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO wire_defs (part_id, gauge, spec, color, outer_diameter_mm)
             VALUES (1, '22 AWG', 'M22759/32', 'red', 1.1)",
            [],
        )
        .unwrap();

        let outer_diameter: f64 = conn
            .query_row(
                "SELECT outer_diameter_mm FROM wire_defs WHERE part_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(outer_diameter, 1.1);
    }

    #[test]
    fn project_schema_applies_and_round_trips_the_project_row() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(PROJECT_SCHEMA).unwrap();

        conn.execute(
            "INSERT INTO project (id, name, harness_code, format_version) VALUES (1, 'Motor', 'MOT-01', 1)",
            [],
        )
        .unwrap();

        let name: String = conn
            .query_row("SELECT name FROM project WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(name, "Motor");
    }

    #[test]
    fn segment_requires_existing_nodes() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(PROJECT_SCHEMA).unwrap();

        let err = conn
            .execute(
                "INSERT INTO segments (id, node_a_id, node_b_id, length_mm) VALUES (1, 99, 98, 100)",
                [],
            )
            .unwrap_err();
        assert!(err.to_string().contains("FOREIGN KEY"));
    }

    #[test]
    fn a_file_from_before_splice_names_opens_and_saves() {
        // Un arnés guardado antes de que los splices tuvieran nombre.
        let path = temp_path("old-splices.db");
        let data = crate::model::project::ProjectData::empty();
        let mut conn = create_or_open_project(&path).unwrap();
        crate::model::project::save(&mut conn, &data).unwrap();
        conn.execute_batch("ALTER TABLE splice_instances DROP COLUMN name").unwrap();
        drop(conn);
        assert!(crate::model::project::load(&open_existing_project(&path).unwrap()).is_ok());
        let mut conn = create_or_open_project(&path).unwrap();
        assert!(has_column(&conn, "splice_instances", "name"));
        crate::model::project::save(&mut conn, &data).unwrap();
    }
}
