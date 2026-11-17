//! Chequeos de la carga eléctrica (ver `calc::electrical`): corriente contra la
//! capacidad del cable y del contacto, caída de tensión contra el límite del
//! arnés, consumos que no cierran en un splice y datos de biblioteca que faltan
//! para poder chequear.
//!
//! Que el consumo pase la capacidad es un error (el cable o el contacto
//! trabajan por encima de lo que aguantan); que la pase la protección es un
//! aviso: la protección no cuida a ese cable, que es lo que el diseño tiene que
//! evitar, pero no quiere decir que se queme en uso normal.

use super::{error, warning, Finding, FindingTarget};
use crate::calc::{electrical_report, ElectricalReport, SpliceIssue};
use crate::model::library::Library;
use crate::model::project::{ProjectData, WireInstance};
use std::collections::BTreeMap;

/// Margen para comparar corrientes y tensiones cargadas con decimales.
const EPS: f64 = 1e-9;

fn wire_label(w: &WireInstance) -> String {
    match w
        .specific_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        Some(name) => format!("{} ({name})", w.short_id),
        None => w.short_id.clone(),
    }
}

fn part_number(library: &Library, part_id: i64) -> String {
    library
        .parts
        .iter()
        .find(|p| p.id == part_id)
        .map_or_else(|| format!("part #{part_id}"), |p| p.part_number.clone())
}

fn wires_with_report<'a>(
    data: &'a ProjectData,
    report: &'a ElectricalReport,
) -> impl Iterator<Item = (&'a WireInstance, &'a crate::calc::WireElectrical)> {
    data.wire_instances.iter().filter_map(move |w| {
        report
            .wires
            .iter()
            .find(|e| e.wire_id == w.id)
            .map(|e| (w, e))
    })
}

pub(super) fn check_wire_current(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let report = electrical_report(data, library);
    let mut findings = Vec::new();
    for (w, e) in wires_with_report(data, &report) {
        let Some(max) = e.max_current_a else { continue };
        let wire_type = part_number(library, w.library_part_id);
        if let Some(load) = e.load_a.filter(|&a| a > max + EPS) {
            findings.push(
                error(format!(
                    "{} carries {load:.1} A but {wire_type} takes {max:.1} A in a bundle",
                    wire_label(w)
                ))
                .at(FindingTarget::Wire { id: w.id }),
            );
        } else if let Some(protection) = e.protection_a.filter(|&a| a > max + EPS) {
            findings.push(
                warning(format!(
                    "{} is fed through a {protection:.1} A protection but {wire_type} takes {max:.1} A: the protection doesn't cover this wire",
                    wire_label(w)
                ))
                .at(FindingTarget::Wire { id: w.id }),
            );
        }
    }
    findings
}

pub(super) fn check_contact_current(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let report = electrical_report(data, library);
    let mut findings = Vec::new();
    for c in &report.cavities {
        let (Some(max), Some(contact)) = (c.max_current_a, c.contact_part_id) else {
            continue;
        };
        let Some(connector) = data
            .connector_instances
            .iter()
            .find(|x| x.id == c.connector_instance_id)
        else {
            continue;
        };
        let pin = connector
            .cavities
            .iter()
            .find(|cav| cav.id == c.cavity_assignment_id)
            .map_or("?", |cav| cav.cavity_id.as_str());
        let where_ = format!("{}:{pin}", connector.short_id);
        let contact = part_number(library, contact);
        let target = FindingTarget::Connector { id: connector.id };
        if let Some(load) = c.load_a.filter(|&a| a > max + EPS) {
            findings.push(
                error(format!(
                    "{where_}: {load:.1} A through its contact, but {contact} takes {max:.1} A"
                ))
                .at(target),
            );
        } else if let Some(protection) = c.protection_a.filter(|&a| a > max + EPS) {
            findings.push(
                warning(format!(
                    "{where_}: fed through a {protection:.1} A protection, but its contact {contact} takes {max:.1} A"
                ))
                .at(target),
            );
        }
    }
    findings
}

pub(super) fn check_voltage_drop(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let report = electrical_report(data, library);
    let limit = data.project.voltage_drop_limit_v;
    wires_with_report(data, &report)
        .filter(|(_, e)| e.ends_at_load)
        .filter_map(|(w, e)| {
            let drop = e.circuit_drop_v.filter(|&v| v > limit + EPS)?;
            Some(
                warning(format!(
                    "{}: {drop:.2} V drop from the source to its end (limit {limit:.2} V)",
                    wire_label(w)
                ))
                .at(FindingTarget::Wire { id: w.id }),
            )
        })
        .collect()
}

