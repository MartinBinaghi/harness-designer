//! Chequeos de cables: extremos, nets con nombres distintos, margen de corte (plan 12).

use super::{error, warning, Finding, FindingTarget};
use crate::model::library::Library;
use crate::model::project::{ProjectData, WireEnd};
use std::collections::HashSet;

fn end_target_exists(data: &ProjectData, end: &WireEnd) -> bool {
    match end.kind.as_str() {
        "cavity" => end.cavity_assignment_id.is_some_and(|id| {
            data.connector_instances
                .iter()
                .any(|c| c.cavities.iter().any(|cav| cav.id == id))
        }),
        "splice" => end
            .splice_id
            .is_some_and(|id| data.splice_instances.iter().any(|s| s.id == id)),
        "ground" => end
            .ground_point_id
            .is_some_and(|id| data.ground_points.iter().any(|g| g.id == id)),
        "component" => end
            .component_instance_id
            .is_some_and(|id| data.component_instances.iter().any(|c| c.id == id)),
        _ => false,
    }
}

pub(super) fn check_wires_have_valid_endpoints(data: &ProjectData) -> Vec<Finding> {
    let mut findings = Vec::new();
    for wire in &data.wire_instances {
        if !end_target_exists(data, &wire.end_a) {
            findings.push(
                error(format!(
                    "Wire {} has no valid starting endpoint",
                    wire.short_id
                ))
                .at(FindingTarget::Wire { id: wire.id }),
            );
        }
        if !end_target_exists(data, &wire.end_b) {
            findings.push(
                error(format!(
                    "Wire {} has no valid ending endpoint",
                    wire.short_id
                ))
                .at(FindingTarget::Wire { id: wire.id }),
            );
        }
    }
    findings
}

pub(super) fn check_same_net_different_function(data: &ProjectData) -> Vec<Finding> {
    // Todas las nets de una pasada; cada una se mira una vez (por su primer cable).
    let nets = crate::topology::all_nets(data);
    let by_id: std::collections::HashMap<i64, &crate::model::project::WireInstance> =
        data.wire_instances.iter().map(|w| (w.id, w)).collect();
    let mut seen = HashSet::new();
    let mut findings = Vec::new();
    for wire in &data.wire_instances {
        let net = &nets[&wire.id];
        if !seen.insert(net[0]) {
            continue;
        }
        let net_wires: Vec<&crate::model::project::WireInstance> =
            net.iter().filter_map(|id| by_id.get(id).copied()).collect();
        let names: HashSet<&str> = net_wires
            .iter()
            .filter_map(|w| w.specific_name.as_deref())
            .collect();
        if names.len() > 1 {
            let short_ids: Vec<&str> = net_wires.iter().map(|w| w.short_id.as_str()).collect();
            findings.push(warning(format!(
                "Wires {} share a net but have different names",
                short_ids.join(", ")
            )));
        }
    }
    findings
}

pub(super) fn check_cut_margin_below_twist_minimum(
    data: &ProjectData,
    library: &Library,
) -> Vec<Finding> {
    crate::calc::cut_list(data, library)
        .into_iter()
        .filter(|cut| cut.margin_pct < cut.twist_min_margin_pct)
        .filter_map(|cut| {
            let wire = data.wire_instances.iter().find(|w| w.id == cut.wire_id)?;
            Some(
                warning(format!(
                    "Wire {} has a {:.1}% cut margin, below the {:.1}% minimum its twist needs",
                    wire.short_id, cut.margin_pct, cut.twist_min_margin_pct
                ))
                .at(FindingTarget::Wire { id: wire.id }),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::checks::test_fixtures::*;
    use crate::model::project::{GroundPoint, SpliceInstance, WireInstance};

    #[test]
    fn flags_a_wire_end_pointing_at_nothing() {
        let mut data = empty_project();
        data.wire_instances = vec![WireInstance {
            id: 1,
            short_id: "W001".into(),
            library_part_id: 1,
            color: None,
            signal_type_id: None,
            specific_name: None,
            manual_cut_margin_pct: None,
            manual_length_mm: None,
            label: None,
            end_a: end("cavity", None, None, None, None), // never picked in the UI
            end_b: end("ground", None, None, Some(1), None),
        }];
        data.ground_points = vec![GroundPoint {
            id: 1,
            short_id: "G1".into(),
            name: "Chassis".into(),
            terminal_library_part_id: None,
            node_id: 1,
        }];
        let findings = check_wires_have_valid_endpoints(&data);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("starting endpoint"));
    }

    #[test]
    fn flags_same_net_wires_with_different_names() {
        let mut data = empty_project();
        data.splice_instances = vec![SpliceInstance {
            id: 1,
            short_id: "SP1".into(),
            name: String::new(),
            library_part_id: 1,
            node_id: Some(1),
            segment_id: None,
            offset_from_end_mm: None,
            offset_from_node_id: None,
        }];
        data.wire_instances = vec![
            WireInstance {
                id: 1,
                short_id: "W001".into(),
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: Some("Damper FL".into()),
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("splice", None, Some(1), None, None),
            },
            WireInstance {
                id: 2,
                short_id: "W002".into(),
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: Some("Damper FR".into()),
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("splice", None, Some(1), None, None),
            },
        ];
        let findings = check_same_net_different_function(&data);
        assert_eq!(findings.len(), 1);
    }
}
