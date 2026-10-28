//! Modelo en memoria de un proyecto (= un arnés). Ver ../../../../CLAUDE.md sección 4.2
//! y ../../../schema/project.sql.
//!
//! Los `library_part_id` referencian filas de la biblioteca (archivo separado);
//! no se validan acá, es responsabilidad de la capa de chequeos (etapa 2).

mod dangling;
mod load;
mod save;
#[cfg(test)]
mod test_fixtures;

pub use dangling::{dangling_references, DanglingItem};
pub use load::load;
pub use save::save;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub harness_code: String,
    pub client: Option<String>,
    pub revision: Option<String>,
    pub main_connector_instance_id: Option<i64>,
    pub markup_pct: f64,
    pub default_cut_margin_pct: f64,
    pub default_twist_pitch_factor: f64,
    pub fill_factor: f64,
    pub labor_hours: f64,
    pub labor_rate_usd: f64,
    /// Materiales sobre lo comprado (packs completos) en vez de sobre lo usado (plan 5.4).
    pub cost_on_purchased: bool,
    /// Repuesto por categoría de parte (`Part::category`), en %; sin entrada = 0 (plan 5.4).
    pub spare_pcts: BTreeMap<String, f64>,
    /// Largos de corte redondeados hacia arriba a este múltiplo (mm); `None` = sin redondeo.
    #[serde(default)]
    pub cut_round_mm: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: i64,
    pub kind: String,
    pub termination: Option<String>,
    /// `TMoldDef` si `termination = "t_mold"`, `CoveringDef` si es "adhesive_heatshrink".
    pub termination_library_part_id: Option<i64>,
    /// Posición en el diagrama de armado (no escalado, plan 10.2). `None` hasta
    /// que se acomoda a mano o con el layout automático.
    pub diagram_x: Option<f64>,
    pub diagram_y: Option<f64>,
    /// Largo de la pieza de termo con adhesivo sobre el breakout. Va encima de
    /// los termos de los tramos que llegan: solo cuenta para el BOM y el costo.
    pub adhesive_heatshrink_length_mm: Option<f64>,
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

/// Una vía del conector en el proyecto. El contacto (vía con cable) y el tapón
/// (vía sin usar) no se cargan acá: salen del ConnectorDef de la biblioteca
/// (ver contacts.rs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CavityAssignment {
    pub id: i64,
    pub cavity_id: String,
    pub external_reference: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConnectorInstance {
    pub id: i64,
    pub short_id: String,
    pub name: String,
    pub library_part_id: i64,
    /// Si el conector es el de un dispositivo (ej. "PDM30 · A"): el
    /// DeviceDefConnector de la biblioteca, que da el nombre de cada pin (OUT11,
    /// AV3). `library_part_id` sigue siendo la carcasa (su ConnectorDef).
    pub device_connector_id: Option<i64>,
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
    /// Nombre para reconocerlo (ej. "Bobinas pin 2"), como el de las masas.
    #[serde(default)]
    pub name: String,
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
    /// Largo de corte puesto a mano (mm): manda sobre el calculado por el
    /// recorrido (destino sin recorrido dibujado, o corrección del taller).
    pub manual_length_mm: Option<f64>,
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
    pub nodes: Vec<Node>,
    pub segments: Vec<Segment>,
    pub connector_instances: Vec<ConnectorInstance>,
    pub ground_points: Vec<GroundPoint>,
    pub splice_instances: Vec<SpliceInstance>,
    pub component_instances: Vec<ComponentInstance>,
    pub wire_instances: Vec<WireInstance>,
    pub twist_groups: Vec<TwistGroup>,
}

impl ProjectData {
    /// Proyecto nuevo, vacío, con los valores por defecto del plan (margen 10%,
    /// paso de trenzado 8 × D_bundle, llenado 0,75, markup 0%).
    pub fn empty() -> Self {
        ProjectData {
            project: Project {
                name: "New harness".into(),
                harness_code: String::new(),
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
                spare_pcts: BTreeMap::new(),
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
}
