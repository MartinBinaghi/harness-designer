//! Modelo en memoria de la biblioteca de partes. Ver ../../../CLAUDE.md sección 4.1
//! y ../../schema/library.sql.
//!
//! Los campos con valores restringidos (gender, category, ...) se guardan como
//! `String`: SQLite ya valida los valores permitidos con CHECK, duplicarlo como
//! enum de Rust no agrega nada a esta escala.

use rusqlite::{params, Connection, OptionalExtension, Result, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

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
    pub counterpart_id: Option<i64>,
    /// Forma de la parte trasera: "round" (usa `back_diameter_mm`) o
    /// "rectangular" (usa `back_width_mm` × `back_height_mm`).
    pub back_shape: Option<String>,
    pub back_diameter_mm: Option<f64>,
    pub back_width_mm: Option<f64>,
    pub back_height_mm: Option<f64>,
    pub suggested_termination: Option<String>,
    /// Contacto (ContactDef) de las vías con cable y tapón (SealPlugDef) de las
    /// vías sin usar: uno por conector, como se trabaja en el taller. El
    /// proyecto no los carga vía por vía (ver contacts.rs).
    pub contact_part_id: Option<i64>,
    pub seal_plug_part_id: Option<i64>,
    /// Largo de la pieza de termo con adhesivo que va detrás de este conector
    /// (varía según el conector; plan 9.3).
    pub adhesive_heatshrink_length_mm: Option<f64>,
    pub cavities: Vec<ConnectorDefCavity>,
}

