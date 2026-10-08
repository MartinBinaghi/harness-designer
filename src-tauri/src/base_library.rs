//! Biblioteca base: carcasas de conectores estandarizados (Deutsch DT/DTM/DTP,
//! TE Superseal 1.5) y cable M22759/32, para no cargar a mano lo que es igual
//! en todos los proyectos. Ver docs/BITACORA.md, decisión "Biblioteca base".
//!
//! Conectores: cargados sin datasheet a la vista; cada parte lo dice en su
//! descripción ("unverified") hasta que se confirme. Cables: diámetro
//! nominal de la hoja M22759/32 (NASA NEPP, coincide con la tabla publicada
//! por los fabricantes). Precio y medidas traseras quedan vacíos a propósito:
//! dependen del proveedor y del datasheet.

use crate::model::library::{ConnectorDef, ConnectorDefCavity, Library, Part, WireDef};
use std::collections::HashMap;

struct Family {
    manufacturer: &'static str,
    series: &'static str,
    contact_size: &'static str,
    suggested_termination: Option<&'static str>,
    /// (vías, carcasa con pines = macho, carcasa con sockets = hembra)
    members: &'static [(usize, &'static str, &'static str)],
    male_kind: &'static str,
    female_kind: &'static str,
}

const FAMILIES: &[Family] = &[
    Family {
        manufacturer: "TE / Deutsch",
        series: "DT",
        contact_size: "16",
        suggested_termination: Some("adhesive_heatshrink"),
        members: &[
            (2, "DT04-2P", "DT06-2S"),
            (3, "DT04-3P", "DT06-3S"),
            (4, "DT04-4P", "DT06-4S"),
            (6, "DT04-6P", "DT06-6S"),
            (8, "DT04-08PA", "DT06-08SA"),
            (12, "DT04-12PA", "DT06-12SA"),
        ],
        male_kind: "receptacle, pin contacts",
        female_kind: "plug, socket contacts",
    },
    Family {
        manufacturer: "TE / Deutsch",
        series: "DTM",
        contact_size: "20",
        suggested_termination: Some("adhesive_heatshrink"),
        members: &[
            (2, "DTM04-2P", "DTM06-2S"),
            (3, "DTM04-3P", "DTM06-3S"),
            (4, "DTM04-4P", "DTM06-4S"),
            (6, "DTM04-6P", "DTM06-6S"),
            (8, "DTM04-08PA", "DTM06-08SA"),
            (12, "DTM04-12PA", "DTM06-12SA"),
        ],
        male_kind: "receptacle, pin contacts",
        female_kind: "plug, socket contacts",
    },
    Family {
        manufacturer: "TE / Deutsch",
        series: "DTP",
        contact_size: "12",
        suggested_termination: Some("adhesive_heatshrink"),
        members: &[(2, "DTP04-2P", "DTP06-2S"), (4, "DTP04-4P", "DTP06-4S")],
        male_kind: "receptacle, pin contacts",
        female_kind: "plug, socket contacts",
    },
    Family {
        manufacturer: "TE",
        series: "Superseal 1.5",
        contact_size: "1.5",
        suggested_termination: None,
        members: &[
            (2, "282104-1", "282080-1"),
            (3, "282105-1", "282087-1"),
            (4, "282106-1", "282088-1"),
            (5, "282107-1", "282089-1"),
            (6, "282108-1", "282090-1"),
        ],
        male_kind: "tab housing",
        female_kind: "receptacle housing",
    },
];

/// M22759/32 (Raychem Spec 55, ETFE liviano, 150 °C, 600 V): calibre AWG y
/// diámetro exterior nominal en pulgadas, de la hoja de la norma.
const M22759_32: &[(u32, f64)] = &[
    (26, 0.032),
    (24, 0.037),
    (22, 0.043),
    (20, 0.050),
    (18, 0.060),
    (16, 0.068),
    (14, 0.085),
    (12, 0.103),
];

