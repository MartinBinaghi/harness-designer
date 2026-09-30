use rusqlite::Connection;

pub(crate) const LIBRARY_SCHEMA: &str = include_str!("../schema/library.sql");
pub(crate) const PROJECT_SCHEMA: &str = include_str!("../schema/project.sql");

pub fn open_library(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.execute_batch(LIBRARY_SCHEMA)?;
    Ok(conn)
}

pub fn open_project(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.execute_batch(PROJECT_SCHEMA)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

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
            .query_row("SELECT name FROM project WHERE id = 1", [], |row| row.get(0))
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
}
