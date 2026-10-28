//! Datos de prueba compartidos por los tests de los submódulos.

use crate::model::library::{AccessoryDef, CoveringDef, Part, WireDef};
use crate::model::project::{
    CavityAssignment, ConnectorInstance, Node, Project, ProjectData, Segment, WireEnd, WireInstance,
};

pub(super) fn wire_def(
    part_id: i64,
    outer_diameter_mm: f64,
    default_cut_margin_pct: Option<f64>,
) -> WireDef {
    WireDef {
        part_id,
        gauge: "22 AWG".into(),
        spec: None,
        color: None,
        outer_diameter_mm,
        default_cut_margin_pct,
        conductors: vec![],
    }
}

pub(super) fn part(id: i64, category: &str, qty_per_pack: f64, price_usd: Option<f64>) -> Part {
    Part {
        id,
        part_number: format!("P{id}"),
        manufacturer: None,
        description: None,
        category: category.into(),
        purchase_unit: if category == "wire" {
            "meter".into()
        } else {
            "unit".into()
        },
        qty_per_pack,
        price_usd,
        price_date: price_usd.map(|_| "2026-01-01".into()),
    }
}

pub(super) fn cavity_end(id: i64) -> WireEnd {
    WireEnd {
        kind: "cavity".into(),
        cavity_assignment_id: Some(id),
        splice_id: None,
        ground_point_id: None,
        component_instance_id: None,
    }
}

pub(super) fn splice_end(id: i64) -> WireEnd {
    WireEnd {
        kind: "splice".into(),
        cavity_assignment_id: None,
        splice_id: Some(id),
        ground_point_id: None,
        component_instance_id: None,
    }
}

/// Otro cable igual al primero (mismos extremos), para que el tramo tenga
/// más de un elemento y se trence.
pub(super) fn second_wire(data: &ProjectData) -> WireInstance {
    WireInstance {
        id: 2,
        short_id: "W002".into(),
        ..data.wire_instances[0].clone()
    }
}

/// Dos nodos, un segmento de 1000 mm entre ellos, y un cable de X1:1 a X2:1.
pub(super) fn one_segment_project(length_mm: f64, twist_pitch_mm: Option<f64>) -> ProjectData {
    ProjectData {
        project: Project {
            name: "T".into(),
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
        },
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
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
        ],
        segments: vec![Segment {
            id: 1,
            node_a_id: 1,
            node_b_id: 2,
            length_mm,
            twist_pitch_mm,
            covering_library_part_id: None,
        }],
        connector_instances: vec![
            ConnectorInstance {
                id: 1,
                short_id: "X1".into(),
                name: "A".into(),
                library_part_id: 10,
                device_connector_id: None,
                node_id: 1,
                termination: None,
                termination_library_part_id: None,
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![CavityAssignment {
                    id: 1,
                    cavity_id: "1".into(),
                    external_reference: None,
                }],
            },
            ConnectorInstance {
                id: 2,
                short_id: "X2".into(),
                name: "B".into(),
                library_part_id: 10,
                device_connector_id: None,
                node_id: 2,
                termination: None,
                termination_library_part_id: None,
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![CavityAssignment {
                    id: 2,
                    cavity_id: "1".into(),
                    external_reference: None,
                }],
            },
        ],
        ground_points: vec![],
        splice_instances: vec![],
        component_instances: vec![],
        wire_instances: vec![WireInstance {
            id: 1,
            short_id: "W001".into(),
            library_part_id: 100,
            color: None,
            signal_type_id: None,
            specific_name: None,
            manual_cut_margin_pct: None,
            manual_length_mm: None,
            label: None,
            end_a: cavity_end(1),
            end_b: cavity_end(2),
        }],
        twist_groups: vec![],
    }
}

pub(super) fn covering(part_id: i64, supplied: f64, shrunk: f64, wall: f64) -> CoveringDef {
    CoveringDef {
        part_id,
        supplied_diameter_mm: supplied,
        shrunk_diameter_mm: shrunk,
        shrunk_wall_thickness_mm: wall,
        has_adhesive: false,
    }
}

pub(super) fn connector_def_with_series(
    part_id: i64,
    series: &str,
    shell_size: &str,
) -> crate::model::library::ConnectorDef {
    crate::model::library::ConnectorDef {
        part_id,
        gender: "female".into(),
        series: Some(series.into()),
        shell_size: Some(shell_size.into()),
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
    }
}

pub(super) fn accessory(
    part_id: i64,
    min_d: f64,
    max_d: f64,
    series: &str,
    shell_size: &str,
) -> AccessoryDef {
    AccessoryDef {
        part_id,
        orientation: "straight".into(),
        cable_side_min_diameter_mm: min_d,
        cable_side_max_diameter_mm: max_d,
        leg_length_mm: 30.0,
        overlap_mm: 15.0,
        compatible_connectors: vec![crate::model::library::AccessoryDefConnectorMatch {
            series: series.into(),
            shell_size: shell_size.into(),
        }],
    }
}

pub(super) fn t_mold(part_id: i64, legs: &[(f64, f64)]) -> crate::model::library::TMoldDef {
    crate::model::library::TMoldDef {
        part_id,
        overlap_mm: 20.0,
        legs: legs
            .iter()
            .map(|&(min, max)| crate::model::library::TMoldLeg {
                min_diameter_mm: min,
                max_diameter_mm: max,
                leg_length_mm: 30.0,
            })
            .collect(),
    }
}
