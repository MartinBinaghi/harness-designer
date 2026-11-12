//! Archivos de Harness Designer: proyectos (un arnés) y bibliotecas de partes,
//! cada uno un SQLite. El número de versión del formato va en el encabezado del
//! archivo (`PRAGMA user_version`), y cada formato tiene su lista de
//! migraciones numeradas: la `i` lleva un archivo de la versión `i` a la `i + 1`,
//! así que la versión actual es la cantidad de migraciones.
//!
//! Al abrir o guardar sobre un archivo existente:
//! - más nuevo que este programa: no se toca, y se avisa;
//! - más viejo: se copia a `<archivo>.v<N>.bak` y se migra en una sola
//!   transacción (si algo falla, queda como estaba);
//! - en todos los casos, sus tablas y columnas tienen que coincidir exactamente
//!   con el esquema actual: si no, no se abre (mejor un aviso que datos leídos a
//!   medias o un guardado que falla).
//!
//! Para agregar un cambio de formato: se cambia `schema/*.sql` y se agrega una
//! migración al final de la lista correspondiente (nunca se edita una que ya
//! salió en un release); los archivos de `resources/` se ponen al día con
//! `cargo test upgrade_bundled_files -- --ignored`.

use rusqlite::{Connection, OpenFlags, Transaction};
use std::collections::BTreeSet;
use std::path::Path;

pub(crate) const LIBRARY_SCHEMA: &str = include_str!("../schema/library.sql");
pub(crate) const PROJECT_SCHEMA: &str = include_str!("../schema/project.sql");

type Migration = fn(&Transaction) -> rusqlite::Result<()>;

pub struct Format {
    /// "harness project" / "parts library", para los mensajes.
    noun: &'static str,
    schema: &'static str,
    /// Tabla que identifica al tipo de archivo.
    marker_table: &'static str,
    migrations: &'static [Migration],
}

impl Format {
    pub fn version(&self) -> i64 {
        self.migrations.len() as i64
    }
}

pub const PROJECT: Format = Format {
    noun: "harness project",
    schema: PROJECT_SCHEMA,
    marker_table: "project",
    migrations: &[
        project_v0_to_v1,
        project_v1_to_v2,
        project_v2_to_v3,
        project_v3_to_v4,
        project_v4_to_v5,
    ],
};

pub const LIBRARY: Format = Format {
    noun: "parts library",
    schema: LIBRARY_SCHEMA,
    marker_table: "parts",
    migrations: &[library_v0_to_v1, library_v1_to_v2, library_v2_to_v3],
};

// --- Migraciones -------------------------------------------------------------

