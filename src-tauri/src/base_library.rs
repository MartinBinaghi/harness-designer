//! Biblioteca base: carcasas de conectores estandarizados (Deutsch DT/DTM/DTP,
//! TE Superseal 1.5) con el contacto y el tapón de cada familia Deutsch, cable
//! M22759/32 y termocontraíble Raychem (DR-25 sin adhesivo, ATUM con adhesivo),
//! para no cargar a mano lo que es igual en todos los proyectos. Ver
//! docs/BITACORA.md, decisión "Biblioteca base".
//!
//! Conectores, contactos, tapones y termos: cargados sin datasheet a la vista;
//! cada parte lo dice en su descripción ("unverified") hasta que se confirme.
//! Cables: diámetro nominal de la hoja M22759/32 (NASA NEPP, coincide con la
//! tabla publicada por los fabricantes). Precio y medidas traseras quedan
//! vacíos a propósito: dependen del proveedor y del datasheet.

use crate::model::library::{
    ConnectorDef, ConnectorDefCavity, ContactDef, CoveringDef, Library, Part, SealPlugDef, WireDef,
};
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
    /// Contacto sólido de la familia (pin, socket, calibre mín., calibre máx.) y tapón de
    /// la familia; un solo contacto por familia (plan 4.1).
    contacts: Option<(&'static str, &'static str, &'static str, &'static str)>,
    seal_plug: Option<&'static str>,
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
        contacts: Some(("0460-202-16141", "0462-201-16141", "20 AWG", "16 AWG")),
        seal_plug: Some("0413-217-1605"),
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
        contacts: Some(("0460-202-20141", "0462-201-20141", "24 AWG", "20 AWG")),
        seal_plug: Some("0413-204-2005"),
    },
    Family {
        manufacturer: "TE / Deutsch",
        series: "DTP",
        contact_size: "12",
        suggested_termination: Some("adhesive_heatshrink"),
        members: &[(2, "DTP04-2P", "DTP06-2S"), (4, "DTP04-4P", "DTP06-4S")],
        male_kind: "receptacle, pin contacts",
        female_kind: "plug, socket contacts",
        contacts: Some(("0460-204-12141", "0462-203-12141", "14 AWG", "12 AWG")),
        seal_plug: Some("0413-003-1205"),
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
        // Superseal: terminales y sellos individuales todavía sin cargar.
        contacts: None,
        seal_plug: None,
    },
];

/// Carcasas sueltas, sin contraparte en la base: el AMP Superseal 1.0 hembra
/// que enchufa en el MoTeC PDM30 (A 34 vías, B 26) y la línea M1; el macho va
/// en el dispositivo. (número de parte, vías, uso).
const SUPERSEAL_10: &[(&str, usize, &str)] = &[
    ("3-1437290-7", 26, "mates MoTeC PDM30 B / M1 26-pin"),
    ("4-1437290-0", 34, "mates MoTeC PDM30 A / M1 34-pin"),
];

/// Pines hembra (sockets) Superseal 1.0: número de parte y rango de calibre.
/// El de 20 AWG es el de las carcasas; con otro calibre, contacts.rs elige el
/// que corresponde (mismo tamaño y género).
const SUPERSEAL_10_SOCKETS: &[(&str, &str, &str)] = &[
    ("3-1447221-4", "20 AWG", "20 AWG"),
    ("3-1447221-5", "22 AWG", "22 AWG"),
    ("3-1447221-3", "18 AWG", "16 AWG"),
];
const SUPERSEAL_10_CAVITY_PLUG: &str = "4-1437284-3";

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

/// Raychem DR-25 (2:1, sin adhesivo): medida nominal, suministrado mín.,
/// contraído máx. y pared contraída, en pulgadas.
const DR_25: &[(&str, f64, f64, f64)] = &[
    ("1/8", 0.125, 0.063, 0.020),
    ("3/16", 0.187, 0.093, 0.020),
    ("1/4", 0.250, 0.125, 0.025),
    ("3/8", 0.375, 0.187, 0.025),
    ("1/2", 0.500, 0.250, 0.030),
    ("3/4", 0.750, 0.375, 0.035),
    ("1", 1.000, 0.500, 0.040),
];

/// Raychem ATUM (3:1, con adhesivo), para la pieza que pasa por detrás del
/// conector: suministrado / contraído en mm (van en el nombre) y pared
/// contraída aproximada (camisa + adhesivo).
const ATUM: &[(f64, f64, f64)] = &[
    (6.0, 2.0, 1.0),
    (12.0, 4.0, 1.6),
    (19.0, 6.0, 1.9),
    (24.0, 8.0, 2.2),
    (40.0, 13.0, 2.5),
];

