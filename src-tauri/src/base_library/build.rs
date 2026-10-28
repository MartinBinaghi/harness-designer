//! Arma la biblioteca base a partir del catálogo.

use super::catalog::{
    ATUM, DR_25, FAMILIES, M22759_32, OTHER_HOUSINGS, SUPERSEAL_10, SUPERSEAL_10_CAVITY_PLUG,
    SUPERSEAL_10_SOCKETS,
};
use crate::model::library::{
    ConnectorDef, ConnectorDefCavity, ContactDef, CoveringDef, Library, Part, SealPlugDef, WireDef,
};

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
    let mut library = Library::default();
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
            cavities: (1..=ways)
                .map(|n| ConnectorDefCavity {
                    cavity_id: n.to_string(),
                    contact_size: "1.0".into(),
                })
                .collect(),
        });
    }
    for h in OTHER_HOUSINGS {
        let contact_part_id = h.contact.map(|(pn, gauge_min, gauge_max)| {
            let id = push_part(
                &mut library,
                pn.into(),
                h.manufacturer,
                format!(
                    "{} size {} {} contact, {gauge_min}–{gauge_max} — {unverified}",
                    h.series,
                    h.contact_size,
                    if h.gender == "male" { "pin" } else { "socket" }
                ),
                "contact",
                "unit",
            );
            library.contact_defs.push(ContactDef {
                part_id: id,
                gender: h.gender.into(),
                contact_size: h.contact_size.into(),
                gauge_min: Some(gauge_min.into()),
                gauge_max: Some(gauge_max.into()),
            });
            id
        });
        let seal_plug_part_id = h.seal_plug.map(|pn| {
            let id = push_part(
                &mut library,
                pn.into(),
                h.manufacturer,
                format!(
                    "{} size {} sealing plug — {unverified}",
                    h.series, h.contact_size
                ),
                "seal_plug",
                "unit",
            );
            library.seal_plug_defs.push(SealPlugDef {
                part_id: id,
                contact_size: h.contact_size.into(),
            });
            id
        });
        let id = push_part(
            &mut library,
            h.part_number.into(),
            h.manufacturer,
            format!("{} — {unverified}", h.description),
            "connector",
            "unit",
        );
        library.connector_defs.push(ConnectorDef {
            part_id: id,
            gender: h.gender.into(),
            series: Some(h.series.into()),
            shell_size: h.shell_size.map(Into::into),
            counterpart_id: None,
            back_shape: None,
            back_diameter_mm: None,
            back_width_mm: None,
            back_height_mm: None,
            suggested_termination: h.suggested_termination.map(Into::into),
            contact_part_id,
            seal_plug_part_id,
            adhesive_heatshrink_length_mm: None,
            cavities: h
                .cavities
                .iter()
                .map(|&cavity_id| ConnectorDefCavity {
                    cavity_id: cavity_id.into(),
                    contact_size: h.contact_size.into(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::base_library::test_fixtures::*;

    #[test]
    fn builds_paired_families_with_their_cavities() {
        let base = base_library();
        // carcasas + (pin, socket, tapón) de DT/DTM/DTP + cables + termos
        assert_eq!(
            base.parts.len(),
            2 * (6 + 6 + 2 + 5)
                + 3 * 3
                + SUPERSEAL_10.len()
                + OTHER_HOUSINGS.len()
                + OTHER_HOUSINGS
                    .iter()
                    .filter(|h| h.contact.is_some())
                    .count()
                + OTHER_HOUSINGS
                    .iter()
                    .filter(|h| h.seal_plug.is_some())
                    .count()
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
        let tc: Vec<&str> = def_by_pn(&base, "SMPW-K-F")
            .cavities
            .iter()
            .map(|c| c.cavity_id.as_str())
            .collect();
        assert_eq!(tc, ["+", "-"]);
        assert_eq!(def_by_pn(&base, "1J0 973 733").cavities.len(), 6);
        assert_eq!(def_by_pn(&base, "1J0 973 724").gender, "male");
        assert_eq!(def_by_pn(&base, "SMPW-K-F").gender, "female");
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
    fn engine_connector_comes_with_its_contact_and_seal_plug() {
        let base = base_library();
        let ms = def_by_pn(&base, "MS3476L24-61P");
        assert_eq!(ms.cavities.len(), 61);
        assert_eq!(
            ms.cavities
                .iter()
                .filter(|c| c.cavity_id == "N" || c.cavity_id == "n")
                .count(),
            2
        ); // distingue mayúsculas
        let pn = |id: Option<i64>| {
            base.parts
                .iter()
                .find(|p| Some(p.id) == id)
                .map(|p| p.part_number.as_str())
        };
        assert_eq!(
            (pn(ms.contact_part_id), pn(ms.seal_plug_part_id)),
            (Some("M39029/58-360"), Some("MS27488-20"))
        );
        assert_eq!(
            def_by_pn(&base, "ORIGINAL 03W_F")
                .cavities
                .iter()
                .map(|c| c.cavity_id.as_str())
                .collect::<Vec<_>>(),
            ["A", "B", "C"]
        );
    }
}