/// Versión 0 = cualquier archivo de antes del versionado (hasta el 2026-10-26).
/// Los que se usaron de verdad son del 8/10 en adelante y difieren solo en
/// columnas agregadas después (ver docs/BITACORA.md); se suman las que falten.
/// `format_version` se va: la versión vive en el encabezado del archivo, no en
/// una fila. Un archivo anterior al 8/10 no pasa la verificación del esquema.
fn project_v0_to_v1(tx: &Transaction) -> rusqlite::Result<()> {
    add_column_if_missing(
        tx,
        "project",
        "cost_on_purchased",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(tx, "project", "spare_pcts", "TEXT NOT NULL DEFAULT '{}'")?;
    add_column_if_missing(tx, "project", "cut_round_mm", "REAL")?;
    add_column_if_missing(tx, "nodes", "adhesive_heatshrink_length_mm", "REAL")?;
    add_column_if_missing(tx, "splice_instances", "name", "TEXT NOT NULL DEFAULT ''")?;
    if columns(tx, "project")?.contains("format_version") {
        tx.execute_batch("ALTER TABLE project DROP COLUMN format_version")?;
    }
    Ok(())
}

/// Cables comprados de varios conductores (2026-11-01): la tabla
/// `cable_instances` la crea el esquema; acá, la columna que une cada cable
/// del arnés con el cable comprado del que es conductor.
fn project_v1_to_v2(tx: &Transaction) -> rusqlite::Result<()> {
    add_column_if_missing(
        tx,
        "wire_instances",
        "cable_instance_id",
        "INTEGER REFERENCES cable_instances(id)",
    )
}

/// Pedidos de Martin del 2026-11-09:
/// - un cable puede quedar **suelto en un nodo** (`end_x_kind = 'loose'`,
///   `end_x_node_id`): llega hasta ahí pero no se conecta;
/// - un breakout puede llevar un **boot recto** (`termination = 'boot_straight'`)
///   sobre uno de sus tramos (`termination_segment_id`);
/// - un tramo puede salir del breakout **hacia atrás** (`segments.leaves_backward`).
///
/// SQLite no deja cambiar un CHECK: `nodes` y `wire_instances` se rehacen con
/// la definición nueva y se copian sus filas (corre con las claves foráneas
/// apagadas, ver `upgrade`). Las definiciones van escritas acá, no tomadas de
/// `schema/project.sql`, para que esta migración no cambie si el esquema cambia.
fn project_v2_to_v3(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE nodes_v3 (
             id                          INTEGER PRIMARY KEY,
             kind                        TEXT NOT NULL CHECK (kind IN ('connector_end', 'breakout', 'splice_point', 'ground_point')),
             termination                 TEXT CHECK (termination IN ('t_mold', 'adhesive_heatshrink', 'boot_straight', 'none')),
             termination_library_part_id INTEGER,
             termination_segment_id      INTEGER,
             diagram_x                   REAL,
             diagram_y                   REAL,
             adhesive_heatshrink_length_mm REAL
         );
         INSERT INTO nodes_v3 (id, kind, termination, termination_library_part_id, diagram_x, diagram_y, adhesive_heatshrink_length_mm)
             SELECT id, kind, termination, termination_library_part_id, diagram_x, diagram_y, adhesive_heatshrink_length_mm FROM nodes;
         DROP TABLE nodes;
         ALTER TABLE nodes_v3 RENAME TO nodes;

         CREATE TABLE wire_instances_v3 (
             id                              INTEGER PRIMARY KEY,
             short_id                        TEXT NOT NULL UNIQUE,
             library_part_id                 INTEGER NOT NULL,
             color                           TEXT,
             signal_type_id                  INTEGER,
             specific_name                   TEXT,
             manual_cut_margin_pct           REAL,
             manual_length_mm                REAL,
             label                           TEXT,
             cable_instance_id               INTEGER REFERENCES cable_instances(id),
             end_a_kind                      TEXT NOT NULL CHECK (end_a_kind IN ('cavity', 'splice', 'ground', 'component', 'loose')),
             end_a_cavity_assignment_id      INTEGER REFERENCES cavity_assignments(id),
             end_a_splice_id                 INTEGER REFERENCES splice_instances(id),
             end_a_ground_point_id           INTEGER REFERENCES ground_points(id),
             end_a_component_instance_id     INTEGER REFERENCES component_instances(id),
             end_a_node_id                   INTEGER REFERENCES nodes(id),
             end_b_kind                      TEXT NOT NULL CHECK (end_b_kind IN ('cavity', 'splice', 'ground', 'component', 'loose')),
             end_b_cavity_assignment_id      INTEGER REFERENCES cavity_assignments(id),
             end_b_splice_id                 INTEGER REFERENCES splice_instances(id),
             end_b_ground_point_id           INTEGER REFERENCES ground_points(id),
             end_b_component_instance_id     INTEGER REFERENCES component_instances(id),
             end_b_node_id                   INTEGER REFERENCES nodes(id)
         );
         INSERT INTO wire_instances_v3 (id, short_id, library_part_id, color, signal_type_id, specific_name, manual_cut_margin_pct, manual_length_mm, label, cable_instance_id,
                                        end_a_kind, end_a_cavity_assignment_id, end_a_splice_id, end_a_ground_point_id, end_a_component_instance_id,
                                        end_b_kind, end_b_cavity_assignment_id, end_b_splice_id, end_b_ground_point_id, end_b_component_instance_id)
             SELECT id, short_id, library_part_id, color, signal_type_id, specific_name, manual_cut_margin_pct, manual_length_mm, label, cable_instance_id,
                    end_a_kind, end_a_cavity_assignment_id, end_a_splice_id, end_a_ground_point_id, end_a_component_instance_id,
                    end_b_kind, end_b_cavity_assignment_id, end_b_splice_id, end_b_ground_point_id, end_b_component_instance_id
             FROM wire_instances;
         DROP TABLE wire_instances;
         ALTER TABLE wire_instances_v3 RENAME TO wire_instances;

         ALTER TABLE segments ADD COLUMN leaves_backward INTEGER NOT NULL DEFAULT 0 CHECK (leaves_backward IN (0, 1));",
    )
}

/// Pedido de Martin del 2026-11-10: el boot recto de un breakout aprieta con su
/// punta chica **varios tramos juntos** (en su arnés, los cables de la ECU doblan
/// en U: por la boca grande salen la ECU, el motor y la masa; por la punta, los
/// otros cinco conectores). El tramo único pasa a una lista, `node_boot_segments`.
/// El tramo elegido antes se copia (si todavía existe).
fn project_v3_to_v4(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE node_boot_segments (
             node_id                     INTEGER NOT NULL REFERENCES nodes(id),
             segment_id                  INTEGER NOT NULL REFERENCES segments(id),
             PRIMARY KEY (node_id, segment_id)
         );
         INSERT INTO node_boot_segments (node_id, segment_id)
             SELECT id, termination_segment_id FROM nodes
             WHERE termination_segment_id IN (SELECT id FROM segments);
         ALTER TABLE nodes DROP COLUMN termination_segment_id;",
    )
}