impl ConnectorDef {
    /// Diámetro mínimo que tiene que tener un termo para pasar por la parte
    /// trasera del conector (plan 9.3): el diámetro si es redonda, la diagonal
    /// si es rectangular. `None` si falta el dato.
    pub fn back_clearance_mm(&self) -> Option<f64> {
        match self.back_shape.as_deref() {
            Some("round") => self.back_diameter_mm,
            Some("rectangular") => Some(self.back_width_mm?.hypot(self.back_height_mm?)),
            _ => None,
        }
    }
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
/// Dispositivo con pinout conocido. Un nombre repetido en dos vías de un
/// conector (OUT1 en A1 y A10) es una misma salida en dos pines (en paralelo).
pub struct DeviceDef {
    pub part_id: i64,
    pub connectors: Vec<DeviceDefConnector>,
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

/// Tablas de las fichas, de hijas a madres (el orden en que se pueden vaciar).
const PART_TABLES: [&str; 17] = [
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
    "parts",
];

/// Reemplaza el contenido entero de la biblioteca (archivo nuevo, "Save as", o
/// después de un guardado que falló). Las fotos (`connector_def_images`) no se
/// tocan: se manejan aparte (ver `set_image`).
pub fn save(conn: &mut Connection, library: &Library) -> Result<()> {
    let tx = conn.transaction()?;
    // Los conectores se referencian entre sí (contraparte): al insertar el
    // macho, la hembra todavía no está. Las claves foráneas se validan al
    // hacer commit, cuando ya están todas las filas.
    tx.pragma_update(None, "defer_foreign_keys", true)?;
    for table in PART_TABLES.iter().chain(&["signal_types"]) {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    write_parts(&tx, library, None)?;
    write_signal_types(&tx, library)?;
    tx.commit()
}

/// Qué cambió entre dos estados de la biblioteca: las partes (con todas sus
/// fichas) y si cambiaron los tipos de señal.
#[derive(Debug, Default, PartialEq)]
pub struct LibraryChanges {
    pub parts: HashSet<i64>,
    pub signal_types: bool,
}

/// Una parte y todas sus fichas, para comparar dos estados parte por parte.
#[derive(Default, PartialEq)]
struct PartRecord<'a> {
    part: Option<&'a Part>,
    connector: Option<&'a ConnectorDef>,
    device: Option<&'a DeviceDef>,
    contact: Option<&'a ContactDef>,
    seal_plug: Option<&'a SealPlugDef>,
    wire: Option<&'a WireDef>,
    splice: Option<&'a SpliceDef>,
    component: Option<&'a ComponentDef>,
    covering: Option<&'a CoveringDef>,
    accessory: Option<&'a AccessoryDef>,
    t_mold: Option<&'a TMoldDef>,
}

fn part_records(library: &Library) -> HashMap<i64, PartRecord<'_>> {
    let mut records: HashMap<i64, PartRecord> = HashMap::new();
    for x in &library.parts {
        records.entry(x.id).or_default().part = Some(x);
    }
    macro_rules! defs {
        ($field:ident, $list:ident) => {
            for x in &library.$list {
                records.entry(x.part_id).or_default().$field = Some(x);
            }
        };
    }
    defs!(connector, connector_defs);
    defs!(device, device_defs);
    defs!(contact, contact_defs);
    defs!(seal_plug, seal_plug_defs);
    defs!(wire, wire_defs);
    defs!(splice, splice_defs);
    defs!(component, component_defs);
    defs!(covering, covering_defs);
    defs!(accessory, accessory_defs);
    defs!(t_mold, t_mold_defs);
    records
}

pub fn changes(before: &Library, after: &Library) -> LibraryChanges {
    let (a, b) = (part_records(before), part_records(after));
    LibraryChanges {
        parts: a
            .keys()
            .chain(b.keys())
            .filter(|id| a.get(id) != b.get(id))
            .copied()
            .collect(),
        signal_types: before.signal_types != after.signal_types,
    }
}

/// Guarda solo lo que cambió: cada parte cambiada se borra (sus fichas se van
/// en cascada) y se vuelve a escribir si sigue existiendo. El archivo tiene que
/// tener el estado anterior a `changes`; si un guardado falló, usar `save`.
pub fn save_changes(
    conn: &mut Connection,
    library: &Library,
    changes: &LibraryChanges,
) -> Result<()> {
    if changes.parts.is_empty() && !changes.signal_types {
        return Ok(());
    }
    let tx = conn.transaction()?;
    tx.pragma_update(None, "defer_foreign_keys", true)?;
    for id in &changes.parts {
        tx.execute("DELETE FROM parts WHERE id = ?1", [id])?;
    }
    write_parts(&tx, library, Some(&changes.parts))?;
    if changes.signal_types {
        tx.execute("DELETE FROM signal_types", [])?;
        write_signal_types(&tx, library)?;
    }
    tx.commit()
}

/// Escribe las partes de `library` (todas, o solo las de `only`) con sus fichas.
fn write_parts(tx: &Transaction, library: &Library, only: Option<&HashSet<i64>>) -> Result<()> {
    let keep = |id: i64| only.is_none_or(|ids| ids.contains(&id));
    for part in &library.parts {
        if !keep(part.id) {
            continue;
        }
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
        if !keep(connector_def.part_id) {
            continue;
        }
        tx.execute(
            "INSERT INTO connector_defs (part_id, gender, series, shell_size, counterpart_id, back_shape, back_diameter_mm, back_width_mm, back_height_mm, suggested_termination, contact_part_id, seal_plug_part_id, adhesive_heatshrink_length_mm)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                connector_def.part_id,
                connector_def.gender,
                connector_def.series,
                connector_def.shell_size,
                connector_def.counterpart_id,
                connector_def.back_shape,
                connector_def.back_diameter_mm,
                connector_def.back_width_mm,
                connector_def.back_height_mm,
                connector_def.suggested_termination,
                connector_def.contact_part_id,
                connector_def.seal_plug_part_id,
                connector_def.adhesive_heatshrink_length_mm,
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
        if !keep(device_def.part_id) {
            continue;
        }
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
    }

    for contact_def in &library.contact_defs {
        if !keep(contact_def.part_id) {
            continue;
        }
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
        if !keep(seal_plug_def.part_id) {
            continue;
        }
        tx.execute(
            "INSERT INTO seal_plug_defs (part_id, contact_size) VALUES (?1, ?2)",
            params![seal_plug_def.part_id, seal_plug_def.contact_size],
        )?;
    }

    for wire_def in &library.wire_defs {
        if !keep(wire_def.part_id) {
            continue;
        }
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
        if !keep(splice_def.part_id) {
            continue;
        }
        tx.execute(
            "INSERT INTO splice_defs (part_id, gauge_min, gauge_max, max_wires) VALUES (?1, ?2, ?3, ?4)",
            params![splice_def.part_id, splice_def.gauge_min, splice_def.gauge_max, splice_def.max_wires],
        )?;
    }

    for component_def in &library.component_defs {
        if !keep(component_def.part_id) {
            continue;
        }
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
        if !keep(covering_def.part_id) {
            continue;
        }
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
        if !keep(accessory_def.part_id) {
            continue;
        }
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
        if !keep(t_mold_def.part_id) {
            continue;
        }
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

    Ok(())
}

fn write_signal_types(tx: &Transaction, library: &Library) -> Result<()> {
    for signal_type in &library.signal_types {
        tx.execute(
            "INSERT INTO signal_types (id, name, default_color) VALUES (?1, ?2, ?3)",
            params![signal_type.id, signal_type.name, signal_type.default_color],
        )?;
    }

    Ok(())
}

/// Vistas de las fotos de los conectores, en el orden en que se muestran.
pub const IMAGE_VIEWS: [&str; 3] = ["front", "side", "back"];

/// Qué fotos hay: parte -> vistas (ordenadas). Liviano: sin los datos.
pub fn image_index(conn: &Connection) -> Result<BTreeMap<i64, Vec<String>>> {
    let mut stmt =
        conn.prepare("SELECT part_id, view FROM connector_def_images ORDER BY part_id, view")?;
    let mut index: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    for row in stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })? {
        let (part_id, view) = row?;
        index.entry(part_id).or_default().push(view);
    }
    Ok(index)
}

/// Una foto (data URL), si la hay.
pub fn image(conn: &Connection, part_id: i64, view: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT data FROM connector_def_images WHERE part_id = ?1 AND view = ?2",
        params![part_id, view],
        |row| row.get(0),
    )
    .optional()
}

