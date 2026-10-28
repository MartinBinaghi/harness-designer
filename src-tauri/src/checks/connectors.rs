//! Chequeos de conectores: pendientes, tapones, contactos, calibre y diámetro trasero (plan 12).

use super::{error, warning, Finding, FindingTarget};
use crate::model::library::Library;
use crate::model::project::ProjectData;

pub(super) fn check_pending_connectors(data: &ProjectData) -> Vec<Finding> {
    data.connector_instances
        .iter()
        .filter(|c| c.status == "pending")
        .map(|c| {
            warning(format!("Connector {} is marked pending", c.short_id))
                .at(FindingTarget::Connector { id: c.id })
        })
        .collect()
}

/// Vías sin cable a las que la biblioteca no les da tapón (el del conector, o
/// uno del mismo tamaño): un aviso por conector, no uno por vía.
pub(super) fn check_unused_cavities_without_seal_plug(
    data: &ProjectData,
    library: &Library,
) -> Vec<Finding> {
    data.connector_instances
        .iter()
        .filter_map(|connector| {
            let missing = connector
                .cavities
                .iter()
                .filter(|cav| {
                    crate::contacts::wires_in_cavity(data, cav).is_empty()
                        && crate::contacts::cavity_seal_plug(data, library, connector, cav).is_none()
                })
                .count();
            (missing > 0).then(|| {
                warning(format!(
                    "{}: {missing} unused cavit{} without seal plug (set the seal plug of its part in the library)",
                    connector.short_id,
                    if missing == 1 { "y" } else { "ies" }
                ))
                .at(FindingTarget::Connector { id: connector.id })
            })
        })
        .collect()
}

/// Vías con cable a las que la biblioteca no les da contacto: sin él no entran
/// en la lista de materiales ni se chequea el calibre. Un aviso por conector.
pub(super) fn check_used_cavities_without_contact(
    data: &ProjectData,
    library: &Library,
) -> Vec<Finding> {
    data.connector_instances
        .iter()
        .filter_map(|connector| {
            let missing = connector
                .cavities
                .iter()
                .filter(|cav| {
                    !crate::contacts::wires_in_cavity(data, cav).is_empty()
                        && crate::contacts::cavity_contact(data, library, connector, cav).is_none()
                })
                .count();
            (missing > 0).then(|| {
                warning(format!(
                    "{}: no contact for {missing} wired cavit{} (set the contact of its part in the library)",
                    connector.short_id,
                    if missing == 1 { "y" } else { "ies" }
                ))
                .at(FindingTarget::Connector { id: connector.id })
            })
        })
        .collect()
}

pub(super) fn check_adhesive_heatshrink_connector_without_back_diameter(
    data: &ProjectData,
    library: &Library,
) -> Vec<Finding> {
    data.connector_instances
        .iter()
        .filter(|c| c.termination.as_deref() == Some("adhesive_heatshrink"))
        .filter(|c| {
            let def = library
                .connector_defs
                .iter()
                .find(|d| d.part_id == c.library_part_id);
            def.is_none_or(|d| d.back_clearance_mm().is_none())
        })
        .map(|c| {
            warning(format!(
                "Connector {} uses adhesive heat-shrink but its part has no back diameter loaded",
                c.short_id
            ))
            .at(FindingTarget::Connector { id: c.id })
        })
        .collect()
}

