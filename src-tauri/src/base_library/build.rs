//! Arma la biblioteca base a partir del catálogo.

use super::catalog::{
    ATUM, BOOTS, BOOT_OVERLAP_MM, DR_25, FAMILIES, M22759_32, MATED_HOUSINGS, OTHER_HOUSINGS,
    SRG_LOOM, SUPERSEAL_10, SUPERSEAL_10_CAVITY_PLUG, SUPERSEAL_10_SOCKETS,
};
use crate::model::library::{
    AccessoryDef, AccessoryDefConnectorMatch, ConnectorDef, ConnectorDefCavity, ContactDef,
    CoveringDef, Library, Part, SealPlugDef, WireDef, WireDefConductor,
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
        let contact_ids = family.contacts.as_ref().map(|c| {
            let mut id_of = |pn: &str, gender: &str| {
                let id = push_part(
                    &mut library,
                    pn.into(),
                    family.manufacturer,
                    format!(
                        "{} size {} {} {} contact, {}–{} — {unverified}",
                        family.series,
                        family.contact_size,
                        c.kind,
                        if gender == "male" { "pin" } else { "socket" },
                        c.gauge_min,
                        c.gauge_max
                    ),
                    "contact",
                    "unit",
                );
                library.contact_defs.push(ContactDef {
                    part_id: id,
                    gender: gender.into(),
                    contact_size: family.contact_size.into(),
                    gauge_min: Some(c.gauge_min.into()),
                    gauge_max: Some(c.gauge_max.into()),
                });
                id
            };
            (id_of(c.pin, "male"), id_of(c.socket, "female"))
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
        // Un contacto que comparten varias carcasas se carga una sola vez.
        let contact_ids: Vec<i64> = h
            .contacts
            .iter()
            .map(|c| {
                if let Some(p) = library
                    .parts
                    .iter()
                    .find(|p| p.part_number == c.part_number)
                {
                    return p.id;
                }
                let id = push_part(
                    &mut library,
                    c.part_number.into(),
                    c.manufacturer,
                    format!("{} — {unverified}", c.description),
                    "contact",
                    "unit",
                );
                library.contact_defs.push(ContactDef {
                    part_id: id,
                    gender: h.gender.into(),
                    contact_size: h.contact_size.into(),
                    gauge_min: Some(c.gauge_min.into()),
                    gauge_max: Some(c.gauge_max.into()),
                });
                id
            })
            .collect();
        let contact_part_id = contact_ids.first().copied();
        let seal_plug_part_id = h.seal_plug.map(|pn| {
            if let Some(p) = library.parts.iter().find(|p| p.part_number == pn) {
                return p.id;
            }
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
    for &(male, female) in MATED_HOUSINGS {
        let id_of = |pn: &str| {
            library
                .parts
                .iter()
                .find(|p| p.part_number == pn)
                .unwrap()
                .id
        };
        let (male_id, female_id) = (id_of(male), id_of(female));
        for def in &mut library.connector_defs {
            if def.part_id == male_id {
                def.counterpart_id = Some(female_id);
            } else if def.part_id == female_id {
                def.counterpart_id = Some(male_id);
            }
        }
    }
    for loom in SRG_LOOM {
        let id = push_part(
            &mut library,
            loom.part_number.into(),
            "Marelli",
            format!("{} — {unverified}", loom.description),
            "connector",
            "unit",
        );
        library.connector_defs.push(ConnectorDef {
            part_id: id,
            gender: "female".into(),
            series: Some("Marelli SRG14x".into()),
            shell_size: None,
            counterpart_id: None,
            back_shape: None,
            back_diameter_mm: None,
            back_width_mm: None,
            back_height_mm: None,
            suggested_termination: None,
            contact_part_id: None,
            seal_plug_part_id: None,
            adhesive_heatshrink_length_mm: None,
            cavities: (1..=loom.ways)
                .map(|n| ConnectorDefCavity {
                    cavity_id: n.to_string(),
                    contact_size: loom
                        .sizes
                        .iter()
                        .find(|(_, ways)| ways.contains(&n))
                        .map_or("SRG signal", |(size, _)| size)
                        .into(),
                })
                .collect(),
        });
    }
    for boot in BOOTS {
        let id = push_part(
            &mut library,
            boot.part_number.into(),
            "TE / Raychem",
            format!("{} — {unverified}", boot.description),
            "accessory",
            "unit",
        );
        library.accessory_defs.push(AccessoryDef {
            part_id: id,
            orientation: boot.orientation.into(),
            cable_side_min_diameter_mm: boot.cable_min_mm,
            cable_side_max_diameter_mm: boot.cable_max_mm,
            leg_length_mm: boot.length_mm,
            overlap_mm: BOOT_OVERLAP_MM,
            compatible_connectors: boot
                .fits
                .iter()
                .map(|&(series, shell_size)| AccessoryDefConnectorMatch {
                    series: series.into(),
                    shell_size: shell_size.into(),
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
    // Par trenzado Ethernet (pedido de Martin, como el CAN y la termocupla del
    // taller): 2 conductores de 24 AWG; el color de cada uno se pone en el arnés.
    let ethernet = library.parts.len() as i64 + 1;
    library.parts.push(Part {
        id: ethernet,
        part_number: "ETHERNET TWISTED PAIR 24 AWG".into(),
        manufacturer: None,
        description: Some("Ethernet twisted pair, 2 x 24 AWG, unshielded (brand to confirm; OD provisional = 2 x 1.0 mm, measure the whole pair)".into()),
        category: "wire".into(),
        purchase_unit: "meter".into(),
        qty_per_pack: 1.0,
        price_usd: None,
        price_date: None,
    });
    library.wire_defs.push(WireDef {
        part_id: ethernet,
        gauge: "24 AWG".into(),
        spec: Some("Ethernet".into()),
        color: None,
        outer_diameter_mm: 2.0,
        default_cut_margin_pct: None,
        conductors: (1..=2)
            .map(|id| WireDefConductor {
                id,
                label: None,
                gauge: Some("24 AWG".into()),
                color: None,
                is_shield: false,
            })
            .collect(),
    });
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
        // carcasas + (pin, socket, tapón) de DT/DTM/DTP + (pin, socket) de Superseal 1.5
        // + cables + termos; los contactos que comparten carcasas sueltas, una vez.
        assert_eq!(
            base.parts.len(),
            2 * (6 + 6 + 2 + 5)
                + 3 * 3
                + 2
                + SUPERSEAL_10.len()
                + OTHER_HOUSINGS.len()
                + housing_contacts().len()
                + housing_seal_plugs().len()
                + SRG_LOOM.len()
                + BOOTS.len()
                + SUPERSEAL_10_SOCKETS.len()
                + 1
                + M22759_32.len()
                + 1
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
        assert_eq!(pn(def_by_pn(&base, "282080-1").contact_part_id), "282403-1");
        assert_eq!(pn(def_by_pn(&base, "282104-1").contact_part_id), "282404-1");
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
        assert_eq!(def_by_pn(&base, "1J0 973 724").gender, "female");
        assert_eq!(def_by_pn(&base, "1J0 973 733").gender, "female");
        assert_eq!(def_by_pn(&base, "SMPW-K-F").gender, "female");
    }

    #[test]
    fn part_numbers_are_unique() {
        let base = base_library();
        let mut numbers: Vec<&str> = base.parts.iter().map(|p| p.part_number.as_str()).collect();
        numbers.sort();
        let total = numbers.len();
        numbers.dedup();
        assert_eq!(numbers.len(), total);
    }

    #[test]
    fn housings_that_share_a_terminal_point_to_the_same_contact() {
        let base = base_library();
        let pn = |id: Option<i64>| {
            base.parts
                .iter()
                .find(|p| Some(p.id) == id)
                .map(|p| p.part_number.as_str())
        };
        let mini = def_by_pn(&base, "MINI TYMER 02W-F");
        assert_eq!(pn(mini.contact_part_id), Some("929931-1"));
        assert_eq!(
            def_by_pn(&base, "ORIGINAL 03W_F").contact_part_id,
            mini.contact_part_id
        );
        assert_eq!(
            def_by_pn(&base, "1J0 973 724").contact_part_id,
            mini.contact_part_id
        );
        // El de 0,5–1,0 mm² queda en la biblioteca, del mismo tamaño y género, para los 20 AWG.
        let jpt_big = base
            .parts
            .iter()
            .find(|p| p.part_number == "929930-1")
            .unwrap()
            .id;
        let contact = base
            .contact_defs
            .iter()
            .find(|c| c.part_id == jpt_big)
            .unwrap();
        assert_eq!(
            (contact.gender.as_str(), contact.contact_size.as_str()),
            ("female", "Mini Timer")
        );
        // La lambda LSU 4.9: ficha Bosch con terminales MCP 1.5K.
        let lsu49 = def_by_pn(&base, "1 928 404 669");
        assert_eq!(lsu49.cavities.len(), 6);
        assert_eq!(pn(lsu49.contact_part_id), Some("1241379-1"));
    }

    #[test]
    fn engine_receptacle_mates_the_plug_and_shares_its_seal_plug() {
        let base = base_library();
        let plug = def_by_pn(&base, "MS3476L24-61P");
        let receptacle = def_by_pn(&base, "MS3470A24-61S");
        assert_eq!(receptacle.gender, "female");
        assert_eq!(plug.counterpart_id, Some(receptacle.part_id));
        assert_eq!(receptacle.counterpart_id, Some(plug.part_id));
        assert_eq!(receptacle.seal_plug_part_id, plug.seal_plug_part_id);
        assert_ne!(receptacle.contact_part_id, plug.contact_part_id);
        assert_eq!(receptacle.cavities, plug.cavities);
    }

    #[test]
    fn interco_plug_has_the_41_cavities_of_its_insert_and_the_size_20_pin() {
        let base = base_library();
        let plug = def_by_pn(&base, "MS3476A20-41P");
        assert_eq!(
            (plug.gender.as_str(), plug.shell_size.as_deref()),
            ("male", Some("20"))
        );
        assert_eq!(plug.cavities.len(), 41);
        let has = |id: &str| plug.cavities.iter().any(|c| c.cavity_id == id);
        assert!(has("t") && has("N") && has("n") && !has("l") && !has("I"));
        let engine = def_by_pn(&base, "MS3476L24-61P");
        assert_eq!(plug.contact_part_id, engine.contact_part_id);
        assert_eq!(plug.seal_plug_part_id, engine.seal_plug_part_id);
    }

    #[test]
    fn srg_loom_connectors_carry_the_cavity_sizes_of_the_sheet() {
        let base = base_library();
        let count = |pn: &str, size: &str| {
            def_by_pn(&base, pn)
                .cavities
                .iter()
                .filter(|c| c.contact_size == size)
                .count()
        };
        assert_eq!(def_by_pn(&base, "SRG14x LOOM A").cavities.len(), 105);
        assert_eq!(count("SRG14x LOOM A", "SRG medium"), 20);
        assert_eq!(count("SRG14x LOOM A", "SRG signal"), 85);
        assert_eq!(def_by_pn(&base, "SRG14x LOOM K").cavities.len(), 91);
        assert_eq!(count("SRG14x LOOM K", "SRG power"), 6);
        assert_eq!(count("SRG14x LOOM K", "SRG medium"), 10);
        assert_eq!(count("SRG14x LOOM K", "SRG signal"), 75);
    }

    #[test]
    fn boots_are_loaded_and_size_63_fits_the_shell_24_engine_connector() {
        let base = base_library();
        assert_eq!(base.accessory_defs.len(), BOOTS.len());
        let plug = def_by_pn(&base, "MS3476L24-61P");
        let fitting = base
            .accessory_defs
            .iter()
            .filter(|a| {
                a.compatible_connectors.iter().any(|m| {
                    Some(m.series.as_str()) == plug.series.as_deref()
                        && Some(m.shell_size.as_str()) == plug.shell_size.as_deref()
                })
            })
            .count();
        assert_eq!(fitting, 2);
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
            (Some("M39029/4-110"), Some("MS27488-20"))
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
