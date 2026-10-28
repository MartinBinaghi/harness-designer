//! Chequeos de termo, boots y moldes en T asignados (plan 9 y 12).

use super::{warning, Finding, FindingTarget};
use crate::model::library::Library;
use crate::model::project::ProjectData;

pub(super) fn check_covering_fit(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let mut findings = Vec::new();
    for segment in &data.segments {
        if crate::calc::bundle_diameter_mm(data, library, segment.id) <= 0.0 {
            continue;
        }
        let fits = crate::calc::coverings_for_segment(data, library, segment.id);
        match segment.covering_library_part_id {
            Some(assigned_id) => {
                if let Some(fit) = fits.iter().find(|f| f.library_part_id == assigned_id) {
                    if !fit.fits {
                        findings.push(
                            warning(format!(
                                "Segment S{} has a covering assigned that doesn't fit this bundle",
                                segment.id
                            ))
                            .at(FindingTarget::Segment { id: segment.id }),
                        );
                    }
                }
            }
            None if !fits.iter().any(|f| f.fits) => {
                findings.push(
                    warning(format!(
                        "No covering in the library fits segment S{}'s bundle",
                        segment.id
                    ))
                    .at(FindingTarget::Segment { id: segment.id }),
                );
            }
            None => {}
        }
    }
    findings
}

pub(super) fn check_boot_assigned_does_not_fit(
    data: &ProjectData,
    library: &Library,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    for connector in &data.connector_instances {
        if !matches!(
            connector.termination.as_deref(),
            Some("boot_straight") | Some("boot_90")
        ) {
            continue;
        }
        let Some(assigned_id) = connector.termination_library_part_id else {
            continue;
        };
        let fits = crate::calc::boots_for_connector(data, library, connector.id);
        if let Some(fit) = fits.iter().find(|f| f.library_part_id == assigned_id) {
            if !fit.fits {
                findings.push(warning(format!("Connector {}'s assigned boot doesn't fit (series/shell or cable-side diameter)", connector.short_id)).at(FindingTarget::Connector { id: connector.id }));
            }
        }
    }
    findings
}

pub(super) fn check_t_mold_assigned_does_not_fit(
    data: &ProjectData,
    library: &Library,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    for node in &data.nodes {
        if node.termination.as_deref() != Some("t_mold") {
            continue;
        }
        let Some(assigned_id) = node.termination_library_part_id else {
            continue;
        };
        let fits = crate::calc::t_mold_fits_for_node(data, library, node.id);
        if let Some(fit) = fits.iter().find(|f| f.library_part_id == assigned_id) {
            if !fit.fits {
                findings.push(
                    warning(format!(
                        "Breakout at node {} has a T-mold assigned that doesn't fit its segments",
                        node.id
                    ))
                    .at(FindingTarget::Node { id: node.id }),
                );
            }
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::checks::test_fixtures::*;

    #[test]
    fn flags_when_no_covering_in_the_library_fits_the_segment() {
        let data = segment_with_one_wire();
        let library = library_with_wire_def(6.0);
        let findings = check_covering_fit(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("No covering"));
    }

    #[test]
    fn flags_an_assigned_covering_that_does_not_fit() {
        let mut data = segment_with_one_wire();
        data.segments[0].covering_library_part_id = Some(200);
        let mut library = library_with_wire_def(6.0);
        // Demasiado angosto: no aprieta contra el bundle real.
        library.covering_defs = vec![crate::model::library::CoveringDef {
            part_id: 200,
            supplied_diameter_mm: 1.0,
            shrunk_diameter_mm: 0.5,
            shrunk_wall_thickness_mm: 0.2,
            has_adhesive: true,
        }];
        let findings = check_covering_fit(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("doesn't fit"));
    }

    #[test]
    fn no_covering_finding_when_a_fitting_one_is_assigned() {
        let mut data = segment_with_one_wire();
        data.segments[0].covering_library_part_id = Some(200);
        let mut library = library_with_wire_def(6.0);
        let d_bundle = crate::calc::bundle_diameter_mm(&data, &library, 1);
        library.covering_defs = vec![crate::model::library::CoveringDef {
            part_id: 200,
            supplied_diameter_mm: d_bundle * 1.2,
            shrunk_diameter_mm: d_bundle * 0.9,
            shrunk_wall_thickness_mm: 0.2,
            has_adhesive: true,
        }];
        assert!(check_covering_fit(&data, &library).is_empty());
    }

    #[test]
    fn flags_a_boot_assigned_to_a_connector_it_is_not_compatible_with() {
        let mut data = segment_with_one_wire();
        data.connector_instances[0].termination = Some("boot_straight".into());
        data.connector_instances[0].termination_library_part_id = Some(300);
        let mut library = library_with_wire_def(6.0);
        library.connector_defs = vec![crate::model::library::ConnectorDef {
            part_id: 10,
            gender: "female".into(),
            series: Some("AMP".into()),
            shell_size: Some("CE".into()),
            counterpart_id: None,
            back_shape: None,
            back_diameter_mm: None,
            back_width_mm: None,
            back_height_mm: None,
            suggested_termination: None,
            contact_part_id: None,
            seal_plug_part_id: None,
            adhesive_heatshrink_length_mm: None,
            cavities: vec![],
        }];
        library.accessory_defs = vec![crate::model::library::AccessoryDef {
            part_id: 300,
            orientation: "straight".into(),
            cable_side_min_diameter_mm: 1.0,
            cable_side_max_diameter_mm: 2.0,
            leg_length_mm: 30.0,
            overlap_mm: 15.0,
            compatible_connectors: vec![crate::model::library::AccessoryDefConnectorMatch {
                series: "DT".into(),
                shell_size: "06".into(),
            }],
        }];
        let findings = check_boot_assigned_does_not_fit(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("X1"));
    }

    #[test]
    fn flags_a_t_mold_assigned_to_a_breakout_it_does_not_fit() {
        let mut data = segment_with_one_wire();
        data.nodes[0].termination = Some("t_mold".into());
        data.nodes[0].termination_library_part_id = Some(400);
        let mut library = library_with_wire_def(6.0);
        // El molde tiene 3 patas, pero el nodo 1 solo tiene un segmento: no calza.
        library.t_mold_defs = vec![crate::model::library::TMoldDef {
            part_id: 400,
            overlap_mm: 20.0,
            legs: vec![
                crate::model::library::TMoldLeg {
                    min_diameter_mm: 0.0,
                    max_diameter_mm: 100.0,
                    leg_length_mm: 30.0,
                },
                crate::model::library::TMoldLeg {
                    min_diameter_mm: 0.0,
                    max_diameter_mm: 100.0,
                    leg_length_mm: 30.0,
                },
                crate::model::library::TMoldLeg {
                    min_diameter_mm: 0.0,
                    max_diameter_mm: 100.0,
                    leg_length_mm: 30.0,
                },
            ],
        }];
        let findings = check_t_mold_assigned_does_not_fit(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("node 1"));
    }
}
