//! Modelo en memoria de la biblioteca de partes. Ver ../../../../CLAUDE.md sección 4.1
//! y ../../../schema/library.sql.
//!
//! Los campos con valores restringidos (gender, category, ...) se guardan como
//! `String`: SQLite ya valida los valores permitidos con CHECK, duplicarlo como
//! enum de Rust no agrega nada a esta escala.

mod images;
mod load;
mod save;

pub use images::{copy_images, image, image_index, remove_orphan_images, set_image, IMAGE_VIEWS};
pub use load::load;
pub use save::{changes, save, save_changes};

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
}