pub(super) fn check_splice_currents(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let report = electrical_report(data, library);
    let splice_name = |id: i64| {
        data.splice_instances
            .iter()
            .find(|s| s.id == id)
            .map_or_else(|| format!("SP#{id}"), |s| s.short_id.clone())
    };
    let wire_name = |id: i64| {
        data.wire_instances
            .iter()
            .find(|w| w.id == id)
            .map_or_else(String::new, |w| w.short_id.clone())
    };
    report
        .splice_issues
        .iter()
        .map(|issue| match issue {
            SpliceIssue::MissingLoads {
                splice_id,
                wire_ids,
            } => {
                let wires: Vec<String> = wire_ids.iter().map(|&id| wire_name(id)).collect();
                warning(format!(
                    "{}: {} wires without load ({}): how the current splits can't be worked out; set their load by hand (an equal share each if they're in parallel)",
                    splice_name(*splice_id),
                    wires.len(),
                    wires.join(", ")
                ))
                .at(FindingTarget::Splice { id: *splice_id })
            }
            SpliceIssue::Unbalanced { splice_id } => {
                let mut loads: Vec<(f64, String)> = data
                    .wire_instances
                    .iter()
                    .filter(|w| [&w.end_a, &w.end_b].iter().any(|e| e.kind == "splice" && e.splice_id == Some(*splice_id)))
                    .filter_map(|w| {
                        let e = report.wires.iter().find(|e| e.wire_id == w.id)?;
                        Some((e.load_a?, w.short_id.clone()))
                    })
                    .collect();
                loads.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
                let listed: Vec<String> = loads.iter().map(|(a, w)| format!("{w} {a:.1} A")).collect();
                warning(format!(
                    "{}: the currents don't add up ({}): no wire, nor group of wires in parallel, carries what the rest do",
                    splice_name(*splice_id),
                    listed.join(", ")
                ))
                .at(FindingTarget::Splice { id: *splice_id })
            }
            SpliceIssue::UnknownFeed { splice_id } => warning(format!(
                "{}: more than one group of wires carries what the rest do, so it can't tell which feed it; set the protection (PDM channel or fuse) on the ones that do",
                splice_name(*splice_id)
            ))
            .at(FindingTarget::Splice { id: *splice_id }),
        })
        .collect()
}