/// Pedido de Martin del 2026-11-12: el acomodo del esquema se guarda con el
/// proyecto (antes se rehacía solo cada vez que cambiaban los datos).
fn project_v4_to_v5(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch("ALTER TABLE project ADD COLUMN schematic_layout TEXT NOT NULL DEFAULT '{}';")
}

/// Ver `project_v0_to_v1`. Los grupos de pines de dispositivos se sacaron el
/// 8/10 (el mismo nombre en dos vías ya indica pines en paralelo).
fn library_v0_to_v1(tx: &Transaction) -> rusqlite::Result<()> {
    add_column_if_missing(tx, "connector_defs", "contact_part_id", "INTEGER")?;
    add_column_if_missing(tx, "connector_defs", "seal_plug_part_id", "INTEGER")?;
    add_column_if_missing(
        tx,
        "connector_defs",
        "adhesive_heatshrink_length_mm",
        "REAL",
    )?;
    tx.execute_batch(
        "DROP TABLE IF EXISTS device_def_pin_group_members;
         DROP TABLE IF EXISTS device_def_pin_groups;",
    )
}

/// Las fotos de los conectores salen de `connector_defs` a su propia tabla, para
/// que no viajen ni se reescriban con cada edición de la biblioteca.
fn library_v1_to_v2(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE connector_def_images (
             part_id     INTEGER NOT NULL,
             view        TEXT NOT NULL CHECK (view IN ('front', 'side', 'back')),
             data        TEXT NOT NULL,
             PRIMARY KEY (part_id, view)
         );
         INSERT INTO connector_def_images (part_id, view, data)
             SELECT part_id, 'front', image_front FROM connector_defs WHERE image_front IS NOT NULL
             UNION ALL SELECT part_id, 'side', image_side FROM connector_defs WHERE image_side IS NOT NULL
             UNION ALL SELECT part_id, 'back', image_back FROM connector_defs WHERE image_back IS NOT NULL;
         ALTER TABLE connector_defs DROP COLUMN image_side;
         ALTER TABLE connector_defs DROP COLUMN image_front;
         ALTER TABLE connector_defs DROP COLUMN image_back;",
    )
}

/// Conectores **sin contactos aparte** (pedido de Martin del 2026-11-09): el
/// cable va directo a la pieza (bornes a tornillo de la termocupla, un ojal que
/// se crimpea directo), sin contacto ni tapón, y Checks no avisa que falten.
fn library_v2_to_v3(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "ALTER TABLE connector_defs ADD COLUMN without_contacts INTEGER NOT NULL DEFAULT 0 CHECK (without_contacts IN (0, 1));",
    )
}

/// Solo para la migración de base (los archivos de la versión 0 vienen en
/// varias formas); las siguientes dicen exactamente qué cambian.
fn add_column_if_missing(
    tx: &Transaction,
    table: &str,
    column: &str,
    definition: &str,
) -> rusqlite::Result<()> {
    if columns(tx, table)?.contains(column) {
        return Ok(());
    }
    tx.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {column} {definition}"
    ))
}

// --- Abrir y guardar ---------------------------------------------------------

