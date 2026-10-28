//! Fotos de los conectores: en su propia tabla, aparte de las fichas (no viajan con cada edición).

use rusqlite::{params, Connection, OptionalExtension, Result};
use std::collections::BTreeMap;

/// Vistas de las fotos de los conectores, en el orden en que se muestran.
pub const IMAGE_VIEWS: [&str; 3] = ["front", "side", "back"];

/// Qué fotos hay: parte -> vistas (ordenadas). Liviano: sin los datos.
pub fn image_index(conn: &Connection) -> Result<BTreeMap<i64, Vec<String>>> {
    let mut stmt =
        conn.prepare("SELECT part_id, view FROM connector_def_images ORDER BY part_id, view")?;
    let mut index: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    for row in stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })? {
        let (part_id, view) = row?;
        index.entry(part_id).or_default().push(view);
    }
    Ok(index)
}

/// Una foto (data URL), si la hay.
pub fn image(conn: &Connection, part_id: i64, view: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT data FROM connector_def_images WHERE part_id = ?1 AND view = ?2",
        params![part_id, view],
        |row| row.get(0),
    )
    .optional()
}

/// Pone (o con `None`, saca) una foto. Quien llama valida la vista y el dato.
pub fn set_image(conn: &Connection, part_id: i64, view: &str, data: Option<&str>) -> Result<()> {
    match data {
        Some(data) => conn.execute(
            "INSERT INTO connector_def_images (part_id, view, data) VALUES (?1, ?2, ?3)
             ON CONFLICT (part_id, view) DO UPDATE SET data = excluded.data",
            params![part_id, view, data],
        )?,
        None => conn.execute(
            "DELETE FROM connector_def_images WHERE part_id = ?1 AND view = ?2",
            params![part_id, view],
        )?,
    };
    Ok(())
}

/// Fotos de conectores que ya no existen (se borraron en una sesión anterior;
/// durante la sesión se conservan, por si se deshace el borrado).
pub fn remove_orphan_images(conn: &Connection) -> Result<usize> {
    conn.execute(
        "DELETE FROM connector_def_images WHERE part_id NOT IN (SELECT part_id FROM connector_defs)",
        [],
    )
}

/// Copia todas las fotos de una biblioteca a otra ("Save as").
pub fn copy_images(from: &Connection, to: &mut Connection) -> Result<()> {
    let mut stmt = from.prepare("SELECT part_id, view, data FROM connector_def_images")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>>>()?;
    let tx = to.transaction()?;
    tx.execute("DELETE FROM connector_def_images", [])?;
    for (part_id, view, data) in rows {
        tx.execute(
            "INSERT INTO connector_def_images (part_id, view, data) VALUES (?1, ?2, ?3)",
            params![part_id, view, data],
        )?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::library::*;

    #[test]
    fn photos_live_apart_and_survive_saving_the_part() {
        let path =
            std::env::temp_dir().join(format!("harness-test-{}-photos.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let path = path.to_string_lossy().into_owned();
        let library = crate::base_library::base_library();
        let id = library.connector_defs[0].part_id;
        let mut conn = crate::db::library_for_saving(&path).unwrap();
        save(&mut conn, &library).unwrap();
        set_image(&conn, id, "front", Some("data:image/webp;base64,AAA")).unwrap();

        // Guardar la parte (se borra y se vuelve a escribir) no se lleva la foto.
        let mut edited = library.clone();
        edited.connector_defs[0].shell_size = Some("9".into());
        save_changes(&mut conn, &edited, &changes(&library, &edited)).unwrap();
        assert_eq!(
            image(&conn, id, "front").unwrap().as_deref(),
            Some("data:image/webp;base64,AAA")
        );

        // Sin el conector, la foto queda huérfana y se limpia (al abrir la biblioteca).
        let mut without = edited.clone();
        without.connector_defs.retain(|d| d.part_id != id);
        without.parts.retain(|p| p.id != id);
        for d in &mut without.connector_defs {
            if d.counterpart_id == Some(id) {
                d.counterpart_id = None;
            }
        }
        save_changes(&mut conn, &without, &changes(&edited, &without)).unwrap();
        assert_eq!(remove_orphan_images(&conn).unwrap(), 1);
        assert!(image_index(&conn).unwrap().is_empty());
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
}
