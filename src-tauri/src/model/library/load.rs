//! Leer la biblioteca del archivo SQLite.

use super::{
    AccessoryDef, AccessoryDefConnectorMatch, ComponentDef, ConnectorDef, ConnectorDefCavity,
    ContactDef, CoveringDef, DeviceDef, DeviceDefConnector, DeviceDefPin, Library, Part,
    SealPlugDef, SignalType, SpliceDef, TMoldDef, TMoldLeg, WireDef, WireDefConductor,
};
use rusqlite::{params, Connection, Result};

pub fn load(conn: &Connection) -> Result<Library> {
    let mut parts_stmt = conn.prepare(
        "SELECT id, part_number, manufacturer, description, category, purchase_unit, qty_per_pack, price_usd, price_date FROM parts",
    )?;
    let parts = parts_stmt
        .query_map([], |row| {
            Ok(Part {
                id: row.get(0)?,
                part_number: row.get(1)?,
                manufacturer: row.get(2)?,
                description: row.get(3)?,
                category: row.get(4)?,
                purchase_unit: row.get(5)?,
                qty_per_pack: row.get(6)?,
                price_usd: row.get(7)?,
                price_date: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut connector_defs_stmt = conn.prepare(
        "SELECT part_id, gender, series, shell_size, counterpart_id, back_shape, back_diameter_mm, back_width_mm, back_height_mm, suggested_termination, contact_part_id, seal_plug_part_id, adhesive_heatshrink_length_mm FROM connector_defs",
    )?;
    let mut connector_defs = connector_defs_stmt
        .query_map([], |row| {
            Ok(ConnectorDef {
                part_id: row.get(0)?,
                gender: row.get(1)?,
                series: row.get(2)?,
                shell_size: row.get(3)?,
                counterpart_id: row.get(4)?,
                back_shape: row.get(5)?,
                back_diameter_mm: row.get(6)?,
                back_width_mm: row.get(7)?,
                back_height_mm: row.get(8)?,
                suggested_termination: row.get(9)?,
                contact_part_id: row.get(10)?,
                seal_plug_part_id: row.get(11)?,
                adhesive_heatshrink_length_mm: row.get(12)?,
                cavities: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    for connector_def in &mut connector_defs {
        let mut cavities_stmt = conn.prepare_cached(
            "SELECT cavity_id, contact_size FROM connector_def_cavities WHERE connector_def_id = ?1 ORDER BY rowid",
        )?;
        connector_def.cavities = cavities_stmt
            .query_map(params![connector_def.part_id], |row| {
                Ok(ConnectorDefCavity {
                    cavity_id: row.get(0)?,
                    contact_size: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
    }

    let mut device_defs_stmt = conn.prepare("SELECT part_id FROM device_defs")?;
    let device_def_ids = device_defs_stmt
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>>>()?;
    let mut device_defs = Vec::new();
    for part_id in device_def_ids {
        let mut connectors_stmt = conn.prepare_cached(
            "SELECT id, label, connector_def_id FROM device_def_connectors WHERE device_def_id = ?1 ORDER BY rowid",
        )?;
        let mut connectors = connectors_stmt
            .query_map(params![part_id], |row| {
                Ok(DeviceDefConnector {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    connector_def_id: row.get(2)?,
                    pins: Vec::new(),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        for connector in &mut connectors {
            let mut pins_stmt = conn.prepare_cached(
                "SELECT id, cavity_id, name, function FROM device_def_pins WHERE device_def_connector_id = ?1 ORDER BY rowid",
            )?;
            connector.pins = pins_stmt
                .query_map(params![connector.id], |row| {
                    Ok(DeviceDefPin {
                        id: row.get(0)?,
                        cavity_id: row.get(1)?,
                        name: row.get(2)?,
                        function: row.get(3)?,
                    })
                })?
                .collect::<Result<Vec<_>>>()?;
        }

        device_defs.push(DeviceDef {
            part_id,
            connectors,
        });
    }

    let mut contact_defs_stmt = conn
        .prepare("SELECT part_id, gender, contact_size, gauge_min, gauge_max FROM contact_defs")?;
    let contact_defs = contact_defs_stmt
        .query_map([], |row| {
            Ok(ContactDef {
                part_id: row.get(0)?,
                gender: row.get(1)?,
                contact_size: row.get(2)?,
                gauge_min: row.get(3)?,
                gauge_max: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut seal_plug_defs_stmt =
        conn.prepare("SELECT part_id, contact_size FROM seal_plug_defs")?;
    let seal_plug_defs = seal_plug_defs_stmt
        .query_map([], |row| {
            Ok(SealPlugDef {
                part_id: row.get(0)?,
                contact_size: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut wire_defs_stmt = conn.prepare(
        "SELECT part_id, gauge, spec, color, outer_diameter_mm, default_cut_margin_pct FROM wire_defs",
    )?;
    let mut wire_defs = wire_defs_stmt
        .query_map([], |row| {
            Ok(WireDef {
                part_id: row.get(0)?,
                gauge: row.get(1)?,
                spec: row.get(2)?,
                color: row.get(3)?,
                outer_diameter_mm: row.get(4)?,
                default_cut_margin_pct: row.get(5)?,
                conductors: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    for wire_def in &mut wire_defs {
        let mut conductors_stmt = conn.prepare_cached(
            "SELECT id, label, gauge, color, is_shield FROM wire_def_conductors WHERE wire_def_id = ?1 ORDER BY rowid",
        )?;
        wire_def.conductors = conductors_stmt
            .query_map(params![wire_def.part_id], |row| {
                Ok(WireDefConductor {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    gauge: row.get(2)?,
                    color: row.get(3)?,
                    is_shield: row.get::<_, i64>(4)? != 0,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
    }

    let mut splice_defs_stmt =
        conn.prepare("SELECT part_id, gauge_min, gauge_max, max_wires FROM splice_defs")?;
    let splice_defs = splice_defs_stmt
        .query_map([], |row| {
            Ok(SpliceDef {
                part_id: row.get(0)?,
                gauge_min: row.get(1)?,
                gauge_max: row.get(2)?,
                max_wires: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut component_defs_stmt =
        conn.prepare("SELECT part_id, component_type, value, package FROM component_defs")?;
    let component_defs = component_defs_stmt
        .query_map([], |row| {
            Ok(ComponentDef {
                part_id: row.get(0)?,
                component_type: row.get(1)?,
                value: row.get(2)?,
                package: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut covering_defs_stmt = conn.prepare(
        "SELECT part_id, supplied_diameter_mm, shrunk_diameter_mm, shrunk_wall_thickness_mm, has_adhesive FROM covering_defs",
    )?;
    let covering_defs = covering_defs_stmt
        .query_map([], |row| {
            Ok(CoveringDef {
                part_id: row.get(0)?,
                supplied_diameter_mm: row.get(1)?,
                shrunk_diameter_mm: row.get(2)?,
                shrunk_wall_thickness_mm: row.get(3)?,
                has_adhesive: row.get::<_, i64>(4)? != 0,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut accessory_defs_stmt = conn.prepare(
        "SELECT part_id, orientation, cable_side_min_diameter_mm, cable_side_max_diameter_mm, leg_length_mm, overlap_mm FROM accessory_defs",
    )?;
    let mut accessory_defs = accessory_defs_stmt
        .query_map([], |row| {
            Ok(AccessoryDef {
                part_id: row.get(0)?,
                orientation: row.get(1)?,
                cable_side_min_diameter_mm: row.get(2)?,
                cable_side_max_diameter_mm: row.get(3)?,
                leg_length_mm: row.get(4)?,
                overlap_mm: row.get(5)?,
                compatible_connectors: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    for accessory_def in &mut accessory_defs {
        let mut matches_stmt = conn.prepare_cached(
            "SELECT series, shell_size FROM accessory_def_connector_matches WHERE accessory_def_id = ?1 ORDER BY rowid",
        )?;
        accessory_def.compatible_connectors = matches_stmt
            .query_map(params![accessory_def.part_id], |row| {
                Ok(AccessoryDefConnectorMatch {
                    series: row.get(0)?,
                    shell_size: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
    }

    let mut t_mold_defs_stmt = conn.prepare("SELECT part_id, overlap_mm FROM t_mold_defs")?;
    let mut t_mold_defs = t_mold_defs_stmt
        .query_map([], |row| {
            Ok(TMoldDef {
                part_id: row.get(0)?,
                overlap_mm: row.get(1)?,
                legs: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    for t_mold_def in &mut t_mold_defs {
        let mut legs_stmt = conn.prepare_cached(
            "SELECT min_diameter_mm, max_diameter_mm, leg_length_mm FROM t_mold_def_legs WHERE t_mold_def_id = ?1 ORDER BY position",
        )?;
        t_mold_def.legs = legs_stmt
            .query_map(params![t_mold_def.part_id], |row| {
                Ok(TMoldLeg {
                    min_diameter_mm: row.get(0)?,
                    max_diameter_mm: row.get(1)?,
                    leg_length_mm: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
    }

    let mut signal_types_stmt = conn.prepare("SELECT id, name, default_color FROM signal_types")?;
    let signal_types = signal_types_stmt
        .query_map([], |row| {
            Ok(SignalType {
                id: row.get(0)?,
                name: row.get(1)?,
                default_color: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(Library {
        parts,
        connector_defs,
        device_defs,
        contact_defs,
        seal_plug_defs,
        wire_defs,
        splice_defs,
        covering_defs,
        accessory_defs,
        t_mold_defs,
        component_defs,
        signal_types,
    })
}