/// Partes de la biblioteca sin el dato que hace falta para chequear un cable o
/// contacto que tiene corriente: un aviso por parte, apuntando al primer cable
/// o conector afectado (sin esto, el chequeo pasaría callado).
pub(super) fn check_missing_electrical_data(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let report = electrical_report(data, library);
    // parte -> (qué falta, cuántos, el primero)
    let mut missing: BTreeMap<(i64, &str), (usize, FindingTarget)> = BTreeMap::new();
    let mut note = |part: i64, what: &'static str, target: FindingTarget| {
        missing.entry((part, what)).or_insert((0, target)).0 += 1;
    };
    for (w, e) in wires_with_report(data, &report) {
        let has_current = e.load_a.is_some() || e.protection_a.is_some();
        if has_current && e.max_current_a.is_none() {
            note(
                w.library_part_id,
                "max current",
                FindingTarget::Wire { id: w.id },
            );
        }
        if e.load_a.is_some() && e.resistance_mohm_per_m.is_none() {
            note(
                w.library_part_id,
                "resistance",
                FindingTarget::Wire { id: w.id },
            );
        }
    }
    for c in &report.cavities {
        if let (Some(contact), None) = (c.contact_part_id, c.max_current_a) {
            note(
                contact,
                "max current",
                FindingTarget::Connector {
                    id: c.connector_instance_id,
                },
            );
        }
    }
    missing
        .into_iter()
        .map(|((part, what), (count, target))| {
            let things = if matches!(target, FindingTarget::Connector { .. }) {
                if count == 1 {
                    "pin"
                } else {
                    "pins"
                }
            } else if count == 1 {
                "wire"
            } else {
                "wires"
            };
            warning(format!(
                "{} has no {what} in the library: {count} {things} with current can't be checked",
                part_number(library, part)
            ))
            .at(target)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checks::test_fixtures::*;
    use crate::model::library::ContactDef;

    /// X1:1 -W1 (1 m)- SP1 -W2 (4 m)- X2:1. 22 AWG: 5 A, 53,15 mΩ/m; largos a mano.
    fn setup() -> (ProjectData, Library) {
        let mut data = segment_with_one_wire();
        let template = data.wire_instances[0].clone();
        data.wire_instances = vec![
            WireInstance {
                id: 1,
                short_id: "W001".into(),
                specific_name: Some("12V+ coils".into()),
                manual_length_mm: Some(1000.0),
                end_a: end("cavity", Some(1), None, None, None),
                end_b: end("splice", None, Some(1), None, None),
                ..template.clone()
            },
            WireInstance {
                id: 2,
                short_id: "W002".into(),
                specific_name: Some("Coil 1".into()),
                manual_length_mm: Some(4000.0),
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("cavity", Some(2), None, None, None),
                ..template
            },
        ];
        let mut library = library_with_wire_def(1.1);
        library.wire_defs[0].max_current_a = Some(5.0);
        library.wire_defs[0].resistance_mohm_per_m = Some(53.15);
        library.parts.push(crate::model::library::Part {
            id: 100,
            part_number: "M22759/32-22".into(),
            manufacturer: None,
            description: None,
            category: "wire".into(),
            purchase_unit: "meter".into(),
            qty_per_pack: 1.0,
            price_usd: None,
            price_date: None,
        });
        (data, library)
    }

    #[test]
    fn a_load_over_the_wire_capacity_is_an_error_a_protection_over_it_a_warning() {
        let (mut data, library) = setup();
        data.wire_instances[1].load_current_a = Some(6.0);
        let found = check_wire_current(&data, &library);
        assert_eq!(found.len(), 2, "{found:?}"); // W2 6 A y W1, que lleva la suma
        assert!(found.iter().all(|f| f.severity == "error"));
        assert!(
            found[1]
                .message
                .contains("W002 (Coil 1) carries 6.0 A but M22759/32-22 takes 5.0 A"),
            "{}",
            found[1].message
        );

        data.wire_instances[1].load_current_a = Some(2.0);
        data.wire_instances[0].protection_current_a = Some(15.0);
        let found = check_wire_current(&data, &library);
        assert_eq!(
            found.len(),
            2,
            "la protección del circuito llega a W2: {found:?}"
        );
        assert!(found.iter().all(|f| f.severity == "warning"));
        assert!(found[0].message.contains("15.0 A protection"));
    }

    #[test]
    fn the_drop_is_checked_at_the_load_against_the_harness_limit() {
        let (mut data, library) = setup();
        // 2 A: W2 2 × 0,05315 × 4 = 0,425 V; W1 0,106 V; en la carga 0,53 V.
        data.wire_instances[1].load_current_a = Some(2.0);
        let found = check_voltage_drop(&data, &library);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(
            found[0].message.starts_with("W002 (Coil 1): 0.53 V drop"),
            "{}",
            found[0].message
        );
        assert_eq!(found[0].target, Some(FindingTarget::Wire { id: 2 }));
        data.project.voltage_drop_limit_v = 0.6;
        assert!(check_voltage_drop(&data, &library).is_empty());
    }

    #[test]
    fn currents_that_dont_add_up_point_at_the_splice() {
        let (mut data, library) = setup();
        data.wire_instances[0].load_current_a = Some(5.0);
        data.wire_instances[1].load_current_a = Some(2.0);
        let found = check_splice_currents(&data, &library);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].target, Some(FindingTarget::Splice { id: 1 }));
        assert_eq!(
            found[0].message,
            "SP#1: the currents don't add up (W001 5.0 A, W002 2.0 A): no wire, nor group of wires in parallel, carries what the rest do"
        );
    }

    #[test]
    fn a_contact_over_its_rating_and_missing_data_are_reported() {
        let (mut data, mut library) = setup();
        let connector_part = data.connector_instances[0].library_part_id;
        let contact = 900;
        library.parts.push(crate::model::library::Part {
            id: contact,
            part_number: "0462-201-20141".into(),
            manufacturer: None,
            description: None,
            category: "contact".into(),
            purchase_unit: "unit".into(),
            qty_per_pack: 1.0,
            price_usd: None,
            price_date: None,
        });
        library.contact_defs.push(ContactDef {
            part_id: contact,
            gender: "female".into(),
            contact_size: "20".into(),
            gauge_min: None,
            gauge_max: None,
            max_current_a: Some(7.5),
        });
        library
            .connector_defs
            .push(connector_def_with_contact(connector_part, contact));
        data.wire_instances[1].load_current_a = Some(4.0);
        data.wire_instances[0].protection_current_a = Some(10.0);
        let found = check_contact_current(&data, &library);
        assert_eq!(found.len(), 2, "{found:?}"); // X1:1 y X2:1, protegidos a 10 A
        assert!(
            found[0].message.starts_with(
                "X1:1: fed through a 10.0 A protection, but its contact 0462-201-20141 takes 7.5 A"
            ),
            "{}",
            found[0].message
        );
        assert!(found.iter().all(|f| f.severity == "warning"));

        // Sin el dato de la biblioteca, no se chequea, pero se avisa una vez por parte.
        library.contact_defs[0].max_current_a = None;
        library.wire_defs[0].max_current_a = None;
        assert!(check_contact_current(&data, &library).is_empty());
        let missing = check_missing_electrical_data(&data, &library);
        assert_eq!(missing.len(), 2, "{missing:?}");
        assert!(missing.iter().any(|f| f
            .message
            .starts_with("0462-201-20141 has no max current in the library: 2 pins")));
    }
}