/// La biblioteca base sola, con ids desde 1. Cada macho tiene como
/// contraparte a su hembra y viceversa.
pub fn base_library() -> Library {
    let mut library = empty_library();
    for family in FAMILIES {
        for &(ways, male_pn, female_pn) in family.members {
            let male_id = library.parts.len() as i64 + 1;
            let female_id = male_id + 1;
            for (id, part_number, gender, kind, counterpart) in [
                (male_id, male_pn, "male", family.male_kind, female_id),
                (female_id, female_pn, "female", family.female_kind, male_id),
            ] {
                library.parts.push(Part {
                    id,
                    part_number: part_number.into(),
                    manufacturer: Some(family.manufacturer.into()),
                    description: Some(format!(
                        "{} {}-way {} — base library, unverified: check datasheet",
                        family.series, ways, kind
                    )),
                    category: "connector".into(),
                    purchase_unit: "unit".into(),
                    qty_per_pack: 1.0,
                    price_usd: None,
                    price_date: None,
                });
                library.connector_defs.push(ConnectorDef {
                    part_id: id,
                    gender: gender.into(),
                    series: Some(family.series.into()),
                    shell_size: None,
                    counterpart_id: Some(counterpart),
                    back_shape: None,
                    back_diameter_mm: None,
                    back_width_mm: None,
                    back_height_mm: None,
                    suggested_termination: family.suggested_termination.map(Into::into),
                    contact_part_id: None,
                    seal_plug_part_id: None,
                    image_side: None,
                    image_front: None,
                    image_back: None,
                    cavities: (1..=ways)
                        .map(|n| ConnectorDefCavity {
                            cavity_id: n.to_string(),
                            contact_size: family.contact_size.into(),
                        })
                        .collect(),
                });
            }
        }
    }
    for &(awg, od_in) in M22759_32 {
        let id = library.parts.len() as i64 + 1;
        library.parts.push(Part {
            id,
            part_number: format!("M22759/32-{awg}"),
            manufacturer: None,
            description: Some(format!(
                "{awg} AWG ETFE, 150 °C, 600 V (Raychem Spec 55) — color as per order code"
            )),
            category: "wire".into(),
            purchase_unit: "meter".into(),
            qty_per_pack: 1.0,
            price_usd: None,
            price_date: None,
        });
        library.wire_defs.push(WireDef {
            part_id: id,
            gauge: format!("{awg} AWG"),
            spec: Some("M22759/32".into()),
            color: None,
            outer_diameter_mm: (od_in * 25.4 * 100.0).round() / 100.0,
            default_cut_margin_pct: None,
            conductors: vec![],
        });
    }
    library
}

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
        .into_iter()
        .filter(|d| added.contains(&d.part_id))
    {
        merged.connector_defs.push(ConnectorDef {
            part_id: id_map[&def.part_id],
            counterpart_id: def.counterpart_id.map(|c| id_map[&c]),
            ..def
        });
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

fn empty_library() -> Library {
    Library {
        parts: vec![],
        connector_defs: vec![],
        device_defs: vec![],
        contact_defs: vec![],
        seal_plug_defs: vec![],
        wire_defs: vec![],
        splice_defs: vec![],
        component_defs: vec![],
        covering_defs: vec![],
        accessory_defs: vec![],
        t_mold_defs: vec![],
        signal_types: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn def_by_pn<'a>(library: &'a Library, part_number: &str) -> &'a ConnectorDef {
        let id = library
            .parts
            .iter()
            .find(|p| p.part_number == part_number)
            .unwrap()
            .id;
        library
            .connector_defs
            .iter()
            .find(|d| d.part_id == id)
            .unwrap()
    }

    #[test]
    fn builds_paired_families_with_their_cavities() {
        let base = base_library();
        assert_eq!(base.parts.len(), 2 * (6 + 6 + 2 + 5) + M22759_32.len());
        let dtm6s = def_by_pn(&base, "DTM06-6S");
        assert_eq!(dtm6s.gender, "female");
        assert_eq!(dtm6s.cavities.len(), 6);
        assert!(dtm6s.cavities.iter().all(|c| c.contact_size == "20"));
        let counterpart = base
            .parts
            .iter()
            .find(|p| Some(p.id) == dtm6s.counterpart_id)
            .unwrap();
        assert_eq!(counterpart.part_number, "DTM04-6P");
    }

    #[test]
    fn base_library_round_trips_through_sqlite_with_foreign_keys_on() {
        // Las contrapartes se apuntan mutuamente: guardar no puede depender del orden.
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        conn.execute_batch(crate::db::LIBRARY_SCHEMA).unwrap();
        let base = base_library();
        crate::model::library::save(&mut conn, &base).unwrap();
        assert_eq!(crate::model::library::load(&conn).unwrap(), base);
    }

    #[test]
    fn wires_carry_the_spec_outer_diameter_in_mm() {
        let base = base_library();
        let id = base
            .parts
            .iter()
            .find(|p| p.part_number == "M22759/32-22")
            .unwrap()
            .id;
        let wire = base.wire_defs.iter().find(|w| w.part_id == id).unwrap();
        assert_eq!(wire.gauge, "22 AWG");
        assert_eq!(wire.outer_diameter_mm, 1.09); // 0.043 in
                                                  // El calibre se entiende igual que cualquier cable cargado a mano.
        assert!(crate::gauge::gauge_to_mm2(&wire.gauge).is_some());
    }

    #[test]
    fn merging_keeps_existing_parts_and_never_duplicates() {
        let mut library = empty_library();
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
        // Ids únicos.
        let mut ids: Vec<i64> = once.parts.iter().map(|p| p.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), once.parts.len());

        let twice = merge_base_library(&once);
        assert_eq!(twice, once);
    }
}