fn push_part(
    library: &mut Library,
    part_number: String,
    manufacturer: &str,
    description: String,
    category: &str,
    unit: &str,
) -> i64 {
    let id = library.parts.len() as i64 + 1;
    library.parts.push(Part {
        id,
        part_number,
        manufacturer: Some(manufacturer.into()),
        description: Some(description),
        category: category.into(),
        purchase_unit: unit.into(),
        qty_per_pack: 1.0,
        price_usd: None,
        price_date: None,
    });
    id
}

/// La biblioteca base sola, con ids desde 1. Cada macho tiene como
/// contraparte a su hembra y viceversa; cada carcasa Deutsch lleva el contacto
/// de su género y el tapón de su familia.
pub fn base_library() -> Library {
    let mut library = empty_library();
    for family in FAMILIES {
        let unverified = "base library, unverified: check datasheet";
        let contact_ids = family.contacts.map(|(pin, socket, gauge_min, gauge_max)| {
            let mut id_of = |pn: &str, gender: &str| {
                let id = push_part(
                    &mut library,
                    pn.into(),
                    family.manufacturer,
                    format!(
                        "{} size {} solid {} contact, {}–{} — {unverified}",
                        family.series,
                        family.contact_size,
                        if gender == "male" { "pin" } else { "socket" },
                        gauge_min,
                        gauge_max
                    ),
                    "contact",
                    "unit",
                );
                library.contact_defs.push(ContactDef {
                    part_id: id,
                    gender: gender.into(),
                    contact_size: family.contact_size.into(),
                    gauge_min: Some(gauge_min.into()),
                    gauge_max: Some(gauge_max.into()),
                });
                id
            };
            (id_of(pin, "male"), id_of(socket, "female"))
        });
        let seal_plug_id = family.seal_plug.map(|pn| {
            let id = push_part(
                &mut library,
                pn.into(),
                family.manufacturer,
                format!(
                    "{} size {} sealing plug — {unverified}",
                    family.series, family.contact_size
                ),
                "seal_plug",
                "unit",
            );
            library.seal_plug_defs.push(SealPlugDef {
                part_id: id,
                contact_size: family.contact_size.into(),
            });
            id
        });
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
                    contact_part_id: contact_ids
                        .map(|(pin, socket)| if gender == "male" { pin } else { socket }),
                    seal_plug_part_id: seal_plug_id,
                    adhesive_heatshrink_length_mm: None,
                    image_side: None,
                    image_front: None,
                    image_back: None,
                    cavities: (1..=ways)
                        .map(|n| ConnectorDefCavity {
                            cavity_id: cavity_label(family.series, ways, n),
                            contact_size: family.contact_size.into(),
                        })
                        .collect(),
                });
            }
        }
    }
    let unverified = "base library, unverified: check datasheet";
    let socket_ids: Vec<i64> = SUPERSEAL_10_SOCKETS
        .iter()
        .map(|&(part_number, gauge_min, gauge_max)| {
            let range = if gauge_min == gauge_max {
                gauge_min.to_string()
            } else {
                format!("{gauge_min}–{gauge_max}")
            };
            let id = push_part(
                &mut library,
                part_number.into(),
                "TE",
                format!("Superseal 1.0 socket (female) contact, {range} — {unverified}"),
                "contact",
                "unit",
            );
            library.contact_defs.push(ContactDef {
                part_id: id,
                gender: "female".into(),
                contact_size: "1.0".into(),
                gauge_min: Some(gauge_min.into()),
                gauge_max: Some(gauge_max.into()),
            });
            id
        })
        .collect();
    let plug_id = push_part(
        &mut library,
        SUPERSEAL_10_CAVITY_PLUG.into(),
        "TE",
        format!("Superseal 1.0 cavity plug — {unverified}"),
        "seal_plug",
        "unit",
    );
    library.seal_plug_defs.push(SealPlugDef {
        part_id: plug_id,
        contact_size: "1.0".into(),
    });
    for &(part_number, ways, mates) in SUPERSEAL_10 {
        let id = push_part(
            &mut library,
            part_number.into(),
            "TE",
            format!("Superseal 1.0 {ways}-way housing for female terminals, {mates} — base library, unverified: check datasheet"),
            "connector",
            "unit",
        );
        library.connector_defs.push(ConnectorDef {
            part_id: id,
            gender: "female".into(),
            series: Some("Superseal 1.0".into()),
            shell_size: None,
            counterpart_id: None,
            back_shape: None,
            back_diameter_mm: None,
            back_width_mm: None,
            back_height_mm: None,
            suggested_termination: None,
            contact_part_id: Some(socket_ids[0]),
            seal_plug_part_id: Some(plug_id),
            adhesive_heatshrink_length_mm: None,
            image_side: None,
            image_front: None,
            image_back: None,
            cavities: (1..=ways)
                .map(|n| ConnectorDefCavity {
                    cavity_id: n.to_string(),
                    contact_size: "1.0".into(),
                })
                .collect(),
        });
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
    for &(size, supplied, shrunk, wall) in DR_25 {
        let id = push_part(&mut library, format!("DR-25-{size}"), "TE / Raychem", format!("DR-25 {size}\" heat-shrink 2:1, no adhesive — base library, unverified: check datasheet"), "covering", "meter");
        library.covering_defs.push(CoveringDef {
            part_id: id,
            supplied_diameter_mm: inch_to_mm(supplied),
            shrunk_diameter_mm: inch_to_mm(shrunk),
            shrunk_wall_thickness_mm: inch_to_mm(wall),
            has_adhesive: false,
        });
    }
    for &(supplied, shrunk, wall) in ATUM {
        let id = push_part(&mut library, format!("ATUM-{supplied}/{shrunk}"), "TE / Raychem", format!("ATUM {supplied}/{shrunk} mm heat-shrink 3:1 with adhesive — base library, unverified: check datasheet"), "covering", "meter");
        library.covering_defs.push(CoveringDef {
            part_id: id,
            supplied_diameter_mm: supplied,
            shrunk_diameter_mm: shrunk,
            shrunk_wall_thickness_mm: wall,
            has_adhesive: true,
        });
    }
    library
}

