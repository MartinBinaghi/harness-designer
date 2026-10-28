//! Datos de prueba compartidos por los tests de los submódulos.

use super::*;
use crate::model::project::{
    CavityAssignment, ConnectorInstance, GroundPoint, Node, Project, ProjectData, Segment,
    SpliceInstance, WireInstance,
};

pub(super) fn wire_end(
    kind: &str,
    cavity: Option<i64>,
    splice: Option<i64>,
    ground: Option<i64>,
    component: Option<i64>,
) -> WireEnd {
    WireEnd {
        kind: kind.into(),
        cavity_assignment_id: cavity,
        splice_id: splice,
        ground_point_id: ground,
        component_instance_id: component,
    }
}

pub(super) fn empty_project() -> Project {
    Project {
        name: "Test".into(),
        harness_code: "T-01".into(),
        client: None,
        revision: None,
        main_connector_instance_id: None,
        markup_pct: 0.0,
        default_cut_margin_pct: 10.0,
        default_twist_pitch_factor: 8.0,
        fill_factor: 0.75,
        labor_hours: 0.0,
        labor_rate_usd: 0.0,
        cost_on_purchased: false,
        spare_pcts: Default::default(),
        cut_round_mm: None,
    }
}

/// Árbol en Y: 1 --seg1(100mm)-- 2 --seg2(200mm)-- 3
///                                \--seg3(50mm)-- 4
pub(super) fn y_shaped_topology() -> ProjectData {
    ProjectData {
        project: empty_project(),
        nodes: vec![
            Node {
                id: 1,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
            Node {
                id: 2,
                kind: "breakout".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
            Node {
                id: 3,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
            Node {
                id: 4,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
        ],
        segments: vec![
            Segment {
                id: 1,
                node_a_id: 1,
                node_b_id: 2,
                length_mm: 100.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            },
            Segment {
                id: 2,
                node_a_id: 2,
                node_b_id: 3,
                length_mm: 200.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            },
            Segment {
                id: 3,
                node_a_id: 2,
                node_b_id: 4,
                length_mm: 50.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            },
        ],
        connector_instances: vec![],
        ground_points: vec![],
        splice_instances: vec![],
        component_instances: vec![],
        wire_instances: vec![],
        twist_groups: vec![],
    }
}

pub(super) fn topology_with_connectors_and_a_splice() -> ProjectData {
    let mut data = y_shaped_topology();
    data.connector_instances = vec![
        ConnectorInstance {
            id: 1,
            short_id: "X1".into(),
            name: "Damper FL".into(),
            library_part_id: 1,
            device_connector_id: None,
            node_id: 1,
            termination: None,
            termination_library_part_id: None,
            backshell_library_part_id: None,
            status: "complete".into(),
            is_interconnect: false,
            mates_with: None,
            cavities: vec![CavityAssignment {
                id: 100,
                cavity_id: "1".into(),
                external_reference: None,
            }],
        },
        ConnectorInstance {
            id: 2,
            short_id: "X9".into(),
            name: "PDM".into(),
            library_part_id: 2,
            device_connector_id: None,
            node_id: 3,
            termination: None,
            termination_library_part_id: None,
            backshell_library_part_id: None,
            status: "complete".into(),
            is_interconnect: false,
            mates_with: None,
            cavities: vec![CavityAssignment {
                id: 101,
                cavity_id: "47".into(),
                external_reference: None,
            }],
        },
        ConnectorInstance {
            id: 3,
            short_id: "X4".into(),
            name: "Sensor".into(),
            library_part_id: 3,
            device_connector_id: None,
            node_id: 4,
            termination: None,
            termination_library_part_id: None,
            backshell_library_part_id: None,
            status: "complete".into(),
            is_interconnect: false,
            mates_with: None,
            cavities: vec![CavityAssignment {
                id: 102,
                cavity_id: "1".into(),
                external_reference: None,
            }],
        },
    ];
    data.ground_points = vec![GroundPoint {
        id: 1,
        short_id: "G1".into(),
        name: "Masa chasis".into(),
        terminal_library_part_id: None,
        node_id: 4,
    }];
    data.splice_instances = vec![SpliceInstance {
        id: 1,
        short_id: "SP1".into(),
        name: String::new(),
        library_part_id: 1,
        node_id: Some(2),
        segment_id: None,
        offset_from_end_mm: None,
        offset_from_node_id: None,
    }];
    data
}

pub(super) fn wire(id: i64, end_a: WireEnd, end_b: WireEnd) -> WireInstance {
    WireInstance {
        id,
        short_id: format!("W{id:03}"),
        library_part_id: 1,
        color: None,
        signal_type_id: None,
        specific_name: None,
        manual_cut_margin_pct: None,
        manual_length_mm: None,
        label: None,
        end_a,
        end_b,
    }
}

pub(super) fn cavity(id: i64) -> WireEnd {
    wire_end("cavity", Some(id), None, None, None)
}
