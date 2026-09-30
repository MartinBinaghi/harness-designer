//! Proyecto de ejemplo en memoria, para poder probar la topología/nets desde
//! el frontend antes de tener las pantallas de biblioteca/conectores/cables
//! (etapa 2). No se guarda solo: es punto de partida para "Nuevo".

use crate::model::library::{
    AccessoryDef, AccessoryDefConnectorMatch, ContactDef, CoveringDef, Library, Part, TMoldDef, TMoldLeg, WireDef,
};
use crate::model::project::{
    CavityAssignment, ComponentInstance, ConnectorInstance, DeviceInstance, GroundPoint, Node,
    Project, ProjectData, Segment, SpliceInstance, WireEnd, WireInstance,
};

fn end(kind: &str, cavity: Option<i64>, splice: Option<i64>, ground: Option<i64>, component: Option<i64>) -> WireEnd {
    WireEnd {
        kind: kind.into(),
        cavity_assignment_id: cavity,
        splice_id: splice,
        ground_point_id: ground,
        component_instance_id: component,
    }
}

/// Arnés de ejemplo: X1 (Damper FL) --450mm-- breakout --300mm-- X9 (PDM30)
///                                                        \--200mm-- X4 (sensor con CAN)
///                                                        \--80mm--  G1 (masa)
/// Un splice en el breakout une la señal de X1 con el PDM y una masa de
/// referencia. Una resistencia de terminación CAN cuelga de X4, entre sus
/// propias cavidades CANH/CANL, para probar rutas y nets a través de un
/// componente.
pub fn sample_project() -> ProjectData {
    ProjectData {
        project: Project {
            name: "Engine Harness".into(),
            harness_code: "MOT-01".into(),
            client: None,
            revision: Some("A".into()),
            format_version: 1,
            main_connector_instance_id: Some(1),
            markup_pct: 0.0,
            default_cut_margin_pct: 10.0,
            default_twist_pitch_factor: 8.0,
            fill_factor: 0.75,
            labor_hours: 0.0,
            labor_rate_usd: 0.0,
        },
        device_instances: vec![DeviceInstance {
            id: 1,
            name: "PDM30".into(),
            library_part_id: None,
        }],
        nodes: vec![
            Node { id: 1, kind: "connector_end".into(), termination: None, termination_library_part_id: None },
            Node { id: 2, kind: "breakout".into(), termination: Some("t_mold".into()), termination_library_part_id: Some(32) },
            Node { id: 3, kind: "connector_end".into(), termination: None, termination_library_part_id: None },
            Node { id: 4, kind: "connector_end".into(), termination: None, termination_library_part_id: None },
            Node { id: 5, kind: "ground_point".into(), termination: None, termination_library_part_id: None },
        ],
        segments: vec![
            Segment { id: 1, node_a_id: 1, node_b_id: 2, length_mm: 450.0, twist_pitch_mm: None, covering_library_part_id: Some(30) },
            Segment { id: 2, node_a_id: 2, node_b_id: 3, length_mm: 300.0, twist_pitch_mm: None, covering_library_part_id: None },
            Segment { id: 3, node_a_id: 2, node_b_id: 4, length_mm: 200.0, twist_pitch_mm: None, covering_library_part_id: None },
            Segment { id: 4, node_a_id: 2, node_b_id: 5, length_mm: 80.0, twist_pitch_mm: None, covering_library_part_id: None },
        ],
        connector_instances: vec![
            ConnectorInstance {
                id: 1,
                short_id: "X1".into(),
                name: "Damper FL".into(),
                library_part_id: 1,
                device_instance_id: None,
                node_id: 1,
                termination: Some("adhesive_heatshrink".into()),
                termination_library_part_id: Some(30),
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![CavityAssignment {
                    id: 100,
                    cavity_id: "1".into(),
                    contact_library_part_id: Some(40),
                    seal_plug_library_part_id: None,
                    external_reference: None,
                }],
            },
            ConnectorInstance {
                id: 2,
                short_id: "X9".into(),
                name: "PDM30".into(),
                library_part_id: 2,
                device_instance_id: Some(1),
                node_id: 3,
                termination: Some("boot_straight".into()),
                termination_library_part_id: Some(31),
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![CavityAssignment {
                    id: 101,
                    cavity_id: "1".into(),
                    contact_library_part_id: Some(41),
                    seal_plug_library_part_id: None,
                    external_reference: None,
                }],
            },
            ConnectorInstance {
                id: 3,
                short_id: "X4".into(),
                name: "Brake Pressure Sensor".into(),
                library_part_id: 3,
                device_instance_id: None,
                node_id: 4,
                termination: Some("adhesive_heatshrink".into()),
                termination_library_part_id: None,
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![
                    CavityAssignment {
                        id: 104,
                        cavity_id: "1".into(),
                        contact_library_part_id: None,
                        seal_plug_library_part_id: None,
                        external_reference: None,
                    },
                    CavityAssignment {
                        id: 105,
                        cavity_id: "2".into(),
                        contact_library_part_id: None,
                        seal_plug_library_part_id: None,
                        external_reference: None,
                    },
                ],
            },
        ],
        ground_points: vec![GroundPoint {
            id: 1,
            short_id: "G1".into(),
            name: "Chassis Ground".into(),
            terminal_library_part_id: None,
            node_id: 5,
        }],
        splice_instances: vec![SpliceInstance {
            id: 1,
            short_id: "SP1".into(),
            library_part_id: 10,
            node_id: Some(2),
            segment_id: None,
            offset_from_end_mm: None,
            offset_from_node_id: None,
        }],
        component_instances: vec![ComponentInstance {
            id: 1,
            short_id: "R1".into(),
            name: "CAN Termination 120R".into(),
            library_part_id: 4,
            node_id: Some(4),
            segment_id: None,
            offset_from_end_mm: None,
            offset_from_node_id: None,
        }],
        wire_instances: vec![
            WireInstance {
                id: 1,
                short_id: "W001".into(),
                library_part_id: 20,
                color: Some("violet".into()),
                signal_type_id: None,
                specific_name: Some("Damper FL".into()),
                manual_cut_margin_pct: None,
                label: None,
                end_a: end("cavity", Some(100), None, None, None),
                end_b: end("splice", None, Some(1), None, None),
            },
            WireInstance {
                id: 2,
                short_id: "W002".into(),
                library_part_id: 20,
                color: Some("violet".into()),
                signal_type_id: None,
                specific_name: Some("Damper FL".into()),
                manual_cut_margin_pct: None,
                label: None,
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("cavity", Some(101), None, None, None),
            },
            WireInstance {
                id: 3,
                short_id: "W003".into(),
                library_part_id: 20,
                color: Some("black".into()),
                signal_type_id: None,
                specific_name: Some("Signal Ground".into()),
                manual_cut_margin_pct: None,
                label: None,
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("ground", None, None, Some(1), None),
            },
            WireInstance {
                id: 4,
                short_id: "W004".into(),
                library_part_id: 21,
                color: Some("white".into()),
                signal_type_id: None,
                specific_name: Some("CAN H".into()),
                manual_cut_margin_pct: None,
                label: None,
                end_a: end("cavity", Some(104), None, None, None),
                end_b: end("component", None, None, None, Some(1)),
            },
            WireInstance {
                id: 5,
                short_id: "W005".into(),
                library_part_id: 21,
                color: Some("white".into()),
                signal_type_id: None,
                specific_name: Some("CAN L".into()),
                manual_cut_margin_pct: None,
                label: None,
                end_a: end("component", None, None, None, Some(1)),
                end_b: end("cavity", Some(105), None, None, None),
            },
        ],
        twist_groups: vec![],
    }
}