/// Identificador de la vía `n`: el número, salvo el DT de 3 vías, que va
/// marcado A, B, C (confirmado por Martin, 2026-10-08).
fn cavity_label(series: &str, ways: usize, n: usize) -> String {
    if series == "DT" && ways == 3 {
        char::from(b'A' + n as u8 - 1).to_string()
    } else {
        n.to_string()
    }
}

fn inch_to_mm(inches: f64) -> f64 {
    (inches * 25.4 * 100.0).round() / 100.0
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
        // carcasas + (pin, socket, tapón) de DT/DTM/DTP + cables + termos
        assert_eq!(
            base.parts.len(),
            2 * (6 + 6 + 2 + 5)
                + 3 * 3
                + SUPERSEAL_10.len()
                + SUPERSEAL_10_SOCKETS.len()
                + 1
                + M22759_32.len()
                + DR_25.len()
                + ATUM.len()
        );
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
        // La hembra lleva el socket de la familia; el macho, el pin; los dos, el tapón.
        let pn = |id: Option<i64>| {
            base.parts
                .iter()
                .find(|p| Some(p.id) == id)
                .unwrap()
                .part_number
                .clone()
        };
        assert_eq!(pn(dtm6s.contact_part_id), "0462-201-20141");
        assert_eq!(
            pn(def_by_pn(&base, "DTM04-6P").contact_part_id),
            "0460-202-20141"
        );
        assert_eq!(pn(dtm6s.seal_plug_part_id), "0413-204-2005");
        assert!(def_by_pn(&base, "282080-1").contact_part_id.is_none());
        // Superseal 1.0 (PDM30): socket de 20 AWG y tapón de la familia.
        let ss34 = def_by_pn(&base, "4-1437290-0");
        assert_eq!(pn(ss34.contact_part_id), "3-1447221-4");
        assert_eq!(pn(ss34.seal_plug_part_id), "4-1437284-3");
        let dt3: Vec<&str> = def_by_pn(&base, "DT06-3S")
            .cavities
            .iter()
            .map(|c| c.cavity_id.as_str())
            .collect();
        assert_eq!(dt3, ["A", "B", "C"]);
    }

    #[test]
    fn heat_shrink_sizes_read_as_their_nominal_inches() {
        let base = base_library();
        let id = base
            .parts
            .iter()
            .find(|p| p.part_number == "DR-25-3/16")
            .unwrap()
            .id;
        let hs = base.covering_defs.iter().find(|c| c.part_id == id).unwrap();
        assert_eq!(
            (
                hs.supplied_diameter_mm,
                hs.shrunk_diameter_mm,
                hs.has_adhesive
            ),
            (4.75, 2.36, false)
        );
        assert!(base.covering_defs.iter().any(|c| c.has_adhesive));
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
        // El contacto de la carcasa nueva apunta a la parte agregada.
        let pin = once
            .parts
            .iter()
            .find(|p| p.part_number == "0460-202-20141")
            .unwrap()
            .id;
        assert_eq!(def_by_pn(&once, "DTM04-6P").contact_part_id, Some(pin));
        assert_eq!(once.contact_defs.len(), 6 + SUPERSEAL_10_SOCKETS.len());
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
        let mut old = empty_library();
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
}