/// Un proyecto existente, para trabajar con él (se migra si es de una versión anterior).
pub fn open_project(path: &str) -> Result<Connection, String> {
    let mut conn = open_existing(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    check_kind(&conn, path, &PROJECT, &LIBRARY)?;
    require_project_row(&conn, path)?;
    upgrade(&mut conn, path, &PROJECT)?;
    Ok(conn)
}

/// Una biblioteca existente, para trabajar con ella (se migra si es de una versión anterior).
pub fn open_library(path: &str) -> Result<Connection, String> {
    let mut conn = open_existing(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    check_kind(&conn, path, &LIBRARY, &PROJECT)?;
    upgrade(&mut conn, path, &LIBRARY)?;
    Ok(conn)
}

/// Un proyecto que viene con el programa (el arnés de ejemplo): solo lectura.
/// Siempre está en la versión actual (lo asegura un test); si no, es un error
/// del instalador y se avisa en vez de escribir en la carpeta del programa.
pub fn open_bundled_project(path: &str) -> Result<Connection, String> {
    let conn = open_existing(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    check_kind(&conn, path, &PROJECT, &LIBRARY)?;
    require_project_row(&conn, path)?;
    if user_version(&conn)? != PROJECT.version() {
        return Err(format!(
            "{} that comes with the program is outdated: reinstall it.",
            file_name(path)
        ));
    }
    verify_schema(&conn, path, &PROJECT)?;
    Ok(conn)
}

/// Para guardar un proyecto: crea el archivo si no existe; si existe, tiene que
/// ser un proyecto (no se guarda un arnés encima de una biblioteca) y se pone
/// al día antes de escribir.
pub fn project_for_saving(path: &str) -> Result<Connection, String> {
    for_saving(path, &PROJECT, &LIBRARY)
}

/// Para guardar una biblioteca (autoguardado y "Save as"); ver `project_for_saving`.
pub fn library_for_saving(path: &str) -> Result<Connection, String> {
    for_saving(path, &LIBRARY, &PROJECT)
}

fn for_saving(path: &str, format: &Format, other: &Format) -> Result<Connection, String> {
    let mut conn =
        Connection::open(path).map_err(|e| format!("Can't open {}: {e}", file_name(path)))?;
    prepare_connection(&conn)?;
    if tables(&conn).map_err(|e| e.to_string())?.is_empty() {
        // Archivo nuevo (o vacío): el esquema actual, ya en la versión actual.
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(format.schema).map_err(|e| e.to_string())?;
        tx.pragma_update(None, "user_version", format.version())
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(conn);
    }
    check_kind(&conn, path, format, other)?;
    upgrade(&mut conn, path, format)?;
    Ok(conn)
}

// --- Piezas comunes ----------------------------------------------------------

fn open_existing(path: &str, mode: OpenFlags) -> Result<Connection, String> {
    if !Path::new(path).is_file() {
        return Err(format!("File not found: {path}"));
    }
    let conn = Connection::open_with_flags(path, mode | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Can't open {}: {e}", file_name(path)))?;
    prepare_connection(&conn)?;
    Ok(conn)
}

/// Claves foráneas activas (las cascadas y controles del esquema dependen de
/// eso) y, si otro pedido está escribiendo el mismo archivo (el autoguardado
/// mientras se lee una foto), esperar en vez de fallar con "database is locked".
fn prepare_connection(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())
}

/// Que el archivo sea del tipo pedido, con un mensaje claro si es del otro o de nada.
fn check_kind(
    conn: &Connection,
    path: &str,
    format: &Format,
    other: &Format,
) -> Result<(), String> {
    let tables =
        tables(conn).map_err(|_| format!("{} isn't a Harness Designer file.", file_name(path)))?;
    if tables.contains(format.marker_table) {
        Ok(())
    } else if tables.contains(other.marker_table) {
        let tab = if other.marker_table == "parts" {
            "Library"
        } else {
            "Topology"
        };
        Err(format!(
            "{} is a {}, not a {} — open it from the {tab} tab.",
            file_name(path),
            other.noun,
            format.noun
        ))
    } else {
        Err(format!(
            "{} isn't a {} (it's empty or from another program).",
            file_name(path),
            format.noun
        ))
    }
}

/// Un proyecto sin su fila de datos (los archivos vacíos que dejaba un bug viejo) no se abre.
fn require_project_row(conn: &Connection, path: &str) -> Result<(), String> {
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM project", [], |row| row.get(0))
        .unwrap_or(0);
    if rows > 0 {
        Ok(())
    } else {
        Err(format!(
            "{} isn't a harness project (it's empty or from another program).",
            file_name(path)
        ))
    }
}

/// Lleva el archivo a la versión actual (con copia de respaldo antes) y verifica su esquema.
fn upgrade(conn: &mut Connection, path: &str, format: &Format) -> Result<(), String> {
    let found = user_version(conn)?;
    let current = format.version();
    if found > current {
        return Err(format!(
            "{} was saved by a newer version of Harness Designer (file format {found}; this one reads up to {current}). Update the program to open it.",
            file_name(path)
        ));
    }
    if found < current {
        let backup = format!("{path}.v{found}.bak");
        std::fs::copy(path, &backup).map_err(|e| {
            format!(
                "Couldn't back up {} before updating its format: {e}",
                file_name(path)
            )
        })?;
        // Las migraciones que rehacen una tabla (para cambiarle un CHECK) la
        // borran y la renombran: con las claves foráneas activas, borrarla
        // borraría en cascada las filas que la referencian. Se apagan durante
        // la migración (fuera de una transacción: adentro no tienen efecto) y
        // antes de confirmar se verifica que no quede ninguna referencia rota.
        conn.pragma_update(None, "foreign_keys", false)
            .map_err(|e| e.to_string())?;
        let migrated = migrate_in_transaction(conn, path, format, found, current);
        conn.pragma_update(None, "foreign_keys", true)
            .map_err(|e| e.to_string())?;
        return migrated;
    }
    verify_schema(conn, path, format)
}

/// Las migraciones de `found` a `current`, todas o ninguna.
fn migrate_in_transaction(
    conn: &mut Connection,
    path: &str,
    format: &Format,
    found: i64,
    current: i64,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let migrate = || -> rusqlite::Result<()> {
        for step in &format.migrations[found as usize..] {
            step(&tx)?;
        }
        // Las tablas nuevas del esquema (las existentes no se tocan: IF NOT EXISTS).
        tx.execute_batch(format.schema)
    };
    migrate().map_err(|e| {
        format!(
            "Couldn't update the format of {}: {e} (the file wasn't changed)",
            file_name(path)
        )
    })?;
    verify_schema(&tx, path, format)?;
    let broken: i64 = tx
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    if broken > 0 {
        return Err(format!(
            "Couldn't update the format of {}: {broken} broken references (the file wasn't changed)",
            file_name(path)
        ));
    }
    tx.pragma_update(None, "user_version", current)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Tablas y columnas del archivo == las del esquema actual. Una columna de más
/// también cuenta (si es obligatoria, guardar fallaría).
fn verify_schema(conn: &Connection, path: &str, format: &Format) -> Result<(), String> {
    let reference = Connection::open_in_memory().map_err(|e| e.to_string())?;
    reference
        .execute_batch(format.schema)
        .map_err(|e| e.to_string())?;
    let shape = |c: &Connection| -> rusqlite::Result<BTreeSet<String>> {
        let mut out = BTreeSet::new();
        for table in tables(c)? {
            out.insert(table.clone());
            for column in columns(c, &table)? {
                out.insert(format!("{table}.{column}"));
            }
        }
        Ok(out)
    };
    let expected = shape(&reference).map_err(|e| e.to_string())?;
    let found = shape(conn).map_err(|e| e.to_string())?;
    let missing: Vec<_> = expected.difference(&found).cloned().collect();
    let extra: Vec<_> = found.difference(&expected).cloned().collect();
    if missing.is_empty() && extra.is_empty() {
        return Ok(());
    }
    let mut detail = Vec::new();
    if !missing.is_empty() {
        detail.push(format!("missing {}", missing.join(", ")));
    }
    if !extra.is_empty() {
        detail.push(format!("unknown {}", extra.join(", ")));
    }
    Err(format!(
        "{} has a format this version can't read ({}). It may come from a much older version of the program.",
        file_name(path),
        detail.join("; ")
    ))
}

fn user_version(conn: &Connection) -> Result<i64, String> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())
}

fn tables(conn: &Connection) -> rusqlite::Result<BTreeSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )?;
    let names = stmt.query_map([], |row| row.get::<_, String>(0))?.collect();
    names
}

