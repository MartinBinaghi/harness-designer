//! Modelo en memoria de un proyecto (= un arnés). Ver ../../../CLAUDE.md sección 4.2
//! y ../../schema/project.sql.
//!
//! Los `library_part_id` referencian filas de la biblioteca (archivo separado);
//! no se validan acá, es responsabilidad de la capa de chequeos (etapa 2).

use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub harness_code: String,
    pub client: Option<String>,
    pub revision: Option<String>,
    pub format_version: i64,
    pub main_connector_instance_id: Option<i64>,
    pub markup_pct: f64,
    pub default_cut_margin_pct: f64,
    pub default_twist_pitch_factor: f64,
    pub fill_factor: f64,
    pub labor_hours: f64,
    pub labor_rate_usd: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceInstance {
    pub id: i64,
    pub name: String,
    pub library_part_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: i64,
    pub kind: String,
    pub termination: Option<String>,
    /// Solo tiene sentido con `termination = "adhesive_heatshrink"` (referencia a
    /// un `CoveringDef`); "t_mold" todavía no elige una parte específica.
    pub termination_library_part_id: Option<i64>,
    /// Posición en el diagrama de armado (no escalado, plan 10.2). `None` hasta
    /// que se acomoda a mano o con el layout automático.
    pub diagram_x: Option<f64>,
    pub diagram_y: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    pub id: i64,
    pub node_a_id: i64,
    pub node_b_id: i64,
    pub length_mm: f64,
    pub twist_pitch_mm: Option<f64>,
    pub covering_library_part_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CavityAssignment {
    pub id: i64,
    pub cavity_id: String,
    pub contact_library_part_id: Option<i64>,
    pub seal_plug_library_part_id: Option<i64>,
    pub external_reference: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConnectorInstance {
    pub id: i64,
    pub short_id: String,
    pub name: String,
    pub library_part_id: i64,
    pub device_instance_id: Option<i64>,
    pub node_id: i64,
    pub termination: Option<String>,
    /// `AccessoryDef` si `termination` es boot_straight/boot_90, `CoveringDef` si es adhesive_heatshrink.
    pub termination_library_part_id: Option<i64>,
    pub backshell_library_part_id: Option<i64>,
    pub status: String,
    pub is_interconnect: bool,
    pub mates_with: Option<String>,
    pub cavities: Vec<CavityAssignment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GroundPoint {
    pub id: i64,
    pub short_id: String,
    pub name: String,
    pub terminal_library_part_id: Option<i64>,
    pub node_id: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpliceInstance {
    pub id: i64,
    pub short_id: String,
    pub library_part_id: i64,
    pub node_id: Option<i64>,
    pub segment_id: Option<i64>,
    pub offset_from_end_mm: Option<f64>,
    pub offset_from_node_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentInstance {
    pub id: i64,
    pub short_id: String,
    pub name: String,
    pub library_part_id: i64,
    pub node_id: Option<i64>,
    pub segment_id: Option<i64>,
    pub offset_from_end_mm: Option<f64>,
    pub offset_from_node_id: Option<i64>,
}

/// Un extremo de cable: `kind` dice cuál de los cuatro ids aplica.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WireEnd {
    pub kind: String,
    pub cavity_assignment_id: Option<i64>,
    pub splice_id: Option<i64>,
    pub ground_point_id: Option<i64>,
    pub component_instance_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WireInstance {
    pub id: i64,
    pub short_id: String,
    pub library_part_id: i64,
    pub color: Option<String>,
    pub signal_type_id: Option<i64>,
    pub specific_name: Option<String>,
    pub manual_cut_margin_pct: Option<f64>,
    pub label: Option<String>,
    pub end_a: WireEnd,
    pub end_b: WireEnd,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TwistGroup {
    pub id: i64,
    pub name: String,
    pub shielded: bool,
    pub drain: bool,
    pub wire_instance_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectData {
    pub project: Project,
    pub device_instances: Vec<DeviceInstance>,
    pub nodes: Vec<Node>,
    pub segments: Vec<Segment>,
    pub connector_instances: Vec<ConnectorInstance>,
    pub ground_points: Vec<GroundPoint>,
    pub splice_instances: Vec<SpliceInstance>,
    pub component_instances: Vec<ComponentInstance>,
    pub wire_instances: Vec<WireInstance>,
    pub twist_groups: Vec<TwistGroup>,
}

fn wire_end(kind: String, a: Option<i64>, b: Option<i64>, c: Option<i64>, d: Option<i64>) -> WireEnd {
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
        "SELECT name, harness_code, client, revision, format_version, main_connector_instance_id, markup_pct, default_cut_margin_pct, default_twist_pitch_factor, fill_factor, labor_hours, labor_rate_usd
         FROM project WHERE id = 1",
        [],
        |row| {
            Ok(Project {
                name: row.get(0)?,
                harness_code: row.get(1)?,
                client: row.get(2)?,
                revision: row.get(3)?,
                format_version: row.get(4)?,
                main_connector_instance_id: row.get(5)?,
                markup_pct: row.get(6)?,
                default_cut_margin_pct: row.get(7)?,
                default_twist_pitch_factor: row.get(8)?,
                fill_factor: row.get(9)?,
                labor_hours: row.get(10)?,
                labor_rate_usd: row.get(11)?,
            })
        },
    )?;

    let mut device_instances_stmt =
        conn.prepare("SELECT id, name, library_part_id FROM device_instances")?;
    let device_instances = device_instances_stmt
        .query_map([], |row| {
            Ok(DeviceInstance {
                id: row.get(0)?,
                name: row.get(1)?,
                library_part_id: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut nodes_stmt =
        conn.prepare("SELECT id, kind, termination, termination_library_part_id, diagram_x, diagram_y FROM nodes")?;
    let nodes = nodes_stmt
        .query_map([], |row| {
            Ok(Node {
                id: row.get(0)?,
                kind: row.get(1)?,
                termination: row.get(2)?,
                termination_library_part_id: row.get(3)?,
                diagram_x: row.get(4)?,
                diagram_y: row.get(5)?,
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
        "SELECT id, short_id, name, library_part_id, device_instance_id, node_id, termination, termination_library_part_id, backshell_library_part_id, status, is_interconnect, mates_with FROM connector_instances",
    )?;
    let mut connector_instances = connector_instances_stmt
        .query_map([], |row| {
            Ok(ConnectorInstance {
                id: row.get(0)?,
                short_id: row.get(1)?,
                name: row.get(2)?,
                library_part_id: row.get(3)?,
                device_instance_id: row.get(4)?,
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
            "SELECT id, cavity_id, contact_library_part_id, seal_plug_library_part_id, external_reference FROM cavity_assignments WHERE connector_instance_id = ?1 ORDER BY rowid",
        )?;
        connector_instance.cavities = cavities_stmt
            .query_map(params![connector_instance.id], |row| {
                Ok(CavityAssignment {
                    id: row.get(0)?,
                    cavity_id: row.get(1)?,
                    contact_library_part_id: row.get(2)?,
                    seal_plug_library_part_id: row.get(3)?,
                    external_reference: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
    }

    let mut ground_points_stmt =
        conn.prepare("SELECT id, short_id, name, terminal_library_part_id, node_id FROM ground_points")?;
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

    let mut splice_instances_stmt = conn.prepare(
        "SELECT id, short_id, library_part_id, node_id, segment_id, offset_from_end_mm, offset_from_node_id FROM splice_instances",
    )?;
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
        "SELECT id, short_id, library_part_id, color, signal_type_id, specific_name, manual_cut_margin_pct, label,
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
                label: row.get(7)?,
                end_a: wire_end(row.get(8)?, row.get(9)?, row.get(10)?, row.get(11)?, row.get(12)?),
                end_b: wire_end(row.get(13)?, row.get(14)?, row.get(15)?, row.get(16)?, row.get(17)?),
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut twist_groups_stmt = conn.prepare("SELECT id, name, shielded, drain FROM twist_groups")?;
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
        device_instances,
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
        "device_instances",
        "project",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }

    let p = &data.project;
    tx.execute(
        "INSERT INTO project (id, name, harness_code, client, revision, format_version, main_connector_instance_id, markup_pct, default_cut_margin_pct, default_twist_pitch_factor, fill_factor, labor_hours, labor_rate_usd)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            p.name,
            p.harness_code,
            p.client,
            p.revision,
            p.format_version,
            p.main_connector_instance_id,
            p.markup_pct,
            p.default_cut_margin_pct,
            p.default_twist_pitch_factor,
            p.fill_factor,
            p.labor_hours,
            p.labor_rate_usd,
        ],
    )?;

    for d in &data.device_instances {
        tx.execute(
            "INSERT INTO device_instances (id, name, library_part_id) VALUES (?1, ?2, ?3)",
            params![d.id, d.name, d.library_part_id],
        )?;
    }

    for n in &data.nodes {
        tx.execute(
            "INSERT INTO nodes (id, kind, termination, termination_library_part_id, diagram_x, diagram_y) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![n.id, n.kind, n.termination, n.termination_library_part_id, n.diagram_x, n.diagram_y],
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
            "INSERT INTO connector_instances (id, short_id, name, library_part_id, device_instance_id, node_id, termination, termination_library_part_id, backshell_library_part_id, status, is_interconnect, mates_with)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                c.id,
                c.short_id,
                c.name,
                c.library_part_id,
                c.device_instance_id,
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
                "INSERT INTO cavity_assignments (id, connector_instance_id, cavity_id, contact_library_part_id, seal_plug_library_part_id, external_reference)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    cav.id,
                    c.id,
                    cav.cavity_id,
                    cav.contact_library_part_id,
                    cav.seal_plug_library_part_id,
                    cav.external_reference,
                ],
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
            "INSERT INTO splice_instances (id, short_id, library_part_id, node_id, segment_id, offset_from_end_mm, offset_from_node_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                s.id,
                s.short_id,
                s.library_part_id,
                s.node_id,
                s.segment_id,
                s.offset_from_end_mm,
                s.offset_from_node_id,
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
            "INSERT INTO wire_instances (id, short_id, library_part_id, color, signal_type_id, specific_name, manual_cut_margin_pct, label,
                                          end_a_kind, end_a_cavity_assignment_id, end_a_splice_id, end_a_ground_point_id, end_a_component_instance_id,
                                          end_b_kind, end_b_cavity_assignment_id, end_b_splice_id, end_b_ground_point_id, end_b_component_instance_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                w.id,
                w.short_id,
                w.library_part_id,
                w.color,
                w.signal_type_id,
                w.specific_name,
                w.manual_cut_margin_pct,
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

    fn sample() -> ProjectData {
        ProjectData {
            project: Project {
                name: "Cableado Motor".into(),
                harness_code: "MOT-01".into(),
                client: None,
                revision: Some("A".into()),
                format_version: 1,
                main_connector_instance_id: Some(1),
                markup_pct: 0.0,
                default_cut_margin_pct: 10.0,
                default_twist_pitch_factor: 8.0,
                fill_factor: 0.75,
                labor_hours: 3.5,
                labor_rate_usd: 25.0,
            },
            device_instances: vec![DeviceInstance {
                id: 1,
                name: "PDM30".into(),
                library_part_id: Some(2),
            }],
            nodes: vec![
                Node { id: 1, kind: "connector_end".into(), termination: None, termination_library_part_id: None, diagram_x: None, diagram_y: None },
                Node { id: 2, kind: "breakout".into(), termination: Some("t_mold".into()), termination_library_part_id: None, diagram_x: Some(120.5), diagram_y: Some(-40.0) },
                Node { id: 3, kind: "connector_end".into(), termination: None, termination_library_part_id: None, diagram_x: None, diagram_y: None },
            ],
            segments: vec![Segment {
                id: 1,
                node_a_id: 1,
                node_b_id: 2,
                length_mm: 450.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            }],
            connector_instances: vec![ConnectorInstance {
                id: 1,
                short_id: "X1".into(),
                name: "Damper FL".into(),
                library_part_id: 1,
                device_instance_id: None,
                node_id: 1,
                termination: Some("boot_straight".into()),
                termination_library_part_id: None,
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![CavityAssignment {
                    id: 1,
                    cavity_id: "1".into(),
                    contact_library_part_id: Some(10),
                    seal_plug_library_part_id: None,
                    external_reference: None,
                }],
            }],
            ground_points: vec![GroundPoint {
                id: 1,
                short_id: "G1".into(),
                name: "Masa chasis".into(),
                terminal_library_part_id: None,
                node_id: 3,
            }],
            splice_instances: vec![SpliceInstance {
                id: 1,
                short_id: "SP1".into(),
                library_part_id: 20,
                node_id: None,
                segment_id: Some(1),
                offset_from_end_mm: Some(20.0),
                offset_from_node_id: Some(1),
            }],
            component_instances: vec![ComponentInstance {
                id: 1,
                short_id: "R1".into(),
                name: "Terminación CAN 100R".into(),
                library_part_id: 30,
                node_id: Some(3),
                segment_id: None,
                offset_from_end_mm: None,
                offset_from_node_id: None,
            }],
            wire_instances: vec![WireInstance {
                id: 1,
                short_id: "W001".into(),
                library_part_id: 3,
                color: Some("red".into()),
                signal_type_id: Some(1),
                specific_name: Some("Damper FL".into()),
                manual_cut_margin_pct: None,
                label: None,
                end_a: wire_end("cavity".into(), Some(1), None, None, None),
                end_b: wire_end("splice".into(), None, Some(1), None, None),
            }],
            twist_groups: vec![TwistGroup {
                id: 1,
                name: "twist I".into(),
                shielded: true,
                drain: true,
                wire_instance_ids: vec![1],
            }],
        }
    }

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
