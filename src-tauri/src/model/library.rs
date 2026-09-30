//! Modelo en memoria de la biblioteca de partes. Ver ../../../CLAUDE.md sección 4.1
//! y ../../schema/library.sql.
//!
//! Los campos con valores restringidos (gender, category, ...) se guardan como
//! `String`: SQLite ya valida los valores permitidos con CHECK, duplicarlo como
//! enum de Rust no agrega nada a esta escala.

use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Part {
    pub id: i64,
    pub part_number: String,
    pub manufacturer: Option<String>,
    pub description: Option<String>,
    pub category: String,
    pub purchase_unit: String,
    pub qty_per_pack: f64,
    pub price_usd: Option<f64>,
    pub price_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConnectorDefCavity {
    pub cavity_id: String,
    pub contact_size: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConnectorDef {
    pub part_id: i64,
    pub gender: String,
    pub series: Option<String>,
    pub shell_size: Option<String>,
    pub cavity_count: i64,
    pub counterpart_id: Option<i64>,
    pub back_diameter_mm: Option<f64>,
    pub suggested_termination: Option<String>,
    pub image_side_path: Option<String>,
    pub image_front_path: Option<String>,
    pub image_back_path: Option<String>,
    pub cavities: Vec<ConnectorDefCavity>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceDefPin {
    pub id: i64,
    pub cavity_id: String,
    pub name: String,
    pub function: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceDefConnector {
    pub id: i64,
    pub label: String,
    pub connector_def_id: i64,
    pub pins: Vec<DeviceDefPin>,
}

/// Pines en paralelo (misma salida en varios pines, ej. PDM30 OUT1 = A1 + A10).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceDefPinGroup {
    pub id: i64,
    pub name: String,
    pub pin_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceDef {
    pub part_id: i64,
    pub connectors: Vec<DeviceDefConnector>,
    pub pin_groups: Vec<DeviceDefPinGroup>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContactDef {
    pub part_id: i64,
    pub gender: String,
    pub contact_size: String,
    pub gauge_min: Option<String>,
    pub gauge_max: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SealPlugDef {
    pub part_id: i64,
    pub contact_size: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WireDefConductor {
    pub id: i64,
    pub label: Option<String>,
    pub gauge: Option<String>,
    pub color: Option<String>,
    pub is_shield: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WireDef {
    pub part_id: i64,
    pub gauge: String,
    pub spec: Option<String>,
    pub color: Option<String>,
    pub outer_diameter_mm: f64,
    pub default_cut_margin_pct: Option<f64>,
    pub conductors: Vec<WireDefConductor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpliceDef {
    pub part_id: i64,
    pub gauge_min: Option<String>,
    pub gauge_max: Option<String>,
    pub max_wires: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentDef {
    pub part_id: i64,
    pub component_type: String,
    pub value: Option<String>,
    pub package: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoveringDef {
    pub part_id: i64,
    pub supplied_diameter_mm: f64,
    pub shrunk_diameter_mm: f64,
    pub shrunk_wall_thickness_mm: f64,
    pub has_adhesive: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccessoryDefConnectorMatch {
    pub series: String,
    pub shell_size: String,
}

/// Boot (recto/90°). Molde en T y "otros" (backshells, etiquetas) quedan para
/// cuando haya lógica de calce para ellos — ver CLAUDE.md sección 4.1 y 9.3/9.4.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccessoryDef {
    pub part_id: i64,
    pub orientation: String,
    pub cable_side_min_diameter_mm: f64,
    pub cable_side_max_diameter_mm: f64,
    pub leg_length_mm: f64,
    pub overlap_mm: f64,
    pub compatible_connectors: Vec<AccessoryDefConnectorMatch>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TMoldLeg {
    pub min_diameter_mm: f64,
    pub max_diameter_mm: f64,
    pub leg_length_mm: f64,
}

/// Molde en T (transición de breakout), plan 4.1/9.4: 3 patas sin orden
/// semántico fijo — se emparejan con los segmentos del breakout por tamaño
/// al calcular el calce (ver `calc::t_mold_fit`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TMoldDef {
    pub part_id: i64,
    pub overlap_mm: f64,
    pub legs: Vec<TMoldLeg>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalType {
    pub id: i64,
    pub name: String,
    pub default_color: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Library {
    pub parts: Vec<Part>,
    pub connector_defs: Vec<ConnectorDef>,
    pub device_defs: Vec<DeviceDef>,
    pub contact_defs: Vec<ContactDef>,
    pub seal_plug_defs: Vec<SealPlugDef>,
    pub wire_defs: Vec<WireDef>,
    pub splice_defs: Vec<SpliceDef>,
    pub component_defs: Vec<ComponentDef>,
    pub covering_defs: Vec<CoveringDef>,
    pub accessory_defs: Vec<AccessoryDef>,
    pub t_mold_defs: Vec<TMoldDef>,
    pub signal_types: Vec<SignalType>,
}

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
        "SELECT part_id, gender, series, shell_size, cavity_count, counterpart_id, back_diameter_mm, suggested_termination, image_side_path, image_front_path, image_back_path FROM connector_defs",
    )?;
    let mut connector_defs = connector_defs_stmt
        .query_map([], |row| {
            Ok(ConnectorDef {
                part_id: row.get(0)?,
                gender: row.get(1)?,
                series: row.get(2)?,
                shell_size: row.get(3)?,
                cavity_count: row.get(4)?,
                counterpart_id: row.get(5)?,
                back_diameter_mm: row.get(6)?,
                suggested_termination: row.get(7)?,
                image_side_path: row.get(8)?,
                image_front_path: row.get(9)?,
                image_back_path: row.get(10)?,
                cavities: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    for connector_def in &mut connector_defs {
        let mut cavities_stmt = conn.prepare(
            "SELECT cavity_id, contact_size FROM connector_def_cavities WHERE connector_def_id = ?1",
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
        let mut connectors_stmt = conn.prepare(
            "SELECT id, label, connector_def_id FROM device_def_connectors WHERE device_def_id = ?1",
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
            let mut pins_stmt = conn.prepare(
                "SELECT id, cavity_id, name, function FROM device_def_pins WHERE device_def_connector_id = ?1",
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

        let mut pin_groups_stmt =
            conn.prepare("SELECT id, name FROM device_def_pin_groups WHERE device_def_id = ?1")?;
        let mut pin_groups = pin_groups_stmt
            .query_map(params![part_id], |row| {
                Ok(DeviceDefPinGroup {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    pin_ids: Vec::new(),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        for group in &mut pin_groups {
            let mut members_stmt = conn
                .prepare("SELECT pin_id FROM device_def_pin_group_members WHERE group_id = ?1")?;
            group.pin_ids = members_stmt
                .query_map(params![group.id], |row| row.get::<_, i64>(0))?
                .collect::<Result<Vec<_>>>()?;
        }

        device_defs.push(DeviceDef {
            part_id,
            connectors,
            pin_groups,
        });
    }

    let mut contact_defs_stmt =
        conn.prepare("SELECT part_id, gender, contact_size, gauge_min, gauge_max FROM contact_defs")?;
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

    let mut seal_plug_defs_stmt = conn.prepare("SELECT part_id, contact_size FROM seal_plug_defs")?;
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
        let mut conductors_stmt = conn.prepare(
            "SELECT id, label, gauge, color, is_shield FROM wire_def_conductors WHERE wire_def_id = ?1",
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
        let mut matches_stmt = conn.prepare(
            "SELECT series, shell_size FROM accessory_def_connector_matches WHERE accessory_def_id = ?1",
        )?;
        accessory_def.compatible_connectors = matches_stmt
            .query_map(params![accessory_def.part_id], |row| {
                Ok(AccessoryDefConnectorMatch { series: row.get(0)?, shell_size: row.get(1)? })
            })?
            .collect::<Result<Vec<_>>>()?;
    }

    let mut t_mold_defs_stmt = conn.prepare("SELECT part_id, overlap_mm FROM t_mold_defs")?;
    let mut t_mold_defs = t_mold_defs_stmt
        .query_map([], |row| Ok(TMoldDef { part_id: row.get(0)?, overlap_mm: row.get(1)?, legs: Vec::new() }))?
        .collect::<Result<Vec<_>>>()?;
    for t_mold_def in &mut t_mold_defs {
        let mut legs_stmt = conn.prepare(
            "SELECT min_diameter_mm, max_diameter_mm, leg_length_mm FROM t_mold_def_legs WHERE t_mold_def_id = ?1 ORDER BY position",
        )?;
        t_mold_def.legs = legs_stmt
            .query_map(params![t_mold_def.part_id], |row| {
                Ok(TMoldLeg { min_diameter_mm: row.get(0)?, max_diameter_mm: row.get(1)?, leg_length_mm: row.get(2)? })
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

/// Reemplaza el contenido entero de la biblioteca. A esta escala (una biblioteca
/// personal, no miles de partes) es más simple que diffear contra lo existente.
pub fn save(conn: &mut Connection, library: &Library) -> Result<()> {
    let tx = conn.transaction()?;
    for table in [
        "device_def_pin_group_members",
        "device_def_pin_groups",
        "device_def_pins",
        "device_def_connectors",
        "device_defs",
        "wire_def_conductors",
        "wire_defs",
        "connector_def_cavities",
        "connector_defs",
        "contact_defs",
        "seal_plug_defs",
        "splice_defs",
        "component_defs",
        "accessory_def_connector_matches",
        "accessory_defs",
        "t_mold_def_legs",
        "t_mold_defs",
        "covering_defs",
        "signal_types",
        "parts",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }

    for part in &library.parts {
        tx.execute(
            "INSERT INTO parts (id, part_number, manufacturer, description, category, purchase_unit, qty_per_pack, price_usd, price_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                part.id,
                part.part_number,
                part.manufacturer,
                part.description,
                part.category,
                part.purchase_unit,
                part.qty_per_pack,
                part.price_usd,
                part.price_date,
            ],
        )?;
    }

    for connector_def in &library.connector_defs {
        tx.execute(
            "INSERT INTO connector_defs (part_id, gender, series, shell_size, cavity_count, counterpart_id, back_diameter_mm, suggested_termination, image_side_path, image_front_path, image_back_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                connector_def.part_id,
                connector_def.gender,
                connector_def.series,
                connector_def.shell_size,
                connector_def.cavity_count,
                connector_def.counterpart_id,
                connector_def.back_diameter_mm,
                connector_def.suggested_termination,
                connector_def.image_side_path,
                connector_def.image_front_path,
                connector_def.image_back_path,
            ],
        )?;
        for cavity in &connector_def.cavities {
            tx.execute(
                "INSERT INTO connector_def_cavities (connector_def_id, cavity_id, contact_size) VALUES (?1, ?2, ?3)",
                params![connector_def.part_id, cavity.cavity_id, cavity.contact_size],
            )?;
        }
    }

    for device_def in &library.device_defs {
        tx.execute(
            "INSERT INTO device_defs (part_id) VALUES (?1)",
            params![device_def.part_id],
        )?;
        for connector in &device_def.connectors {
            tx.execute(
                "INSERT INTO device_def_connectors (id, device_def_id, label, connector_def_id) VALUES (?1, ?2, ?3, ?4)",
                params![connector.id, device_def.part_id, connector.label, connector.connector_def_id],
            )?;
            for pin in &connector.pins {
                tx.execute(
                    "INSERT INTO device_def_pins (id, device_def_connector_id, cavity_id, name, function) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![pin.id, connector.id, pin.cavity_id, pin.name, pin.function],
                )?;
            }
        }
        for group in &device_def.pin_groups {
            tx.execute(
                "INSERT INTO device_def_pin_groups (id, device_def_id, name) VALUES (?1, ?2, ?3)",
                params![group.id, device_def.part_id, group.name],
            )?;
            for pin_id in &group.pin_ids {
                tx.execute(
                    "INSERT INTO device_def_pin_group_members (group_id, pin_id) VALUES (?1, ?2)",
                    params![group.id, pin_id],
                )?;
            }
        }
    }

    for contact_def in &library.contact_defs {
        tx.execute(
            "INSERT INTO contact_defs (part_id, gender, contact_size, gauge_min, gauge_max) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                contact_def.part_id,
                contact_def.gender,
                contact_def.contact_size,
                contact_def.gauge_min,
                contact_def.gauge_max,
            ],
        )?;
    }

    for seal_plug_def in &library.seal_plug_defs {
        tx.execute(
            "INSERT INTO seal_plug_defs (part_id, contact_size) VALUES (?1, ?2)",
            params![seal_plug_def.part_id, seal_plug_def.contact_size],
        )?;
    }

    for wire_def in &library.wire_defs {
        tx.execute(
            "INSERT INTO wire_defs (part_id, gauge, spec, color, outer_diameter_mm, default_cut_margin_pct) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                wire_def.part_id,
                wire_def.gauge,
                wire_def.spec,
                wire_def.color,
                wire_def.outer_diameter_mm,
                wire_def.default_cut_margin_pct,
            ],
        )?;
        for conductor in &wire_def.conductors {
            tx.execute(
                "INSERT INTO wire_def_conductors (id, wire_def_id, label, gauge, color, is_shield) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    conductor.id,
                    wire_def.part_id,
                    conductor.label,
                    conductor.gauge,
                    conductor.color,
                    conductor.is_shield as i64,
                ],
            )?;
        }
    }

    for splice_def in &library.splice_defs {
        tx.execute(
            "INSERT INTO splice_defs (part_id, gauge_min, gauge_max, max_wires) VALUES (?1, ?2, ?3, ?4)",
            params![splice_def.part_id, splice_def.gauge_min, splice_def.gauge_max, splice_def.max_wires],
        )?;
    }

    for component_def in &library.component_defs {
        tx.execute(
            "INSERT INTO component_defs (part_id, component_type, value, package) VALUES (?1, ?2, ?3, ?4)",
            params![
                component_def.part_id,
                component_def.component_type,
                component_def.value,
                component_def.package,
            ],
        )?;
    }

    for covering_def in &library.covering_defs {
        tx.execute(
            "INSERT INTO covering_defs (part_id, supplied_diameter_mm, shrunk_diameter_mm, shrunk_wall_thickness_mm, has_adhesive) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                covering_def.part_id,
                covering_def.supplied_diameter_mm,
                covering_def.shrunk_diameter_mm,
                covering_def.shrunk_wall_thickness_mm,
                covering_def.has_adhesive as i64,
            ],
        )?;
    }

    for accessory_def in &library.accessory_defs {
        tx.execute(
            "INSERT INTO accessory_defs (part_id, orientation, cable_side_min_diameter_mm, cable_side_max_diameter_mm, leg_length_mm, overlap_mm) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                accessory_def.part_id,
                accessory_def.orientation,
                accessory_def.cable_side_min_diameter_mm,
                accessory_def.cable_side_max_diameter_mm,
                accessory_def.leg_length_mm,
                accessory_def.overlap_mm,
            ],
        )?;
        for m in &accessory_def.compatible_connectors {
            tx.execute(
                "INSERT INTO accessory_def_connector_matches (accessory_def_id, series, shell_size) VALUES (?1, ?2, ?3)",
                params![accessory_def.part_id, m.series, m.shell_size],
            )?;
        }
    }

    for t_mold_def in &library.t_mold_defs {
        tx.execute(
            "INSERT INTO t_mold_defs (part_id, overlap_mm) VALUES (?1, ?2)",
            params![t_mold_def.part_id, t_mold_def.overlap_mm],
        )?;
        for (position, leg) in t_mold_def.legs.iter().enumerate() {
            tx.execute(
                "INSERT INTO t_mold_def_legs (t_mold_def_id, position, min_diameter_mm, max_diameter_mm, leg_length_mm) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![t_mold_def.part_id, position as i64, leg.min_diameter_mm, leg.max_diameter_mm, leg.leg_length_mm],
            )?;
        }
    }

    for signal_type in &library.signal_types {
        tx.execute(
            "INSERT INTO signal_types (id, name, default_color) VALUES (?1, ?2, ?3)",
            params![signal_type.id, signal_type.name, signal_type.default_color],
        )?;
    }

    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn round_trips_a_library_with_a_device_and_a_multiconductor_wire() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(db::LIBRARY_SCHEMA).unwrap();

        let library = Library {
            parts: vec![
                Part {
                    id: 1,
                    part_number: "MS3476L20-41P".into(),
                    manufacturer: Some("Amphenol".into()),
                    description: None,
                    category: "connector".into(),
                    purchase_unit: "unit".into(),
                    qty_per_pack: 1.0,
                    price_usd: Some(12.5),
                    price_date: Some("2026-09-01".into()),
                },
                Part {
                    id: 2,
                    part_number: "PDM30".into(),
                    manufacturer: Some("MoTeC".into()),
                    description: None,
                    category: "device".into(),
                    purchase_unit: "unit".into(),
                    qty_per_pack: 1.0,
                    price_usd: None,
                    price_date: None,
                },
                Part {
                    id: 3,
                    part_number: "M22759/32-22-2C".into(),
                    manufacturer: None,
                    description: Some("Par trenzado".into()),
                    category: "wire".into(),
                    purchase_unit: "meter".into(),
                    qty_per_pack: 1.0,
                    price_usd: Some(1.2),
                    price_date: Some("2026-09-01".into()),
                },
                Part {
                    id: 4,
                    part_number: "RNF-100-3/8".into(),
                    manufacturer: Some("Raychem".into()),
                    description: None,
                    category: "covering".into(),
                    purchase_unit: "meter".into(),
                    qty_per_pack: 1.0,
                    price_usd: Some(2.1),
                    price_date: Some("2026-09-01".into()),
                },
                Part {
                    id: 5,
                    part_number: "AMP-BOOT-20-S".into(),
                    manufacturer: Some("TE".into()),
                    description: None,
                    category: "accessory".into(),
                    purchase_unit: "unit".into(),
                    qty_per_pack: 1.0,
                    price_usd: Some(3.4),
                    price_date: Some("2026-09-01".into()),
                },
                Part {
                    id: 6,
                    part_number: "RAYCHEM-TMOLD-1".into(),
                    manufacturer: Some("Raychem".into()),
                    description: None,
                    category: "accessory".into(),
                    purchase_unit: "unit".into(),
                    qty_per_pack: 1.0,
                    price_usd: Some(8.0),
                    price_date: Some("2026-09-01".into()),
                },
            ],
            connector_defs: vec![ConnectorDef {
                part_id: 1,
                gender: "female".into(),
                series: Some("MS".into()),
                shell_size: Some("20".into()),
                cavity_count: 41,
                counterpart_id: None,
                back_diameter_mm: Some(18.0),
                suggested_termination: Some("boot".into()),
                image_side_path: None,
                image_front_path: None,
                image_back_path: None,
                cavities: vec![ConnectorDefCavity {
                    cavity_id: "N".into(),
                    contact_size: "20".into(),
                }],
            }],
            device_defs: vec![DeviceDef {
                part_id: 2,
                connectors: vec![DeviceDefConnector {
                    id: 1,
                    label: "A".into(),
                    connector_def_id: 1,
                    pins: vec![
                        DeviceDefPin {
                            id: 1,
                            cavity_id: "1".into(),
                            name: "OUT1".into(),
                            function: Some("8 A Output 1".into()),
                        },
                        DeviceDefPin {
                            id: 2,
                            cavity_id: "10".into(),
                            name: "OUT1".into(),
                            function: Some("8 A Output 1".into()),
                        },
                    ],
                }],
                pin_groups: vec![DeviceDefPinGroup {
                    id: 1,
                    name: "OUT1".into(),
                    pin_ids: vec![1, 2],
                }],
            }],
            contact_defs: vec![],
            seal_plug_defs: vec![],
            wire_defs: vec![WireDef {
                part_id: 3,
                gauge: "22 AWG".into(),
                spec: Some("M22759/32".into()),
                color: None,
                outer_diameter_mm: 2.3,
                default_cut_margin_pct: Some(15.0),
                conductors: vec![
                    WireDefConductor {
                        id: 1,
                        label: Some("+".into()),
                        gauge: Some("22 AWG".into()),
                        color: Some("red".into()),
                        is_shield: false,
                    },
                    WireDefConductor {
                        id: 2,
                        label: Some("drain".into()),
                        gauge: None,
                        color: None,
                        is_shield: true,
                    },
                ],
            }],
            splice_defs: vec![],
            component_defs: vec![],
            covering_defs: vec![CoveringDef {
                part_id: 4,
                supplied_diameter_mm: 10.0,
                shrunk_diameter_mm: 5.0,
                shrunk_wall_thickness_mm: 0.5,
                has_adhesive: true,
            }],
            accessory_defs: vec![AccessoryDef {
                part_id: 5,
                orientation: "straight".into(),
                cable_side_min_diameter_mm: 6.0,
                cable_side_max_diameter_mm: 12.0,
                leg_length_mm: 40.0,
                overlap_mm: 15.0,
                compatible_connectors: vec![AccessoryDefConnectorMatch {
                    series: "MS".into(),
                    shell_size: "20".into(),
                }],
            }],
            t_mold_defs: vec![TMoldDef {
                part_id: 6,
                overlap_mm: 20.0,
                legs: vec![
                    TMoldLeg { min_diameter_mm: 8.0, max_diameter_mm: 14.0, leg_length_mm: 40.0 },
                    TMoldLeg { min_diameter_mm: 4.0, max_diameter_mm: 8.0, leg_length_mm: 30.0 },
                    TMoldLeg { min_diameter_mm: 4.0, max_diameter_mm: 8.0, leg_length_mm: 30.0 },
                ],
            }],
            signal_types: vec![SignalType {
                id: 1,
                name: "5V".into(),
                default_color: "violeta".into(),
            }],
        };

        save(&mut conn, &library).unwrap();
        let loaded = load(&conn).unwrap();
        assert_eq!(loaded, library);
    }
}