/// Calibre fuera del rango del contacto, incluyendo la sección total cuando
/// hay varios cables en la misma cavidad (plan sección 12 y 4.2).
pub(super) fn check_gauge_within_contact_range(
    data: &ProjectData,
    library: &Library,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    for connector in &data.connector_instances {
        for cav in &connector.cavities {
            let Some(contact_id) = crate::contacts::cavity_contact(data, library, connector, cav)
            else {
                continue;
            };
            let Some(contact) = library
                .contact_defs
                .iter()
                .find(|c| c.part_id == contact_id)
            else {
                continue;
            };
            let Some((range_min, range_max)) = crate::contacts::gauge_range_mm2(
                contact.gauge_min.as_deref(),
                contact.gauge_max.as_deref(),
            ) else {
                continue;
            };

            let wires: Vec<&crate::model::project::WireInstance> = data
                .wire_instances
                .iter()
                .filter(|w| {
                    w.end_a.cavity_assignment_id == Some(cav.id)
                        || w.end_b.cavity_assignment_id == Some(cav.id)
                })
                .collect();
            if wires.is_empty() {
                continue;
            }
            let Some(total_mm2) = wires
                .iter()
                .map(|w| {
                    library
                        .wire_defs
                        .iter()
                        .find(|wd| wd.part_id == w.library_part_id)
                        .and_then(|wd| crate::gauge::gauge_to_mm2(&wd.gauge))
                })
                .sum::<Option<f64>>()
            else {
                continue; // algún calibre involucrado no se pudo interpretar
            };

            if total_mm2 < range_min || total_mm2 > range_max {
                findings.push(error(format!(
                    "{}: cavity {}'s wire gauge ({total_mm2:.2}mm² total) is outside its contact's range",
                    connector.short_id, cav.cavity_id
                )).at(FindingTarget::Connector { id: connector.id }));
            }
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::checks::test_fixtures::*;
    use crate::model::project::{CavityAssignment, ConnectorInstance, Node};

    #[test]
    fn flags_a_pending_connector() {
        let mut data = empty_project();
        data.nodes = vec![Node {
            id: 1,
            kind: "connector_end".into(),
            termination: None,
            termination_library_part_id: None,
            diagram_x: None,
            diagram_y: None,
            adhesive_heatshrink_length_mm: None,
        }];
        data.connector_instances = vec![ConnectorInstance {
            id: 1,
            short_id: "X1".into(),
            name: "TBD".into(),
            library_part_id: 1,
            device_connector_id: None,
            node_id: 1,
            termination: None,
            termination_library_part_id: None,
            backshell_library_part_id: None,
            status: "pending".into(),
            is_interconnect: false,
            mates_with: None,
            cavities: vec![CavityAssignment {
                id: 1,
                cavity_id: "1".into(),
                external_reference: None,
            }],
        }];
        let pending = check_pending_connectors(&data);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].target, Some(FindingTarget::Connector { id: 1 }));

        let unused = check_unused_cavities_without_seal_plug(&data, &empty_library());
        assert_eq!(unused.len(), 1);
        assert_eq!(unused[0].target, Some(FindingTarget::Connector { id: 1 }));
    }

    #[test]
    fn flags_adhesive_heatshrink_connector_without_a_back_diameter() {
        let mut data = segment_with_one_wire();
        data.connector_instances[0].termination = Some("adhesive_heatshrink".into());
        let library = library_with_wire_def(6.0); // sin connector_defs -> sin medida trasera
        let findings = check_adhesive_heatshrink_connector_without_back_diameter(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("X1"));
    }

    #[test]
    fn no_gauge_finding_when_the_wire_fits_the_contact_range() {
        let data = segment_with_one_wire();
        let mut library = library_with_wire_def(6.0); // WireDef 100 = "22 AWG" ≈ 0.326mm²
        library.connector_defs = vec![connector_def_with_contact(
            data.connector_instances[0].library_part_id,
            500,
        )];
        library.contact_defs = vec![crate::model::library::ContactDef {
            part_id: 500,
            gender: "female".into(),
            contact_size: "20".into(),
            gauge_min: Some("24 AWG".into()),
            gauge_max: Some("20 AWG".into()),
        }];
        assert!(check_gauge_within_contact_range(&data, &library).is_empty());
    }

    #[test]
    fn flags_a_wire_gauge_outside_its_contacts_range() {
        let data = segment_with_one_wire();
        let mut library = library_with_wire_def(6.0); // WireDef 100 = "22 AWG" ≈ 0.326mm²
        library.connector_defs = vec![connector_def_with_contact(
            data.connector_instances[0].library_part_id,
            500,
        )];
        library.contact_defs = vec![crate::model::library::ContactDef {
            part_id: 500,
            gender: "female".into(),
            contact_size: "12".into(),
            gauge_min: Some("14 AWG".into()), // mucho más grueso que el cable real
            gauge_max: Some("10 AWG".into()),
        }];
        let findings = check_gauge_within_contact_range(&data, &library);
        // El cable llega a X1 y a X2, los dos con ese contacto: un error en cada punta.
        assert_eq!(findings.len(), 2);
        assert!(findings.iter().all(|f| f.severity == "error"));
        assert!(findings[0].message.contains("X1"));
    }
}
