//! Leer un proyecto del archivo SQLite.

use super::{
    CavityAssignment, ComponentInstance, ConnectorInstance, GroundPoint, Node, Project,
    ProjectData, Segment, SpliceInstance, TwistGroup, WireEnd, WireInstance,
};
use rusqlite::{params, Connection, Result};

pub(super) fn wire_end(
    kind: String,
    a: Option<i64>,
    b: Option<i64>,
    c: Option<i64>,
    d: Option<i64>,
) -> WireEnd {
    WireEnd {
        kind,
        cavity_assignment_id: a,
        splice_id: b,
        ground_point_id: c,
        component_instance_id: d,
    }
}

pub fn load(conn: &Connection) -> Result<ProjectData> {
    let project = conn.query_row(
        "SELECT name, harness_code, client, revision, main_connector_instance_id, markup_pct, default_cut_margin_pct, default_twist_pitch_factor, fill_factor, labor_hours, labor_rate_usd, cost_on_purchased, spare_pcts, cut_round_mm
         FROM project WHERE id = 1",
        [],
        |row| {
            Ok(Project {
                name: row.get(0)?,
                harness_code: row.get(1)?,
                client: row.get(2)?,
                revision: row.get(3)?,
                main_connector_instance_id: row.get(4)?,
                markup_pct: row.get(5)?,
                default_cut_margin_pct: row.get(6)?,
                default_twist_pitch_factor: row.get(7)?,
                fill_factor: row.get(8)?,
                labor_hours: row.get(9)?,
                labor_rate_usd: row.get(10)?,
                cost_on_purchased: row.get(11)?,
                // Un JSON roto es un error del archivo, no "sin repuestos".
                spare_pcts: serde_json::from_str(&row.get::<_, String>(12)?)
                    .map_err(|e| rusqlite::Error::FromSqlConversionFailure(12, rusqlite::types::Type::Text, Box::new(e)))?,
                cut_round_mm: row.get(13)?,
            })
        },
    )?;

    let mut nodes_stmt =
        conn.prepare("SELECT id, kind, termination, termination_library_part_id, diagram_x, diagram_y, adhesive_heatshrink_length_mm FROM nodes")?;
    let nodes = nodes_stmt
        .query_map([], |row| {
            Ok(Node {
                id: row.get(0)?,
                kind: row.get(1)?,
                termination: row.get(2)?,
                termination_library_part_id: row.get(3)?,
                diagram_x: row.get(4)?,
                diagram_y: row.get(5)?,
                adhesive_heatshrink_length_mm: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut segments_stmt = conn.prepare(
        "SELECT id, node_a_id, node_b_id, length_mm, twist_pitch_mm, covering_library_part_id FROM segments",
    )?;
    let segments = segments_stmt
        .query_map([], |row| {
            Ok(Segment {
                id: row.get(0)?,
                node_a_id: row.get(1)?,
                node_b_id: row.get(2)?,
                length_mm: row.get(3)?,
                twist_pitch_mm: row.get(4)?,
                covering_library_part_id: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut connector_instances_stmt = conn.prepare(
        "SELECT id, short_id, name, library_part_id, device_connector_id, node_id, termination, termination_library_part_id, backshell_library_part_id, status, is_interconnect, mates_with FROM connector_instances",
    )?;
    let mut connector_instances = connector_instances_stmt
        .query_map([], |row| {
            Ok(ConnectorInstance {
                id: row.get(0)?,
                short_id: row.get(1)?,
                name: row.get(2)?,
                library_part_id: row.get(3)?,
                device_connector_id: row.get(4)?,
                node_id: row.get(5)?,
                termination: row.get(6)?,
                termination_library_part_id: row.get(7)?,
                backshell_library_part_id: row.get(8)?,
                status: row.get(9)?,
                is_interconnect: row.get::<_, i64>(10)? != 0,
                mates_with: row.get(11)?,
                cavities: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    for connector_instance in &mut connector_instances {
        let mut cavities_stmt = conn.prepare(
            "SELECT id, cavity_id, external_reference FROM cavity_assignments WHERE connector_instance_id = ?1 ORDER BY rowid",
        )?;
        connector_instance.cavities = cavities_stmt
            .query_map(params![connector_instance.id], |row| {
                Ok(CavityAssignment {
                    id: row.get(0)?,
                    cavity_id: row.get(1)?,
                    external_reference: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
    }

    let mut ground_points_stmt = conn.prepare(
        "SELECT id, short_id, name, terminal_library_part_id, node_id FROM ground_points",
    )?;
    let ground_points = ground_points_stmt
        .query_map([], |row| {
            Ok(GroundPoint {
                id: row.get(0)?,
                short_id: row.get(1)?,
                name: row.get(2)?,
                terminal_library_part_id: row.get(3)?,
                node_id: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut splice_instances_stmt = conn.prepare("SELECT id, short_id, library_part_id, node_id, segment_id, offset_from_end_mm, offset_from_node_id, name FROM splice_instances")?;
    let splice_instances = splice_instances_stmt
        .query_map([], |row| {
            Ok(SpliceInstance {
                id: row.get(0)?,
                short_id: row.get(1)?,
                library_part_id: row.get(2)?,
                node_id: row.get(3)?,
                segment_id: row.get(4)?,
                offset_from_end_mm: row.get(5)?,
                offset_from_node_id: row.get(6)?,
                name: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut component_instances_stmt = conn.prepare(
        "SELECT id, short_id, name, library_part_id, node_id, segment_id, offset_from_end_mm, offset_from_node_id FROM component_instances",
    )?;
    let component_instances = component_instances_stmt
        .query_map([], |row| {
            Ok(ComponentInstance {
                id: row.get(0)?,
                short_id: row.get(1)?,
                name: row.get(2)?,
                library_part_id: row.get(3)?,
                node_id: row.get(4)?,
                segment_id: row.get(5)?,
                offset_from_end_mm: row.get(6)?,
                offset_from_node_id: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut wire_instances_stmt = conn.prepare(
        "SELECT id, short_id, library_part_id, color, signal_type_id, specific_name, manual_cut_margin_pct, manual_length_mm, label,
                end_a_kind, end_a_cavity_assignment_id, end_a_splice_id, end_a_ground_point_id, end_a_component_instance_id,
                end_b_kind, end_b_cavity_assignment_id, end_b_splice_id, end_b_ground_point_id, end_b_component_instance_id
         FROM wire_instances",
    )?;
    let wire_instances = wire_instances_stmt
        .query_map([], |row| {
            Ok(WireInstance {
                id: row.get(0)?,
                short_id: row.get(1)?,
                library_part_id: row.get(2)?,
                color: row.get(3)?,
                signal_type_id: row.get(4)?,
                specific_name: row.get(5)?,
                manual_cut_margin_pct: row.get(6)?,
                manual_length_mm: row.get(7)?,
                label: row.get(8)?,
                end_a: wire_end(
                    row.get(9)?,
                    row.get(10)?,
                    row.get(11)?,
                    row.get(12)?,
                    row.get(13)?,
                ),
                end_b: wire_end(
                    row.get(14)?,
                    row.get(15)?,
                    row.get(16)?,
                    row.get(17)?,
                    row.get(18)?,
                ),
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut twist_groups_stmt =
        conn.prepare("SELECT id, name, shielded, drain FROM twist_groups")?;
    let mut twist_groups = twist_groups_stmt
        .query_map([], |row| {
            Ok(TwistGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                shielded: row.get::<_, i64>(2)? != 0,
                drain: row.get::<_, i64>(3)? != 0,
                wire_instance_ids: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    for group in &mut twist_groups {
        let mut members_stmt =
            conn.prepare("SELECT wire_instance_id FROM twist_group_wires WHERE twist_group_id = ?1 ORDER BY rowid")?;
        group.wire_instance_ids = members_stmt
            .query_map(params![group.id], |row| row.get::<_, i64>(0))?
            .collect::<Result<Vec<_>>>()?;
    }

    Ok(ProjectData {
        project,
        nodes,
        segments,
        connector_instances,
        ground_points,
        splice_instances,
        component_instances,
        wire_instances,
        twist_groups,
    })
}