/// Pone (o con `None`, saca) una foto. Quien llama valida la vista y el dato.
pub fn set_image(conn: &Connection, part_id: i64, view: &str, data: Option<&str>) -> Result<()> {
    match data {
        Some(data) => conn.execute(
            "INSERT INTO connector_def_images (part_id, view, data) VALUES (?1, ?2, ?3)
             ON CONFLICT (part_id, view) DO UPDATE SET data = excluded.data",
            params![part_id, view, data],
        )?,
        None => conn.execute(
            "DELETE FROM connector_def_images WHERE part_id = ?1 AND view = ?2",
            params![part_id, view],
        )?,
    };
    Ok(())
}

/// Fotos de conectores que ya no existen (se borraron en una sesión anterior;
/// durante la sesión se conservan, por si se deshace el borrado).
pub fn remove_orphan_images(conn: &Connection) -> Result<usize> {
    conn.execute(
        "DELETE FROM connector_def_images WHERE part_id NOT IN (SELECT part_id FROM connector_defs)",
        [],
    )
}

/// Copia todas las fotos de una biblioteca a otra ("Save as").
pub fn copy_images(from: &Connection, to: &mut Connection) -> Result<()> {
    let mut stmt = from.prepare("SELECT part_id, view, data FROM connector_def_images")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>>>()?;
    let tx = to.transaction()?;
    tx.execute("DELETE FROM connector_def_images", [])?;
    for (part_id, view, data) in rows {
        tx.execute(
            "INSERT INTO connector_def_images (part_id, view, data) VALUES (?1, ?2, ?3)",
            params![part_id, view, data],
        )?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn back_clearance_is_the_diameter_or_the_diagonal() {
        let mut cd = ConnectorDef {
            part_id: 1,
            gender: "female".into(),
            series: Some("DTM".into()),
            shell_size: None,
            counterpart_id: None,
            back_shape: Some("rectangular".into()),
            back_diameter_mm: None,
            back_width_mm: Some(12.0),
            back_height_mm: Some(9.5),
            suggested_termination: None,
            contact_part_id: None,
            seal_plug_part_id: None,
            adhesive_heatshrink_length_mm: None,
            cavities: vec![],
        };
        // Rectangular 12 × 9.5 mm -> diagonal ≈ 15.31 mm.
        assert!((cd.back_clearance_mm().unwrap() - 15.305).abs() < 0.01);
        cd.back_height_mm = None;
        assert_eq!(cd.back_clearance_mm(), None);
        cd.back_shape = Some("round".into());
        cd.back_diameter_mm = Some(18.0);
        assert_eq!(cd.back_clearance_mm(), Some(18.0));
        cd.back_shape = None;
        assert_eq!(cd.back_clearance_mm(), None);
    }
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
                counterpart_id: None,
                back_shape: Some("rectangular".into()),
                back_diameter_mm: None,
                back_width_mm: Some(12.0),
                back_height_mm: Some(9.5),
                suggested_termination: Some("boot".into()),
                contact_part_id: None,
                seal_plug_part_id: None,
                adhesive_heatshrink_length_mm: None,
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
                    TMoldLeg {
                        min_diameter_mm: 8.0,
                        max_diameter_mm: 14.0,
                        leg_length_mm: 40.0,
                    },
                    TMoldLeg {
                        min_diameter_mm: 4.0,
                        max_diameter_mm: 8.0,
                        leg_length_mm: 30.0,
                    },
                    TMoldLeg {
                        min_diameter_mm: 4.0,
                        max_diameter_mm: 8.0,
                        leg_length_mm: 30.0,
                    },
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

    #[test]
    fn saving_only_the_changes_gives_the_same_file_as_saving_everything() {
        let path = std::env::temp_dir().join(format!(
            "harness-test-{}-incremental.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let path = path.to_string_lossy().into_owned();
        let before = crate::base_library::base_library();
        let mut conn = crate::db::library_for_saving(&path).unwrap();
        save(&mut conn, &before).unwrap();

        // Una vía renombrada, una parte borrada, una nueva y otro tipo de señal.
        let mut after = before.clone();
        after.connector_defs[0].cavities[0].cavity_id = "X".into();
        let gone = after.covering_defs.pop().unwrap().part_id;
        after.parts.retain(|p| p.id != gone);
        let new_id = after.parts.iter().map(|p| p.id).max().unwrap() + 1;
        after.parts.push(Part {
            id: new_id,
            part_number: "NEW-1".into(),
            manufacturer: None,
            description: None,
            category: "splice".into(),
            purchase_unit: "unit".into(),
            qty_per_pack: 1.0,
            price_usd: None,
            price_date: None,
        });
        after.splice_defs.push(SpliceDef {
            part_id: new_id,
            gauge_min: None,
            gauge_max: Some("6 mm²".into()),
            max_wires: 8,
        });
        after.signal_types.push(SignalType {
            id: 99,
            name: "CAN".into(),
            default_color: "white".into(),
        });

        let changes = changes(&before, &after);
        assert_eq!(
            changes.parts,
            HashSet::from([before.connector_defs[0].part_id, gone, new_id])
        );
        assert!(changes.signal_types);
        save_changes(&mut conn, &after, &changes).unwrap();
        assert_eq!(load(&conn).unwrap(), after);
        assert_eq!(super::changes(&after, &after), LibraryChanges::default());
        drop(conn);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn photos_live_apart_and_survive_saving_the_part() {
        let path =
            std::env::temp_dir().join(format!("harness-test-{}-photos.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let path = path.to_string_lossy().into_owned();
        let library = crate::base_library::base_library();
        let id = library.connector_defs[0].part_id;
        let mut conn = crate::db::library_for_saving(&path).unwrap();
        save(&mut conn, &library).unwrap();
        set_image(&conn, id, "front", Some("data:image/webp;base64,AAA")).unwrap();

        // Guardar la parte (se borra y se vuelve a escribir) no se lleva la foto.
        let mut edited = library.clone();
        edited.connector_defs[0].shell_size = Some("9".into());
        save_changes(&mut conn, &edited, &changes(&library, &edited)).unwrap();
        assert_eq!(
            image(&conn, id, "front").unwrap().as_deref(),
            Some("data:image/webp;base64,AAA")
        );

        // Sin el conector, la foto queda huérfana y se limpia (al abrir la biblioteca).
        let mut without = edited.clone();
        without.connector_defs.retain(|d| d.part_id != id);
        without.parts.retain(|p| p.id != id);
        for d in &mut without.connector_defs {
            if d.counterpart_id == Some(id) {
                d.counterpart_id = None;
            }
        }
        save_changes(&mut conn, &without, &changes(&edited, &without)).unwrap();
        assert_eq!(remove_orphan_images(&conn).unwrap(), 1);
        assert!(image_index(&conn).unwrap().is_empty());
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
}
