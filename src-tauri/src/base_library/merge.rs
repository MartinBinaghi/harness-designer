//! Suma la biblioteca base a la del usuario sin tocar lo que ya cargó.

use super::build::base_library;
use crate::model::library::{
    ConnectorDef, ContactDef, CoveringDef, Library, Part, SealPlugDef, WireDef,
};
use std::collections::HashMap;

/// Agrega a `library` las partes de la biblioteca base que todavía no tiene
/// (por número de parte), con ids nuevos que no chocan con los existentes. Lo
/// que ya estaba cargado no se toca, aunque difiera de la base.
pub fn merge_base_library(library: &Library) -> Library {
    let base = base_library();
    let mut merged = library.clone();
    let existing: HashMap<&str, i64> = library
        .parts
        .iter()
        .map(|p| (p.part_number.as_str(), p.id))
        .collect();
    let mut next_id = library.parts.iter().map(|p| p.id).max().unwrap_or(0) + 1;

    // id en la base -> id final (el existente si ya estaba, o uno nuevo).
    let mut id_map = HashMap::new();
    let mut added = Vec::new();
    for part in &base.parts {
        if let Some(&id) = existing.get(part.part_number.as_str()) {
            id_map.insert(part.id, id);
        } else {
            id_map.insert(part.id, next_id);
            added.push(part.id);
            merged.parts.push(Part {
                id: next_id,
                ..part.clone()
            });
            next_id += 1;
        }
    }
    for def in base
        .connector_defs
        .clone()
        .into_iter()
        .filter(|d| added.contains(&d.part_id))
    {
        merged.connector_defs.push(ConnectorDef {
            part_id: id_map[&def.part_id],
            counterpart_id: def.counterpart_id.map(|c| id_map[&c]),
            contact_part_id: def.contact_part_id.map(|c| id_map[&c]),
            seal_plug_part_id: def.seal_plug_part_id.map(|c| id_map[&c]),
            ..def
        });
    }
    // Carcasas que ya estaban (de una base anterior, sin contacto ni tapón):
    // se completan esos dos campos si están vacíos; el resto no se toca.
    for def in &base.connector_defs {
        let Some(existing) = merged
            .connector_defs
            .iter_mut()
            .find(|d| d.part_id == id_map[&def.part_id])
        else {
            continue;
        };
        if existing.contact_part_id.is_none() {
            existing.contact_part_id = def.contact_part_id.map(|c| id_map[&c]);
        }
        if existing.seal_plug_part_id.is_none() {
            existing.seal_plug_part_id = def.seal_plug_part_id.map(|c| id_map[&c]);
        }
    }
    let new_id = |part_id: i64| added.contains(&part_id).then(|| id_map[&part_id]);
    for def in &base.contact_defs {
        if let Some(part_id) = new_id(def.part_id) {
            merged.contact_defs.push(ContactDef {
                part_id,
                ..def.clone()
            });
        }
    }
    for def in &base.seal_plug_defs {
        if let Some(part_id) = new_id(def.part_id) {
            merged.seal_plug_defs.push(SealPlugDef {
                part_id,
                ..def.clone()
            });
        }
    }
    for def in &base.covering_defs {
        if let Some(part_id) = new_id(def.part_id) {
            merged.covering_defs.push(CoveringDef {
                part_id,
                ..def.clone()
            });
        }
    }
    for def in base
        .wire_defs
        .into_iter()
        .filter(|d| added.contains(&d.part_id))
    {
        merged.wire_defs.push(WireDef {
            part_id: id_map[&def.part_id],
            ..def
        });
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::base_library::catalog::{OTHER_HOUSINGS, SUPERSEAL_10_SOCKETS};
    use crate::base_library::test_fixtures::*;

    #[test]
    fn merging_keeps_existing_parts_and_never_duplicates() {
        let mut library = Library::default();
        library.parts.push(Part {
            id: 50,
            part_number: "DTM06-6S".into(),
            manufacturer: Some("my supplier".into()),
            description: None,
            category: "connector".into(),
            purchase_unit: "unit".into(),
            qty_per_pack: 10.0,
            price_usd: Some(3.0),
            price_date: None,
        });

        let once = merge_base_library(&library);
        assert_eq!(once.parts.len(), base_library().parts.len());
        // La parte existente queda como estaba, con su id.
        assert_eq!(
            once.parts
                .iter()
                .filter(|p| p.part_number == "DTM06-6S")
                .count(),
            1
        );
        assert_eq!(
            once.parts.iter().find(|p| p.id == 50).unwrap().price_usd,
            Some(3.0)
        );
        // La contraparte nueva apunta al id existente.
        assert_eq!(def_by_pn(&once, "DTM04-6P").counterpart_id, Some(50));
        // El contacto de la carcasa nueva apunta a la parte agregada.
        let pin = once
            .parts
            .iter()
            .find(|p| p.part_number == "0460-202-20141")
            .unwrap()
            .id;
        assert_eq!(def_by_pn(&once, "DTM04-6P").contact_part_id, Some(pin));
        assert_eq!(
            once.contact_defs.len(),
            6 + SUPERSEAL_10_SOCKETS.len()
                + OTHER_HOUSINGS
                    .iter()
                    .filter(|h| h.contact.is_some())
                    .count()
        );
        // Ids únicos.
        let mut ids: Vec<i64> = once.parts.iter().map(|p| p.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), once.parts.len());

        let twice = merge_base_library(&once);
        assert_eq!(twice, once);
    }

    #[test]
    fn merging_fills_contact_and_seal_plug_of_housings_from_an_older_base() {
        // Una biblioteca armada con la base vieja: la carcasa está, sin contacto ni tapón.
        let mut old = Library::default();
        let base = base_library();
        let dt = def_by_pn(&base, "DT06-2S").clone();
        old.parts.push(
            base.parts
                .iter()
                .find(|p| p.id == dt.part_id)
                .unwrap()
                .clone(),
        );
        old.connector_defs.push(ConnectorDef {
            contact_part_id: None,
            seal_plug_part_id: None,
            adhesive_heatshrink_length_mm: None,
            counterpart_id: None,
            ..dt
        });

        let merged = merge_base_library(&old);
        let socket = merged
            .parts
            .iter()
            .find(|p| p.part_number == "0462-201-16141")
            .unwrap()
            .id;
        assert_eq!(def_by_pn(&merged, "DT06-2S").contact_part_id, Some(socket));
        assert!(def_by_pn(&merged, "DT06-2S").seal_plug_part_id.is_some());
    }

    /// Mantenimiento, no un test: suma a la biblioteca que trae el instalador
    /// (`resources/default-library.db`) lo que se agregó a la base. Correr con
    /// `cargo test update_bundled_library -- --ignored` y copiar el resultado a
    /// `examples/engine-demo-library.db` si se usa para pruebas.
    #[test]
    #[ignore]
    fn update_bundled_library() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/resources/default-library.db");
        let conn = crate::db::open_library(path).unwrap();
        let before = crate::model::library::load(&conn).unwrap();
        drop(conn);
        let merged = merge_base_library(&before);
        let mut conn = crate::db::library_for_saving(path).unwrap();
        crate::model::library::save(&mut conn, &merged).unwrap();
        println!("{} -> {} parts", before.parts.len(), merged.parts.len());
    }
}