fn part(id: i64, category: &str, part_number: &str, purchase_unit: &str, qty_per_pack: f64, price_usd: f64) -> Part {
    Part {
        id,
        part_number: part_number.into(),
        manufacturer: None,
        description: None,
        category: category.into(),
        purchase_unit: purchase_unit.into(),
        qty_per_pack,
        price_usd: Some(price_usd),
        price_date: Some("2026-09-01".into()),
    }
}

/// Biblioteca de ejemplo con precios reales, para probar BOM y costos
/// (`Costs`) contra `sample_project()` sin tener que cargar una biblioteca
/// a mano. Solo tiene los `Part`/`WireDef`/`CoveringDef`/`AccessoryDef` que el
/// proyecto de ejemplo usa (X1/X9/X4, R1, SP1, W001-W005) — no las fichas
/// completas de conector/splice/componente, que no hacen falta para BOM/costos.
pub fn sample_library() -> Library {
    Library {
        parts: vec![
            part(1, "connector", "AMP-CE-6P", "unit", 1.0, 12.50),
            part(2, "connector", "MOTEC-PDM30-CONN-A", "unit", 1.0, 45.00),
            part(3, "connector", "DT04-2P", "unit", 10.0, 3.20),
            part(4, "component", "RES-120R-1/4W", "unit", 100.0, 0.15),
            part(10, "splice", "SPLICE-2W", "unit", 100.0, 0.40),
            part(20, "wire", "M22759/32-22", "meter", 30.5, 0.55),
            part(21, "wire", "M22759/32-24-2C-CAN", "meter", 30.5, 0.90),
            part(30, "covering", "RNF-100-1/8", "meter", 30.5, 1.10),
            part(31, "accessory", "AMP-CE-BOOT-S", "unit", 1.0, 4.50),
            part(32, "accessory", "RAYCHEM-TMOLD-1", "unit", 1.0, 8.75),
            part(40, "contact", "AMP-CONTACT-20", "unit", 100.0, 0.85),
            part(41, "contact", "AMP-CONTACT-16", "unit", 100.0, 0.95),
        ],
        wire_defs: vec![
            WireDef {
                part_id: 20,
                gauge: "22 AWG".into(),
                spec: Some("M22759/32".into()),
                color: None,
                outer_diameter_mm: 1.5,
                default_cut_margin_pct: None,
                conductors: vec![],
            },
            WireDef {
                part_id: 21,
                gauge: "24 AWG".into(),
                spec: Some("M22759/32 (twisted pair)".into()),
                color: None,
                outer_diameter_mm: 2.2,
                default_cut_margin_pct: Some(15.0),
                conductors: vec![],
            },
        ],
        covering_defs: vec![CoveringDef {
            part_id: 30,
            supplied_diameter_mm: 3.2,
            shrunk_diameter_mm: 1.6,
            shrunk_wall_thickness_mm: 0.3,
            has_adhesive: true,
        }],
        accessory_defs: vec![AccessoryDef {
            part_id: 31,
            orientation: "straight".into(),
            cable_side_min_diameter_mm: 3.0,
            cable_side_max_diameter_mm: 8.0,
            leg_length_mm: 35.0,
            overlap_mm: 20.0,
            compatible_connectors: vec![AccessoryDefConnectorMatch {
                series: "AMP".into(),
                shell_size: "CE".into(),
            }],
        }],
        contact_defs: vec![
            ContactDef {
                part_id: 40,
                gender: "female".into(),
                contact_size: "20".into(),
                gauge_min: Some("24 AWG".into()),
                gauge_max: Some("20 AWG".into()),
            },
            ContactDef {
                part_id: 41,
                gender: "female".into(),
                contact_size: "16".into(),
                gauge_min: Some("18 AWG".into()),
                gauge_max: Some("16 AWG".into()),
            },
        ],
        t_mold_defs: vec![TMoldDef {
            part_id: 32,
            overlap_mm: 20.0,
            legs: vec![
                TMoldLeg { min_diameter_mm: 0.0, max_diameter_mm: 5.0, leg_length_mm: 30.0 },
                TMoldLeg { min_diameter_mm: 0.0, max_diameter_mm: 5.0, leg_length_mm: 30.0 },
                TMoldLeg { min_diameter_mm: 0.0, max_diameter_mm: 5.0, leg_length_mm: 30.0 },
            ],
        }],
        ..Library::default()
    }
}