fn columns(conn: &Connection, table: &str) -> rusqlite::Result<BTreeSet<String>> {
    let mut stmt = conn.prepare("SELECT name FROM pragma_table_info(?1)")?;
    let names = stmt
        .query_map([table], |row| row.get::<_, String>(0))?
        .collect();
    names
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::project::{self, ProjectData};

    fn temp_path(name: &str) -> String {
        let p = std::env::temp_dir().join(format!("harness-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_file(&p);
        p.to_string_lossy().into_owned()
    }

    fn table_names(path: &str) -> BTreeSet<String> {
        tables(&Connection::open(path).unwrap()).unwrap()
    }

    /// Esquema de los proyectos en el formato 2, tal cual salió (hasta la 0.1.5).
    const PROJECT_SCHEMA_V2: &str = include_str!("../schema/history/project.v2.sql");
    const LIBRARY_SCHEMA_V2: &str = include_str!("../schema/history/library.v2.sql");
    /// Esquema de los proyectos en el formato 3, tal cual salió (0.1.6).
    const PROJECT_SCHEMA_V3: &str = include_str!("../schema/history/project.v3.sql");
    /// Esquema de los proyectos en el formato 4, tal cual salió (0.1.7).
    const PROJECT_SCHEMA_V4: &str = include_str!("../schema/history/project.v4.sql");

    /// Un proyecto como los que había antes del versionado: el esquema de
    /// octubre (con `format_version`, sin nombre de splice ni redondeo) y versión 0.
    fn old_project_file(path: &str) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(PROJECT_SCHEMA_V2).unwrap();
        conn.execute_batch("ALTER TABLE wire_instances DROP COLUMN cable_instance_id")
            .unwrap();
        conn.execute_batch(
            "ALTER TABLE splice_instances DROP COLUMN name;
             ALTER TABLE project DROP COLUMN cut_round_mm;
             ALTER TABLE project ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1;
             INSERT INTO project (id, name, harness_code, format_version) VALUES (1, 'Motor', 'MOT-01', 1);
             INSERT INTO nodes (id, kind) VALUES (1, 'breakout');
             INSERT INTO splice_instances (id, short_id, library_part_id, node_id) VALUES (1, 'SP1', 9, 1);",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 0).unwrap();
    }

    #[test]
    fn opening_never_creates_files_nor_mixes_kinds() {
        // Ruta inexistente: error, y no aparece un archivo vacío.
        let missing = temp_path("missing.db");
        assert!(open_project(&missing)
            .unwrap_err()
            .starts_with("File not found"));
        assert!(!Path::new(&missing).exists());

        // Biblioteca abierta (o guardada) como proyecto: mensaje claro, y no se le agregan tablas.
        let library = temp_path("library.db");
        drop(library_for_saving(&library).unwrap());
        let before = table_names(&library);
        assert!(open_project(&library)
            .unwrap_err()
            .contains("parts library"));
        assert!(project_for_saving(&library)
            .unwrap_err()
            .contains("parts library"));
        assert_eq!(table_names(&library), before);
        assert!(open_library(&library).is_ok());

        // Proyecto con tablas pero sin datos (los archivos vacíos que dejaba un bug): no es un proyecto.
        let empty = temp_path("empty.harness.db");
        drop(project_for_saving(&empty).unwrap());
        assert!(open_project(&empty)
            .unwrap_err()
            .contains("isn't a harness project"));
        assert!(open_library(&empty)
            .unwrap_err()
            .contains("harness project"));

        for p in [library, empty] {
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn a_new_file_starts_at_the_current_version() {
        let path = temp_path("new.harness.db");
        let mut conn = project_for_saving(&path).unwrap();
        assert_eq!(user_version(&conn).unwrap(), PROJECT.version());
        project::save(&mut conn, &ProjectData::empty()).unwrap();
        drop(conn);
        assert!(project::load(&open_project(&path).unwrap()).is_ok());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn an_old_project_is_backed_up_migrated_and_keeps_its_data() {
        let path = temp_path("old.harness.db");
        old_project_file(&path);
        let conn = open_project(&path).unwrap();
        assert_eq!(user_version(&conn).unwrap(), PROJECT.version());
        let data = project::load(&conn).unwrap();
        assert_eq!(
            (
                data.project.name.as_str(),
                data.splice_instances[0].short_id.as_str(),
                data.splice_instances[0].name.as_str()
            ),
            ("Motor", "SP1", "")
        );
        assert!(!columns(&conn, "project")
            .unwrap()
            .contains("format_version"));
        // La copia de antes de migrar quedó, en su versión vieja.
        let backup = format!("{path}.v0.bak");
        assert_eq!(
            user_version(&Connection::open(&backup).unwrap()).unwrap(),
            0
        );
        // Abrir otra vez no migra de nuevo.
        let _ = std::fs::remove_file(&backup);
        drop(conn);
        drop(open_project(&path).unwrap());
        assert!(!Path::new(&backup).exists());
        let _ = std::fs::remove_file(path);
    }

    /// Formato 2 → 3 rehace `nodes` y `wire_instances` (cambian sus CHECK): no
    /// se pierde nada, tampoco lo que las referencia (con las claves foráneas
    /// activas, borrar la tabla vieja vaciaba los grupos de trenzado en cascada).
    #[test]
    fn a_v2_project_keeps_its_wires_and_twist_groups_when_tables_are_rebuilt() {
        let path = temp_path("v2.harness.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(PROJECT_SCHEMA_V2).unwrap();
        conn.execute_batch(
            "INSERT INTO project (id, name, harness_code) VALUES (1, 'Motor', 'MOT-01');
             INSERT INTO nodes (id, kind, termination, diagram_x) VALUES (1, 'connector_end', NULL, 10.5), (2, 'breakout', 't_mold', NULL);
             INSERT INTO segments (id, node_a_id, node_b_id, length_mm) VALUES (1, 1, 2, 300);
             INSERT INTO connector_instances (id, short_id, name, library_part_id, node_id) VALUES (1, 'X1', 'ECU', 5, 1);
             INSERT INTO cavity_assignments (id, connector_instance_id, cavity_id) VALUES (1, 1, '1'), (2, 1, '2');
             INSERT INTO cable_instances (id, short_id, library_part_id) VALUES (1, 'WC1', 7);
             INSERT INTO wire_instances (id, short_id, library_part_id, specific_name, cable_instance_id, end_a_kind, end_a_cavity_assignment_id, end_b_kind, end_b_cavity_assignment_id)
                 VALUES (1, 'W001', 7, 'TC+', 1, 'cavity', 1, 'cavity', 2), (2, 'W002', 7, 'TC-', 1, 'cavity', 2, 'cavity', 1);
             INSERT INTO twist_groups (id, name) VALUES (1, 'twist I');
             INSERT INTO twist_group_wires (twist_group_id, wire_instance_id) VALUES (1, 1), (1, 2);",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 2).unwrap();
        drop(conn);

        let mut conn = open_project(&path).unwrap();
        assert_eq!(user_version(&conn).unwrap(), PROJECT.version());
        let mut data = project::load(&conn).unwrap();
        assert_eq!(data.twist_groups[0].wire_instance_ids, [1, 2]);
        assert_eq!(
            data.wire_instances
                .iter()
                .map(|w| (
                    w.short_id.as_str(),
                    w.cable_instance_id,
                    w.end_b.cavity_assignment_id
                ))
                .collect::<Vec<_>>(),
            [("W001", Some(1), Some(2)), ("W002", Some(1), Some(1))]
        );
        assert_eq!(
            (
                data.nodes[0].diagram_x,
                data.nodes[1].termination.as_deref()
            ),
            (Some(10.5), Some("t_mold"))
        );
        assert!(!data.segments[0].leaves_backward);
        // Lo nuevo entra: un cable suelto en el nodo 2 y un boot recto en el breakout.
        data.wire_instances[1].end_b.kind = "loose".into();
        data.wire_instances[1].end_b.cavity_assignment_id = None;
        data.wire_instances[1].end_b.node_id = Some(2);
        data.nodes[1].termination = Some("boot_straight".into());
        data.nodes[1].termination_segment_ids = vec![1];
        project::save(&mut conn, &data).unwrap();
        assert_eq!(project::load(&conn).unwrap(), data);
        // Las claves foráneas vuelven a estar activas después de migrar.
        assert!(conn
            .execute(
                "INSERT INTO segments (id, node_a_id, node_b_id, length_mm) VALUES (9, 1, 99, 5)",
                []
            )
            .is_err());
        drop(conn);
        let _ = std::fs::remove_file(format!("{path}.v2.bak"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_v3_breakout_boot_keeps_its_segment_in_the_new_list() {
        let path = temp_path("v3.harness.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(PROJECT_SCHEMA_V3).unwrap();
        conn.execute_batch(
            "INSERT INTO project (id, name, harness_code) VALUES (1, 'Motor', 'MOT-01');
             INSERT INTO nodes (id, kind, termination, termination_segment_id) VALUES (1, 'connector_end', NULL, NULL), (2, 'breakout', 'boot_straight', 1), (3, 'connector_end', NULL, NULL), (4, 'breakout', 'boot_straight', 99);
             INSERT INTO segments (id, node_a_id, node_b_id, length_mm) VALUES (1, 1, 2, 300), (2, 2, 3, 200), (3, 2, 4, 100);",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 3).unwrap();
        drop(conn);

        let mut conn = open_project(&path).unwrap();
        let mut data = project::load(&conn).unwrap();
        // El tramo elegido pasa a la lista; uno que ya no existía (99) no.
        let ids = |data: &ProjectData| {
            data.nodes
                .iter()
                .map(|n| n.termination_segment_ids.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(ids(&data), [vec![], vec![1], vec![], vec![]]);
        // Varios tramos por la punta chica.
        data.nodes[1].termination_segment_ids = vec![1, 2];
        project::save(&mut conn, &data).unwrap();
        assert_eq!(
            ids(&project::load(&conn).unwrap()),
            [vec![], vec![1, 2], vec![], vec![]]
        );
        drop(conn);
        let _ = std::fs::remove_file(format!("{path}.v3.bak"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_v4_project_starts_with_an_automatic_schematic_and_keeps_a_saved_one() {
        let path = temp_path("v4.harness.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(PROJECT_SCHEMA_V4).unwrap();
        conn.execute_batch(
            "INSERT INTO project (id, name, harness_code) VALUES (1, 'Motor', 'MOT-01');",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 4).unwrap();
        drop(conn);

        let mut conn = open_project(&path).unwrap();
        let mut data = project::load(&conn).unwrap();
        assert!(data.project.schematic_layout.is_empty());
        data.project.schematic_layout = [
            ("c1".to_string(), [12.5, -40.0]),
            ("s2".to_string(), [400.0, 80.0]),
        ]
        .into();
        project::save(&mut conn, &data).unwrap();
        assert_eq!(project::load(&conn).unwrap(), data);
        drop(conn);
        let _ = std::fs::remove_file(format!("{path}.v4.bak"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_file_from_a_newer_program_is_left_untouched() {
        let path = temp_path("newer.harness.db");
        let mut conn = project_for_saving(&path).unwrap();
        project::save(&mut conn, &ProjectData::empty()).unwrap();
        conn.pragma_update(None, "user_version", PROJECT.version() + 1)
            .unwrap();
        drop(conn);
        let err = open_project(&path).unwrap_err();
        assert!(err.contains("newer version"), "{err}");
        assert!(project_for_saving(&path)
            .unwrap_err()
            .contains("newer version"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_file_with_an_unknown_shape_is_refused_and_not_changed() {
        // Versión actual pero sin una columna: no se lee a medias.
        let path = temp_path("broken.harness.db");
        let mut conn = project_for_saving(&path).unwrap();
        project::save(&mut conn, &ProjectData::empty()).unwrap();
        conn.execute_batch("ALTER TABLE nodes DROP COLUMN diagram_x")
            .unwrap();
        drop(conn);
        let err = open_project(&path).unwrap_err();
        assert!(err.contains("missing nodes.diagram_x"), "{err}");

        // Versión 0 con una forma anterior al 8/10: la migración no la arregla, y el archivo queda como estaba.
        let old = temp_path("ancient.harness.db");
        old_project_file(&old);
        Connection::open(&old)
            .unwrap()
            .execute_batch("ALTER TABLE connector_instances ADD COLUMN device_instance_id INTEGER")
            .unwrap();
        let err = open_project(&old).unwrap_err();
        assert!(
            err.contains("unknown connector_instances.device_instance_id"),
            "{err}"
        );
        let conn = Connection::open(&old).unwrap();
        assert_eq!(user_version(&conn).unwrap(), 0);
        assert!(columns(&conn, "project")
            .unwrap()
            .contains("format_version"));
        for p in [path, old.clone(), format!("{old}.v0.bak")] {
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn an_old_library_loses_the_removed_pin_groups() {
        // Forma real de una biblioteca de antes del versionado: fotos en columnas,
        // sin el largo del termo con adhesivo y con los grupos de pines.
        let path = temp_path("old-library.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(LIBRARY_SCHEMA_V2).unwrap();
        conn.execute_batch(
            "DROP TABLE connector_def_images;
             ALTER TABLE connector_defs ADD COLUMN image_side TEXT;
             ALTER TABLE connector_defs ADD COLUMN image_front TEXT;
             ALTER TABLE connector_defs ADD COLUMN image_back TEXT;
             ALTER TABLE connector_defs DROP COLUMN adhesive_heatshrink_length_mm;
             CREATE TABLE device_def_pin_groups (id INTEGER PRIMARY KEY, device_def_id INTEGER, name TEXT);
             CREATE TABLE device_def_pin_group_members (group_id INTEGER, pin_id INTEGER);",
        )
        .unwrap();
        drop(conn);
        let conn = open_library(&path).unwrap();
        assert!(crate::model::library::load(&conn).is_ok());
        assert!(!table_names(&path).contains("device_def_pin_groups"));
        for p in [path.clone(), format!("{path}.v0.bak")] {
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn library_photos_move_to_their_own_table() {
        // Una biblioteca de la versión 1: las fotos en columnas de connector_defs.
        let path = temp_path("v1-library.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(LIBRARY_SCHEMA_V2).unwrap();
        conn.execute_batch(
            "DROP TABLE connector_def_images;
             ALTER TABLE connector_defs ADD COLUMN image_side TEXT;
             ALTER TABLE connector_defs ADD COLUMN image_front TEXT;
             ALTER TABLE connector_defs ADD COLUMN image_back TEXT;
             INSERT INTO parts (id, part_number, category, purchase_unit) VALUES (7, 'DT06-2S', 'connector', 'unit');
             INSERT INTO connector_defs (part_id, gender, image_front, image_back)
                 VALUES (7, 'female', 'data:image/webp;base64,AAA', 'data:image/webp;base64,BBB');",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        drop(conn);

        let conn = open_library(&path).unwrap();
        assert_eq!(user_version(&conn).unwrap(), LIBRARY.version());
        let index = crate::model::library::image_index(&conn).unwrap();
        assert_eq!(
            index.get(&7),
            Some(&vec!["back".to_string(), "front".to_string()])
        );
        assert_eq!(
            crate::model::library::image(&conn, 7, "front")
                .unwrap()
                .as_deref(),
            Some("data:image/webp;base64,AAA")
        );
        assert!(!columns(&conn, "connector_defs")
            .unwrap()
            .contains("image_front"));
        drop(conn);
        for p in [path.clone(), format!("{path}.v1.bak")] {
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn segment_requires_existing_nodes() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(PROJECT_SCHEMA).unwrap();
        let err = conn
            .execute("INSERT INTO segments (id, node_a_id, node_b_id, length_mm) VALUES (1, 99, 98, 100)", [])
            .unwrap_err();
        assert!(err.to_string().contains("FOREIGN KEY"));
    }

    /// Los archivos que trae el instalador se abren en solo lectura: tienen que
    /// estar en la versión actual. Si este test falla, correr `upgrade_bundled_files`.
    #[test]
    fn bundled_files_are_current() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/resources");
        let sample = open_bundled_project(&format!("{dir}/sample-project.db")).unwrap();
        assert!(project::load(&sample).is_ok());
        let library = Connection::open_with_flags(
            format!("{dir}/default-library.db"),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        assert_eq!(user_version(&library).unwrap(), LIBRARY.version());
        verify_schema(&library, "default-library.db", &LIBRARY).unwrap();
    }

    /// Mantenimiento, no un test: pone al día los archivos de `resources/` y de
    /// `examples/` (los de ejemplo, no los arneses reales) después de agregar una
    /// migración. `cargo test upgrade_bundled_files -- --ignored`
    #[test]
    #[ignore]
    fn upgrade_bundled_files() {
        let root = env!("CARGO_MANIFEST_DIR");
        for (path, is_project) in [
            (format!("{root}/resources/sample-project.db"), true),
            (format!("{root}/resources/default-library.db"), false),
            (format!("{root}/../examples/engine-demo.harness.db"), true),
            (format!("{root}/../examples/engine-demo-library.db"), false),
        ] {
            let conn = if is_project {
                open_project(&path)
            } else {
                open_library(&path)
            }
            .unwrap();
            println!("{path}: version {}", user_version(&conn).unwrap());
            drop(conn);
            for v in 0..PROJECT.version().max(LIBRARY.version()) {
                let _ = std::fs::remove_file(format!("{path}.v{v}.bak"));
            }
        }
    }
}
