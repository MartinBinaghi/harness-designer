//! Guardar un proyecto en el archivo SQLite.

use super::ProjectData;
use rusqlite::{params, Connection, Result};

/// Reemplaza el contenido entero del proyecto. A esta escala (cientos de
/// registros por arnés) es más simple que diffear contra lo existente.
pub fn save(conn: &mut Connection, data: &ProjectData) -> Result<()> {
    let tx = conn.transaction()?;
    for table in [
        "twist_group_wires",
        "twist_groups",
        "wire_instances",
        "component_instances",
        "splice_instances",
        "ground_points",
        "cavity_assignments",
        "connector_instances",
        "segments",
        "nodes",
        "project",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }

    let p = &data.project;
    tx.execute(
        "INSERT INTO project (id, name, harness_code, client, revision, main_connector_instance_id, markup_pct, default_cut_margin_pct, default_twist_pitch_factor, fill_factor, labor_hours, labor_rate_usd, cost_on_purchased, spare_pcts, cut_round_mm)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            p.name,
            p.harness_code,
            p.client,
            p.revision,
            p.main_connector_instance_id,
            p.markup_pct,
            p.default_cut_margin_pct,
            p.default_twist_pitch_factor,
            p.fill_factor,
            p.labor_hours,
            p.labor_rate_usd,
            p.cost_on_purchased,
            serde_json::to_string(&p.spare_pcts).expect("un mapa de números siempre se serializa"),
            p.cut_round_mm,
        ],
    )?;

    for n in &data.nodes {
        tx.execute(
            "INSERT INTO nodes (id, kind, termination, termination_library_part_id, diagram_x, diagram_y, adhesive_heatshrink_length_mm) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![n.id, n.kind, n.termination, n.termination_library_part_id, n.diagram_x, n.diagram_y, n.adhesive_heatshrink_length_mm],
        )?;
    }

    for s in &data.segments {
        tx.execute(
            "INSERT INTO segments (id, node_a_id, node_b_id, length_mm, twist_pitch_mm, covering_library_part_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![s.id, s.node_a_id, s.node_b_id, s.length_mm, s.twist_pitch_mm, s.covering_library_part_id],
        )?;
    }

    for c in &data.connector_instances {
        tx.execute(
            "INSERT INTO connector_instances (id, short_id, name, library_part_id, device_connector_id, node_id, termination, termination_library_part_id, backshell_library_part_id, status, is_interconnect, mates_with)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                c.id,
                c.short_id,
                c.name,
                c.library_part_id,
                c.device_connector_id,
                c.node_id,
                c.termination,
                c.termination_library_part_id,
                c.backshell_library_part_id,
                c.status,
                c.is_interconnect as i64,
                c.mates_with,
            ],
        )?;
        for cav in &c.cavities {
            tx.execute(
                "INSERT INTO cavity_assignments (id, connector_instance_id, cavity_id, external_reference)
                 VALUES (?1, ?2, ?3, ?4)",
                params![cav.id, c.id, cav.cavity_id, cav.external_reference],
            )?;
        }
    }

    for g in &data.ground_points {
        tx.execute(
            "INSERT INTO ground_points (id, short_id, name, terminal_library_part_id, node_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![g.id, g.short_id, g.name, g.terminal_library_part_id, g.node_id],
        )?;
    }

    for s in &data.splice_instances {
        tx.execute(
            "INSERT INTO splice_instances (id, short_id, library_part_id, node_id, segment_id, offset_from_end_mm, offset_from_node_id, name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                s.id,
                s.short_id,
                s.library_part_id,
                s.node_id,
                s.segment_id,
                s.offset_from_end_mm,
                s.offset_from_node_id,
                s.name,
            ],
        )?;
    }

    for c in &data.component_instances {
        tx.execute(
            "INSERT INTO component_instances (id, short_id, name, library_part_id, node_id, segment_id, offset_from_end_mm, offset_from_node_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                c.id,
                c.short_id,
                c.name,
                c.library_part_id,
                c.node_id,
                c.segment_id,
                c.offset_from_end_mm,
                c.offset_from_node_id,
            ],
        )?;
    }

    for w in &data.wire_instances {
        tx.execute(
            "INSERT INTO wire_instances (id, short_id, library_part_id, color, signal_type_id, specific_name, manual_cut_margin_pct, manual_length_mm, label,
                                          end_a_kind, end_a_cavity_assignment_id, end_a_splice_id, end_a_ground_point_id, end_a_component_instance_id,
                                          end_b_kind, end_b_cavity_assignment_id, end_b_splice_id, end_b_ground_point_id, end_b_component_instance_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                w.id,
                w.short_id,
                w.library_part_id,
                w.color,
                w.signal_type_id,
                w.specific_name,
                w.manual_cut_margin_pct,
                w.manual_length_mm,
                w.label,
                w.end_a.kind,
                w.end_a.cavity_assignment_id,
                w.end_a.splice_id,
                w.end_a.ground_point_id,
                w.end_a.component_instance_id,
                w.end_b.kind,
                w.end_b.cavity_assignment_id,
                w.end_b.splice_id,
                w.end_b.ground_point_id,
                w.end_b.component_instance_id,
            ],
        )?;
    }

    for g in &data.twist_groups {
        tx.execute(
            "INSERT INTO twist_groups (id, name, shielded, drain) VALUES (?1, ?2, ?3, ?4)",
            params![g.id, g.name, g.shielded as i64, g.drain as i64],
        )?;
        for wire_instance_id in &g.wire_instance_ids {
            tx.execute(
                "INSERT INTO twist_group_wires (twist_group_id, wire_instance_id) VALUES (?1, ?2)",
                params![g.id, wire_instance_id],
            )?;
        }
    }

    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::model::project::load;
    use crate::model::project::test_fixtures::*;

    #[test]
    fn round_trips_a_project_with_a_splice_on_a_segment_and_a_twist_group() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(db::PROJECT_SCHEMA).unwrap();

        let data = sample();
        save(&mut conn, &data).unwrap();
        let loaded = load(&conn).unwrap();
        assert_eq!(loaded, data);
    }
}
