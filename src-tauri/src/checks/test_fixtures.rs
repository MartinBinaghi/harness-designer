//! Datos de prueba compartidos por los tests de los submódulos.

use crate::model::library::Library;
use crate::model::project::{
    CavityAssignment, ConnectorInstance, Node, Project, ProjectData, Segment, WireEnd, WireInstance,
};

pub(super) fn end(
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

pub(super) fn empty_project() -> ProjectData {
    ProjectData {
        project: Project {
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
        },
        nodes: vec![],
        segments: vec![],
        connector_instances: vec![],
        ground_points: vec![],
        splice_instances: vec![],
        component_instances: vec![],
        wire_instances: vec![],
        twist_groups: vec![],
    }
}

pub(super) fn empty_library() -> Library {
    Library::default()
}

/// Dos nodos, un segmento de 500mm, un conector en cada extremo (X1/X2, misma
/// library_part_id 10) y un cable de X1:1 a X2:1 (WireDef 100, 6mm de diámetro).
pub(super) fn segment_with_one_wire() -> ProjectData {
    let mut data = empty_project();
    data.nodes = vec![
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
    ];
    data.segments = vec![Segment {
        id: 1,
        node_a_id: 1,
        node_b_id: 2,
        length_mm: 500.0,
        twist_pitch_mm: Some(1_000_000.0),
        covering_library_part_id: None,
    }];
    data.connector_instances = vec![
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
    ];
    data.wire_instances = vec![WireInstance {
        id: 1,
        short_id: "W001".into(),
        library_part_id: 100,
        color: None,
        signal_type_id: None,
        specific_name: None,
        manual_cut_margin_pct: None,
        manual_length_mm: None,
        label: None,
        end_a: end("cavity", Some(1), None, None, None),
        end_b: end("cavity", Some(2), None, None, None),
    }];
    data
}

/// ConnectorDef mínimo cuyo contacto por defecto es `contact_part_id`.
pub(super) fn connector_def_with_contact(
    part_id: i64,
    contact_part_id: i64,
) -> crate::model::library::ConnectorDef {
    crate::model::library::ConnectorDef {
        part_id,
        gender: "female".into(),
        series: None,
        shell_size: None,
        counterpart_id: None,
        back_shape: None,
        back_diameter_mm: None,
        back_width_mm: None,
        back_height_mm: None,
        suggested_termination: None,
        contact_part_id: Some(contact_part_id),
        seal_plug_part_id: None,
        adhesive_heatshrink_length_mm: None,
        cavities: vec![],
    }
}

pub(super) fn library_with_wire_def(outer_diameter_mm: f64) -> Library {
    let mut library = empty_library();
    library.wire_defs = vec![crate::model::library::WireDef {
        part_id: 100,
        gauge: "22 AWG".into(),
        spec: None,
        color: None,
        outer_diameter_mm,
        default_cut_margin_pct: None,
        conductors: vec![],
    }];
    library
}
