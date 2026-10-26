//! Largo de corte, diámetro de bundle, BOM y costos. Ver ../../CLAUDE.md
//! secciones 5 y 8.
//!
//! Sin módulo concéntrico (etapa 7, opcional) no sabemos en qué capa va cada
//! cable, así que el diámetro de hélice `D` del factor de trenzado (5.1) se
//! aproxima al `D_bundle` del segmento entero: es el "peor caso" que el plan
//! ya pide usar mientras no haya construcción concéntrica cargada.

use crate::model::library::{Library, TMoldDef, TMoldLeg, WireDef};
use crate::model::project::{ConnectorInstance, Project, ProjectData, WireInstance};
use crate::topology::wire_route;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;

/// Lo que se repite muchas veces en una pasada (diámetro de cada tramo y
/// cuántos cables pasan por él), recordado mientras dura (ver `with_cache`).
#[derive(Default)]
struct PassCache {
    bundle: HashMap<i64, f64>,
    wires_in_segment: Option<HashMap<i64, usize>>,
}

thread_local! {
    static PASS: RefCell<Option<PassCache>> = const { RefCell::new(None) };
}

/// Corre una pasada de cálculo (costos, chequeos) recordando recorridos,
/// diámetros y cables por tramo: el proyecto y la biblioteca no cambian
/// mientras corre. Sin esto, cada largo rehacía todo para cada tramo.
pub fn with_cache<T>(f: impl FnOnce() -> T) -> T {
    PASS.with(|c| *c.borrow_mut() = Some(PassCache::default()));
    let out = crate::topology::with_route_cache(f);
    PASS.with(|c| *c.borrow_mut() = None);
    out
}

/// Cuántos cables pasan por cada tramo.
fn wires_in_segment(data: &ProjectData, segment_id: i64) -> usize {
    let count = |data: &ProjectData| {
        let mut counts: HashMap<i64, usize> = HashMap::new();
        for w in &data.wire_instances {
            for s in wire_route(data, w.id).unwrap_or_default() {
                *counts.entry(s).or_default() += 1;
            }
        }
        counts
    };
    let cached = PASS.with(|c| {
        let mut c = c.borrow_mut();
        let pass = c.as_mut()?;
        if pass.wires_in_segment.is_none() {
            pass.wires_in_segment = Some(count(data));
        }
        pass.wires_in_segment
            .as_ref()
            .map(|m| m.get(&segment_id).copied().unwrap_or(0))
    });
    cached.unwrap_or_else(|| count(data).get(&segment_id).copied().unwrap_or(0))
}

fn wire_def_of<'a>(library: &'a Library, wire: &WireInstance) -> Option<&'a WireDef> {
    library
        .wire_defs
        .iter()
        .find(|w| w.part_id == wire.library_part_id)
}

fn twist_group_of_wire(data: &ProjectData) -> HashMap<i64, i64> {
    let mut map = HashMap::new();
    for group in &data.twist_groups {
        for &wire_id in &group.wire_instance_ids {
            map.insert(wire_id, group.id);
        }
    }
    map
}

/// Diámetro de cada elemento del bundle en un segmento: cables sueltos por su
/// propio `WireDef`, y cada grupo de trenzado colapsado a un solo elemento
/// (mismo cálculo `sqrt(Σd²/f)` aplicado a sus miembros presentes en el tramo).
fn segment_element_diameters(data: &ProjectData, library: &Library, segment_id: i64) -> Vec<f64> {
    let group_of = twist_group_of_wire(data);
    let mut loose = Vec::new();
    let mut group_members: HashMap<i64, Vec<f64>> = HashMap::new();

    for wire in &data.wire_instances {
        let Some(route) = wire_route(data, wire.id) else {
            continue;
        };
        if !route.contains(&segment_id) {
            continue;
        }
        let Some(def) = wire_def_of(library, wire) else {
            continue;
        };
        match group_of.get(&wire.id) {
            Some(&group_id) => group_members
                .entry(group_id)
                .or_default()
                .push(def.outer_diameter_mm),
            None => loose.push(def.outer_diameter_mm),
        }
    }

    let mut elements = loose;
    for diameters in group_members.into_values() {
        elements.push(bundle_diameter(&diameters, data.project.fill_factor));
    }
    elements
}

fn bundle_diameter(element_diameters_mm: &[f64], fill_factor: f64) -> f64 {
    let sum_sq: f64 = element_diameters_mm.iter().map(|d| d * d).sum();
    (sum_sq / fill_factor).sqrt()
}

/// `D_bundle = √(Σdᵢ²/f)` del segmento (plan 5.2). `0.0` si no pasa ningún cable.
pub fn bundle_diameter_mm(data: &ProjectData, library: &Library, segment_id: i64) -> f64 {
    if let Some(hit) = PASS.with(|c| {
        c.borrow()
            .as_ref()
            .and_then(|p| p.bundle.get(&segment_id).copied())
    }) {
        return hit;
    }
    let d = compute_bundle_diameter_mm(data, library, segment_id);
    PASS.with(|c| {
        if let Some(p) = c.borrow_mut().as_mut() {
            p.bundle.insert(segment_id, d);
        }
    });
    d
}

fn compute_bundle_diameter_mm(data: &ProjectData, library: &Library, segment_id: i64) -> f64 {
    let elements = segment_element_diameters(data, library, segment_id);
    if elements.is_empty() {
        return 0.0;
    }
    bundle_diameter(&elements, data.project.fill_factor)
}

/// Margen del suministrado del termo sobre `D_bundle` (plan 9.2): el plan no fija
/// un número (sección 14, pendiente calibrar con el uso) — arranca en 10%, igual
/// al margen de corte por defecto del proyecto.
const DEFAULT_COVERING_SUPPLIED_MARGIN_PCT: f64 = 10.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoveringFit {
    pub library_part_id: i64,
    pub supplied_diameter_mm: f64,
    pub shrunk_diameter_mm: f64,
    pub fits: bool,
}

/// Termos de la biblioteca contra un diámetro dado (plan 9.2): el contraído
/// tiene que apretar (`shrunk ≤ max_shrunk_mm`) y el suministrado tiene que
/// entrar (`supplied ≥ min_supplied_mm`). Ordenados de más chico a más grande
/// de suministrado — el primero que cumple es el sugerido. Los con adhesivo
/// son la pieza corta de una punta (plan 9.3): no se sugieren para un tramo,
/// salvo que sea el que ya tiene asignado (`assigned`), para chequearlo igual.
fn coverings_fitting(
    library: &Library,
    max_shrunk_mm: f64,
    min_supplied_mm: f64,
    assigned: Option<i64>,
) -> Vec<CoveringFit> {
    let mut fits: Vec<CoveringFit> = library
        .covering_defs
        .iter()
        .filter(|c| !c.has_adhesive || Some(c.part_id) == assigned)
        .map(|c| CoveringFit {
            library_part_id: c.part_id,
            supplied_diameter_mm: c.supplied_diameter_mm,
            shrunk_diameter_mm: c.shrunk_diameter_mm,
            fits: c.shrunk_diameter_mm <= max_shrunk_mm
                && c.supplied_diameter_mm >= min_supplied_mm,
        })
        .collect();
    fits.sort_by(|a, b| a.supplied_diameter_mm.total_cmp(&b.supplied_diameter_mm));
    fits
}

/// Termos que sirven para el bundle de un segmento (plan 9.2).
pub fn coverings_for_segment(
    data: &ProjectData,
    library: &Library,
    segment_id: i64,
) -> Vec<CoveringFit> {
    let d_bundle = bundle_diameter_mm(data, library, segment_id);
    let assigned = data
        .segments
        .iter()
        .find(|s| s.id == segment_id)
        .and_then(|s| s.covering_library_part_id);
    coverings_fitting(
        library,
        d_bundle,
        d_bundle * (1.0 + DEFAULT_COVERING_SUPPLIED_MARGIN_PCT / 100.0),
        assigned,
    )
}

/// Diámetro final del segmento con su cobertura aplicada (plan 5.2): el termo
/// rodea el bundle, así que suma dos veces el espesor de pared contraído.
pub fn segment_final_diameter_mm(data: &ProjectData, library: &Library, segment_id: i64) -> f64 {
    let d_bundle = bundle_diameter_mm(data, library, segment_id);
    let wall = data
        .segments
        .iter()
        .find(|s| s.id == segment_id)
        .and_then(|s| s.covering_library_part_id)
        .and_then(|id| library.covering_defs.iter().find(|c| c.part_id == id))
        .map(|c| c.shrunk_wall_thickness_mm)
        .unwrap_or(0.0);
    d_bundle + 2.0 * wall
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BootFit {
    pub library_part_id: i64,
    pub connector_compatible: bool,
    pub cable_side_ok: bool,
    pub fits: bool,
}

/// Diámetro de bundle a la salida de un conector: el del segmento conectado a
/// su nodo (un `connector_end` tiene un solo segmento). `0.0` si no hay ninguno.
fn connector_outlet_diameter_mm(
    data: &ProjectData,
    library: &Library,
    connector: &ConnectorInstance,
) -> f64 {
    data.segments
        .iter()
        .find(|s| s.node_a_id == connector.node_id || s.node_b_id == connector.node_id)
        .map(|s| bundle_diameter_mm(data, library, s.id))
        .unwrap_or(0.0)
}

/// Boots de la biblioteca contra un conector (plan 9.3): compatibles con su
/// serie/carcasa, y el diámetro de bundle a la salida dentro del rango del
/// lado cable.
pub fn boots_for_connector(
    data: &ProjectData,
    library: &Library,
    connector_instance_id: i64,
) -> Vec<BootFit> {
    let Some(connector) = data
        .connector_instances
        .iter()
        .find(|c| c.id == connector_instance_id)
    else {
        return Vec::new();
    };
    let connector_def = library
        .connector_defs
        .iter()
        .find(|d| d.part_id == connector.library_part_id);
    let outlet_diameter = connector_outlet_diameter_mm(data, library, connector);

    library
        .accessory_defs
        .iter()
        .map(|accessory| {
            let connector_compatible = connector_def.is_some_and(|def| {
                accessory.compatible_connectors.iter().any(|m| {
                    def.series.as_deref() == Some(m.series.as_str())
                        && def.shell_size.as_deref() == Some(m.shell_size.as_str())
                })
            });
            let cable_side_ok = outlet_diameter >= accessory.cable_side_min_diameter_mm
                && outlet_diameter <= accessory.cable_side_max_diameter_mm;
            BootFit {
                library_part_id: accessory.part_id,
                connector_compatible,
                cable_side_ok,
                fits: connector_compatible && cable_side_ok,
            }
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TMoldLegFit {
    pub segment_id: i64,
    pub diameter_mm: f64,
    pub fits: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TMoldFit {
    pub library_part_id: i64,
    pub leg_fits: Vec<TMoldLegFit>,
    /// `false` también si la cantidad de segmentos conectados no es 3 (una pata por segmento).
    pub fits: bool,
}

/// Segmentos de un nodo del más grueso al más fino, y patas de un molde en T de
/// mayor a menor rango: el catálogo no distingue una pata "de entrada", así que
/// se emparejan en ese orden (plan 9.4).
fn node_segments_by_diameter(
    data: &ProjectData,
    library: &Library,
    node_id: i64,
) -> Vec<(i64, f64)> {
    let mut segment_diameters: Vec<(i64, f64)> = data
        .segments
        .iter()
        .filter(|s| s.node_a_id == node_id || s.node_b_id == node_id)
        .map(|s| (s.id, segment_final_diameter_mm(data, library, s.id)))
        .collect();
    segment_diameters.sort_by(|a, b| b.1.total_cmp(&a.1));
    segment_diameters
}

fn legs_by_size(t_mold: &TMoldDef) -> Vec<TMoldLeg> {
    let mut legs = t_mold.legs.clone();
    legs.sort_by(|a, b| b.max_diameter_mm.total_cmp(&a.max_diameter_mm));
    legs
}

/// Calce de los moldes en T de la biblioteca contra los segmentos conectados a
/// un breakout (plan 9.4), emparejados por tamaño (`node_segments_by_diameter`).
pub fn t_mold_fits_for_node(data: &ProjectData, library: &Library, node_id: i64) -> Vec<TMoldFit> {
    let segment_diameters = node_segments_by_diameter(data, library, node_id);

    library
        .t_mold_defs
        .iter()
        .map(|t_mold| {
            let legs = legs_by_size(t_mold);

            let leg_fits: Vec<TMoldLegFit> = segment_diameters
                .iter()
                .zip(legs.iter())
                .map(|(&(segment_id, diameter_mm), leg)| TMoldLegFit {
                    segment_id,
                    diameter_mm,
                    fits: diameter_mm >= leg.min_diameter_mm && diameter_mm <= leg.max_diameter_mm,
                })
                .collect();

            let fits = segment_diameters.len() == legs.len() && leg_fits.iter().all(|f| f.fits);
            TMoldFit {
                library_part_id: t_mold.part_id,
                leg_fits,
                fits,
            }
        })
        .collect()
}

fn twist_factor(bundle_diameter_mm: f64, pitch_mm: f64) -> f64 {
    if pitch_mm <= 0.0 {
        return 1.0;
    }
    (1.0 + (std::f64::consts::PI * bundle_diameter_mm / pitch_mm).powi(2)).sqrt()
}

fn effective_pitch_mm(
    project: &Project,
    segment_twist_pitch_mm: Option<f64>,
    bundle_diameter_mm: f64,
) -> f64 {
    segment_twist_pitch_mm.unwrap_or(project.default_twist_pitch_factor * bundle_diameter_mm)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WireCutLength {
    pub wire_id: i64,
    pub length_with_twist_mm: f64,
    pub margin_pct: f64,
    /// Mínimo margen que impone el trenzado del tramo más exigente de este cable.
    pub twist_min_margin_pct: f64,
    pub cut_length_mm: f64,
    /// El largo de corte se puso a mano (`WireInstance::manual_length_mm`).
    pub manual: bool,
}

/// Largo del recorrido con el factor de trenzado de cada segmento, y el peor
/// factor del recorrido. `None` si el cable no tiene recorrido resoluble.
fn route_length_with_twist(
    data: &ProjectData,
    library: &Library,
    wire_id: i64,
) -> Option<(f64, f64)> {
    let mut length_with_twist_mm = 0.0;
    let mut worst_factor: f64 = 1.0;
    for segment_id in &wire_route(data, wire_id)? {
        let segment = data.segments.iter().find(|s| s.id == *segment_id)?;
        let d_bundle = bundle_diameter_mm(data, library, *segment_id);
        let pitch = effective_pitch_mm(&data.project, segment.twist_pitch_mm, d_bundle);
        // Un cable solo en el tramo no se trenza con nada: va derecho. (Un par
        // trenzado solo sí: sus cables siguen la hélice.)
        let alone = wires_in_segment(data, *segment_id) <= 1;
        let factor = if alone {
            1.0
        } else {
            twist_factor(d_bundle, pitch)
        };
        length_with_twist_mm += segment.length_mm * factor;
        worst_factor = worst_factor.max(factor);
    }
    Some((length_with_twist_mm, worst_factor))
}

/// Largo de corte de un cable (plan 5.1): recorre sus segmentos aplicando el
/// factor de trenzado de cada uno, y le suma el margen de seguridad (cascada
/// manual → `WireDef` → proyecto). Un largo puesto a mano manda (sin margen,
/// aunque no haya recorrido). `None` si no hay largo a mano ni recorrido
/// resoluble (extremo sin ubicación, plan 4.3).
pub fn wire_cut_length(
    data: &ProjectData,
    library: &Library,
    wire_id: i64,
) -> Option<WireCutLength> {
    let wire = data.wire_instances.iter().find(|w| w.id == wire_id)?;
    let route = route_length_with_twist(data, library, wire_id);
    if let Some(manual) = wire.manual_length_mm {
        return Some(WireCutLength {
            wire_id,
            length_with_twist_mm: route.map_or(manual, |(length, _)| length),
            margin_pct: 0.0,
            twist_min_margin_pct: 0.0,
            cut_length_mm: manual,
            manual: true,
        });
    }
    let (length_with_twist_mm, worst_factor) = route?;

    let margin_pct = wire
        .manual_cut_margin_pct
        .or_else(|| wire_def_of(library, wire).and_then(|d| d.default_cut_margin_pct))
        .unwrap_or(data.project.default_cut_margin_pct);

    Some(WireCutLength {
        wire_id,
        length_with_twist_mm,
        margin_pct,
        twist_min_margin_pct: (worst_factor - 1.0) * 100.0,
        cut_length_mm: round_up(
            length_with_twist_mm * (1.0 + margin_pct / 100.0),
            data.project.cut_round_mm,
        ),
        manual: false,
    })
}

/// Redondeo del largo de corte (opción del proyecto): siempre hacia arriba, para
/// que ningún cable salga más corto. El largo puesto a mano no se redondea.
fn round_up(mm: f64, step: Option<f64>) -> f64 {
    match step {
        Some(s) if s > 0.0 => (mm / s - 1e-9).ceil() * s,
        _ => mm,
    }
}

/// Lista de corte completa: un renglón por cable con recorrido resoluble.
pub fn cut_list(data: &ProjectData, library: &Library) -> Vec<WireCutLength> {
    data.wire_instances
        .iter()
        .filter_map(|w| wire_cut_length(data, library, w.id))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BomRow {
    pub library_part_id: i64,
    pub category: String,
    pub part_number: String,
    /// Cantidad usada: unidades, o metros para partes de tipo "wire".
    pub quantity_needed: f64,
    /// Repuesto (% de la categoría, en unidades enteras si la parte va por unidad).
    pub spare: f64,
    pub unit: String,
    /// Usado + repuesto, redondeado hacia arriba al múltiplo de `qty_per_pack`.
    pub quantity_to_buy: f64,
    pub unit_price_usd: Option<f64>,
    /// Sobre lo usado (`(necesario + repuesto) × precio`) o, si el proyecto lo
    /// pide, sobre lo comprado (`a comprar × precio`).
    pub subtotal_usd: Option<f64>,
    pub price_date: Option<String>,
}

fn round_up_to_pack(quantity_needed: f64, qty_per_pack: f64) -> f64 {
    if qty_per_pack <= 0.0 {
        return quantity_needed;
    }
    (quantity_needed / qty_per_pack).ceil() * qty_per_pack
}

fn bom_row(
    project: &Project,
    library: &Library,
    part_id: i64,
    quantity_needed: f64,
) -> Option<BomRow> {
    let part = library.parts.iter().find(|p| p.id == part_id)?;
    let spare_pct = project
        .spare_pcts
        .get(&part.category)
        .copied()
        .unwrap_or(0.0);
    let spare = quantity_needed * spare_pct / 100.0;
    let spare = if part.purchase_unit == "meter" {
        spare
    } else {
        spare.ceil()
    };
    let quantity_to_buy = round_up_to_pack(quantity_needed + spare, part.qty_per_pack);
    let billed = if project.cost_on_purchased {
        quantity_to_buy
    } else {
        quantity_needed + spare
    };
    Some(BomRow {
        library_part_id: part_id,
        category: part.category.clone(),
        part_number: part.part_number.clone(),
        quantity_needed,
        spare,
        unit: part.purchase_unit.clone(),
        quantity_to_buy,
        unit_price_usd: part.price_usd,
        subtotal_usd: part.price_usd.map(|price| price * billed),
        price_date: part.price_date.clone(),
    })
}

/// BOM agrupado por parte de biblioteca (plan 8.2), con el repuesto por
/// categoría del proyecto (plan 5.4).
pub fn bill_of_materials(data: &ProjectData, library: &Library) -> Vec<BomRow> {
    let mut quantities: HashMap<i64, f64> = HashMap::new();

    for connector in &data.connector_instances {
        *quantities.entry(connector.library_part_id).or_default() += 1.0;
        if let Some(id) = connector.backshell_library_part_id {
            *quantities.entry(id).or_default() += 1.0;
        }
        // Contacto en cada vía con cable, tapón en cada vía sin usar (del ConnectorDef).
        for cavity in &connector.cavities {
            let part = crate::contacts::cavity_contact(data, library, connector, cavity)
                .or_else(|| crate::contacts::cavity_seal_plug(data, library, connector, cavity));
            if let Some(id) = part {
                *quantities.entry(id).or_default() += 1.0;
            }
        }
    }
    for ground in &data.ground_points {
        if let Some(id) = ground.terminal_library_part_id {
            *quantities.entry(id).or_default() += 1.0;
        }
    }
    for splice in &data.splice_instances {
        *quantities.entry(splice.library_part_id).or_default() += 1.0;
    }
    // Boots y moldes en T elegidos, y la pieza de termo con adhesivo de cada
    // conector (largo de su ConnectorDef) y de cada breakout (largo del nodo).
    for connector in &data.connector_instances {
        let Some(id) = connector.termination_library_part_id else {
            continue;
        };
        match connector.termination.as_deref() {
            Some("boot_straight") | Some("boot_90") => *quantities.entry(id).or_default() += 1.0,
            Some("adhesive_heatshrink") => {
                let length = library
                    .connector_defs
                    .iter()
                    .find(|d| d.part_id == connector.library_part_id)
                    .and_then(|d| d.adhesive_heatshrink_length_mm);
                if let Some(mm) = length {
                    *quantities.entry(id).or_default() += mm / 1000.0;
                }
            }
            _ => {}
        }
    }
    for node in &data.nodes {
        let Some(id) = node.termination_library_part_id else {
            continue;
        };
        match node.termination.as_deref() {
            Some("t_mold") => *quantities.entry(id).or_default() += 1.0,
            Some("adhesive_heatshrink") => {
                if let Some(mm) = node.adhesive_heatshrink_length_mm {
                    *quantities.entry(id).or_default() += mm / 1000.0;
                }
            }
            _ => {}
        }
    }
    for cut in covering_cut_list(data, library) {
        if let Some(id) = cut.library_part_id {
            *quantities.entry(id).or_default() += cut.cut_length_mm / 1000.0;
        }
    }
    for component in &data.component_instances {
        *quantities.entry(component.library_part_id).or_default() += 1.0;
    }
    for cut in cut_list(data, library) {
        let Some(wire) = data.wire_instances.iter().find(|w| w.id == cut.wire_id) else {
            continue;
        };
        *quantities.entry(wire.library_part_id).or_default() += cut.cut_length_mm / 1000.0;
    }

    let mut rows: Vec<BomRow> = quantities
        .into_iter()
        .filter_map(|(part_id, qty)| bom_row(&data.project, library, part_id, qty))
        .collect();
    rows.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then(a.part_number.cmp(&b.part_number))
    });
    rows
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostSummary {
    pub materials_usd: f64,
    pub labor_usd: f64,
    pub markup_usd: f64,
    pub total_usd: f64,
}

/// Costos totales (plan 8.3): materiales sobre lo usado + mano de obra +
/// markup opcional (0% por defecto), todo en USD.
pub fn cost_summary(project: &Project, bom: &[BomRow]) -> CostSummary {
    let materials_usd: f64 = bom.iter().filter_map(|r| r.subtotal_usd).sum();
    let labor_usd = project.labor_hours * project.labor_rate_usd;
    let markup_usd = (materials_usd + labor_usd) * project.markup_pct / 100.0;
    CostSummary {
        materials_usd,
        labor_usd,
        markup_usd,
        total_usd: materials_usd + labor_usd + markup_usd,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SegmentDiameterInfo {
    pub segment_id: i64,
    pub bundle_diameter_mm: f64,
    pub final_diameter_mm: f64,
    pub covering_options: Vec<CoveringFit>,
}

/// Diámetros y termo sugerido por segmento (plan 9.5), para los segmentos que
/// tienen al menos un cable.
pub fn segment_diameters(data: &ProjectData, library: &Library) -> Vec<SegmentDiameterInfo> {
    data.segments
        .iter()
        .filter(|s| bundle_diameter_mm(data, library, s.id) > 0.0)
        .map(|s| SegmentDiameterInfo {
            segment_id: s.id,
            bundle_diameter_mm: bundle_diameter_mm(data, library, s.id),
            final_diameter_mm: segment_final_diameter_mm(data, library, s.id),
            covering_options: coverings_for_segment(data, library, s.id),
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConnectorTerminationInfo {
    pub connector_instance_id: i64,
    pub boot_options: Vec<BootFit>,
}

/// Boots sugeridos por conector (plan 9.5), para los conectores con terminación boot.
pub fn connector_terminations(
    data: &ProjectData,
    library: &Library,
) -> Vec<ConnectorTerminationInfo> {
    data.connector_instances
        .iter()
        .filter(|c| {
            matches!(
                c.termination.as_deref(),
                Some("boot_straight") | Some("boot_90")
            )
        })
        .map(|c| ConnectorTerminationInfo {
            connector_instance_id: c.id,
            boot_options: boots_for_connector(data, library, c.id),
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpliceOutputGaugeFit {
    pub wire_def_part_id: i64,
    pub gauge: String,
    pub fits: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpliceOutputGaugeInfo {
    pub splice_instance_id: i64,
    pub combined_mm2: f64,
    pub options: Vec<SpliceOutputGaugeFit>,
}

/// De los calibres de cable que hay en la biblioteca, el más fino que cubre
/// la sección combinada — regla confirmada con Martin (2026-10-01): sumar la
/// sección de los cables que entran al splice y redondear hacia el próximo
/// calibre disponible que la cubra.
fn splice_output_gauge_options(combined_mm2: f64, library: &Library) -> Vec<SpliceOutputGaugeFit> {
    let mut seen = std::collections::HashSet::new();
    let mut options: Vec<(f64, SpliceOutputGaugeFit)> = library
        .wire_defs
        .iter()
        .filter(|wd| seen.insert(wd.gauge.clone()))
        .filter_map(|wd| {
            let area = crate::gauge::gauge_to_mm2(&wd.gauge)?;
            Some((
                area,
                SpliceOutputGaugeFit {
                    wire_def_part_id: wd.part_id,
                    gauge: wd.gauge.clone(),
                    fits: area >= combined_mm2,
                },
            ))
        })
        .collect();
    options.sort_by(|a, b| a.0.total_cmp(&b.0));
    options.into_iter().map(|(_, fit)| fit).collect()
}

/// Calibre mínimo de salida sugerido por splice (plan sección 12), según la
/// cantidad y calibre de los cables que le entran.
pub fn splice_output_gauges(data: &ProjectData, library: &Library) -> Vec<SpliceOutputGaugeInfo> {
    data.splice_instances
        .iter()
        .filter_map(|splice| {
            let wires: Vec<&WireInstance> = data
                .wire_instances
                .iter()
                .filter(|w| {
                    w.end_a.splice_id == Some(splice.id) || w.end_b.splice_id == Some(splice.id)
                })
                .collect();
            if wires.is_empty() {
                return None;
            }
            let combined_mm2 = wires
                .iter()
                .map(|w| {
                    wire_def_of(library, w).and_then(|wd| crate::gauge::gauge_to_mm2(&wd.gauge))
                })
                .sum::<Option<f64>>()?;
            Some(SpliceOutputGaugeInfo {
                splice_instance_id: splice.id,
                combined_mm2,
                options: splice_output_gauge_options(combined_mm2, library),
            })
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BreakoutTerminationInfo {
    pub node_id: i64,
    pub t_mold_options: Vec<TMoldFit>,
}

/// Moldes en T sugeridos por breakout (plan 9.5), para los nodos con terminación t_mold.
pub fn breakout_terminations(
    data: &ProjectData,
    library: &Library,
) -> Vec<BreakoutTerminationInfo> {
    data.nodes
        .iter()
        .filter(|n| n.termination.as_deref() == Some("t_mold"))
        .map(|n| BreakoutTerminationInfo {
            node_id: n.id,
            t_mold_options: t_mold_fits_for_node(data, library, n.id),
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoveringCut {
    pub segment_id: i64,
    /// El termo asignado al segmento, o si no tiene, el sugerido. `None` si
    /// ninguno de la biblioteca sirve.
    pub library_part_id: Option<i64>,
    pub suggested: bool,
    pub segment_length_mm: f64,
    /// Largo de las patas de boots/moldes que ocupan las puntas del tramo.
    pub legs_mm: f64,
    /// Lo que el termo se monta sobre esas patas.
    pub overlap_mm: f64,
    pub cut_length_mm: f64,
}

/// Pata (largo, solape) del boot o molde en T que ocupa la punta `node_id` del
/// segmento, si hay uno elegido ahí.
fn leg_at_end(
    data: &ProjectData,
    library: &Library,
    segment_id: i64,
    node_id: i64,
) -> Option<(f64, f64)> {
    if let Some(connector) = data
        .connector_instances
        .iter()
        .find(|c| c.node_id == node_id)
    {
        if !matches!(
            connector.termination.as_deref(),
            Some("boot_straight") | Some("boot_90")
        ) {
            return None;
        }
        let boot = library
            .accessory_defs
            .iter()
            .find(|a| Some(a.part_id) == connector.termination_library_part_id)?;
        return Some((boot.leg_length_mm, boot.overlap_mm));
    }
    let node = data.nodes.iter().find(|n| n.id == node_id)?;
    if node.termination.as_deref() != Some("t_mold") {
        return None;
    }
    let t_mold = library
        .t_mold_defs
        .iter()
        .find(|t| Some(t.part_id) == node.termination_library_part_id)?;
    let position = node_segments_by_diameter(data, library, node_id)
        .iter()
        .position(|&(id, _)| id == segment_id)?;
    let leg = legs_by_size(t_mold).get(position)?.clone();
    Some((leg.leg_length_mm, t_mold.overlap_mm))
}

/// Lista de corte de coberturas (plan 8.1/9.2): un tramo de termo por segmento
/// con cables. Largo = segmento − patas de boots/moldes en sus puntas + solape
/// sobre cada pata.
pub fn covering_cut_list(data: &ProjectData, library: &Library) -> Vec<CoveringCut> {
    data.segments
        .iter()
        .filter(|s| bundle_diameter_mm(data, library, s.id) > 0.0)
        .map(|s| {
            let suggested = coverings_for_segment(data, library, s.id)
                .into_iter()
                .find(|f| f.fits)
                .map(|f| f.library_part_id);
            let (legs_mm, overlap_mm) = [s.node_a_id, s.node_b_id]
                .iter()
                .filter_map(|&n| leg_at_end(data, library, s.id, n))
                .fold((0.0, 0.0), |(l, o), (leg, overlap)| (l + leg, o + overlap));
            CoveringCut {
                segment_id: s.id,
                library_part_id: s.covering_library_part_id.or(suggested),
                suggested: s.covering_library_part_id.is_none() && suggested.is_some(),
                segment_length_mm: s.length_mm,
                legs_mm,
                overlap_mm,
                cut_length_mm: (s.length_mm - legs_mm + overlap_mm).max(0.0),
            }
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostReport {
    pub cut_list: Vec<WireCutLength>,
    pub bom: Vec<BomRow>,
    pub cost_summary: CostSummary,
    pub segment_diameters: Vec<SegmentDiameterInfo>,
    pub connector_terminations: Vec<ConnectorTerminationInfo>,
    pub breakout_terminations: Vec<BreakoutTerminationInfo>,
    pub splice_output_gauges: Vec<SpliceOutputGaugeInfo>,
    pub covering_cuts: Vec<CoveringCut>,
}

pub fn compute_cost_report(data: &ProjectData, library: &Library) -> CostReport {
    let bom = bill_of_materials(data, library);
    let cost_summary = cost_summary(&data.project, &bom);
    CostReport {
        cut_list: cut_list(data, library),
        bom,
        cost_summary,
        segment_diameters: segment_diameters(data, library),
        connector_terminations: connector_terminations(data, library),
        breakout_terminations: breakout_terminations(data, library),
        splice_output_gauges: splice_output_gauges(data, library),
        covering_cuts: covering_cut_list(data, library),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::library::{AccessoryDef, CoveringDef, Part};
    use crate::model::project::{
        CavityAssignment, ConnectorInstance, Node, Segment, SpliceInstance, TwistGroup, WireEnd,
    };

    fn wire_def(
        part_id: i64,
        outer_diameter_mm: f64,
        default_cut_margin_pct: Option<f64>,
    ) -> WireDef {
        WireDef {
            part_id,
            gauge: "22 AWG".into(),
            spec: None,
            color: None,
            outer_diameter_mm,
            default_cut_margin_pct,
            conductors: vec![],
        }
    }

    fn part(id: i64, category: &str, qty_per_pack: f64, price_usd: Option<f64>) -> Part {
        Part {
            id,
            part_number: format!("P{id}"),
            manufacturer: None,
            description: None,
            category: category.into(),
            purchase_unit: if category == "wire" {
                "meter".into()
            } else {
                "unit".into()
            },
            qty_per_pack,
            price_usd,
            price_date: price_usd.map(|_| "2026-01-01".into()),
        }
    }

    fn cavity_end(id: i64) -> WireEnd {
        WireEnd {
            kind: "cavity".into(),
            cavity_assignment_id: Some(id),
            splice_id: None,
            ground_point_id: None,
            component_instance_id: None,
        }
    }

    fn splice_end(id: i64) -> WireEnd {
        WireEnd {
            kind: "splice".into(),
            cavity_assignment_id: None,
            splice_id: Some(id),
            ground_point_id: None,
            component_instance_id: None,
        }
    }

    /// Otro cable igual al primero (mismos extremos), para que el tramo tenga
    /// más de un elemento y se trence.
    fn second_wire(data: &ProjectData) -> WireInstance {
        WireInstance {
            id: 2,
            short_id: "W002".into(),
            ..data.wire_instances[0].clone()
        }
    }

    /// Dos nodos, un segmento de 1000 mm entre ellos, y un cable de X1:1 a X2:1.
    fn one_segment_project(length_mm: f64, twist_pitch_mm: Option<f64>) -> ProjectData {
        ProjectData {
            project: Project {
                name: "T".into(),
                harness_code: "T-01".into(),
                client: None,
                revision: None,
                format_version: 1,
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
            nodes: vec![
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
            ],
            segments: vec![Segment {
                id: 1,
                node_a_id: 1,
                node_b_id: 2,
                length_mm,
                twist_pitch_mm,
                covering_library_part_id: None,
            }],
            connector_instances: vec![
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
            ],
            ground_points: vec![],
            splice_instances: vec![],
            component_instances: vec![],
            wire_instances: vec![WireInstance {
                id: 1,
                short_id: "W001".into(),
                library_part_id: 100,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: cavity_end(1),
                end_b: cavity_end(2),
            }],
            twist_groups: vec![],
        }
    }

    #[test]
    fn bundle_diameter_matches_the_plan_formula() {
        // Dos cables de 6mm cada uno, f=0.75 -> sqrt((6^2+6^2)/0.75) = sqrt(96) ≈ 9.798
        let diameters = [6.0, 6.0];
        let d = bundle_diameter(&diameters, 0.75);
        assert!((d - 9.798).abs() < 0.001, "got {d}");
    }

    #[test]
    fn default_pitch_factor_of_8_gives_the_plans_worked_outer_layer_margin() {
        // pitch = 8 * D_bundle -> factor = sqrt(1 + (pi/8)^2) ≈ 1.0744, independiente de D.
        let factor = twist_factor(10.0, 8.0 * 10.0);
        assert!((factor - 1.0744).abs() < 0.001, "got {factor}");
    }

    #[test]
    fn default_pitch_factor_of_16_gives_the_plans_worked_outer_layer_margin() {
        let factor = twist_factor(10.0, 16.0 * 10.0);
        assert!((factor - 1.0191).abs() < 0.001, "got {factor}");
    }

    #[test]
    fn a_manual_length_wins_even_without_a_route() {
        let mut data = one_segment_project(1000.0, Some(120.0));
        data.wire_instances.push(second_wire(&data)); // con dos cables el tramo se trenza
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 9.0, None));
        data.wire_instances[0].manual_length_mm = Some(1400.0);
        let cut = wire_cut_length(&data, &library, 1).unwrap();
        assert!(cut.manual);
        assert_eq!(cut.cut_length_mm, 1400.0); // sin margen: el largo a mano es el de corte
        assert!(cut.length_with_twist_mm > 1000.0); // el recorrido se sigue informando
                                                    // Sin recorrido (extremo suelto), el largo a mano igual da un renglón de corte.
        data.wire_instances[0].end_b.cavity_assignment_id = None;
        assert_eq!(
            wire_cut_length(&data, &library, 1).unwrap().cut_length_mm,
            1400.0
        );
    }

    #[test]
    fn cut_length_applies_twist_factor_then_margin_cascade() {
        let mut data = one_segment_project(1000.0, Some(120.0));
        data.wire_instances.push(second_wire(&data));
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 9.0, None));

        let cut = wire_cut_length(&data, &library, 1).unwrap();
        // D_bundle de dos cables de 9mm con f=0.75: sqrt(2·81/0.75) ≈ 14.697
        let expected_d_bundle = (2.0 * 81.0f64 / 0.75).sqrt();
        let expected_factor = twist_factor(expected_d_bundle, 120.0);
        let expected_length = 1000.0 * expected_factor;
        assert!((cut.length_with_twist_mm - expected_length).abs() < 0.001);
        assert_eq!(cut.margin_pct, 10.0); // cae al default del proyecto
        assert!((cut.cut_length_mm - expected_length * 1.10).abs() < 0.001);
    }

    #[test]
    fn manual_margin_wins_over_wire_def_and_project_defaults() {
        let mut data = one_segment_project(1000.0, Some(1_000_000.0)); // pitch enorme -> factor ~1
        data.wire_instances[0].manual_cut_margin_pct = Some(25.0);
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 2.0, Some(15.0)));

        let cut = wire_cut_length(&data, &library, 1).unwrap();
        assert_eq!(cut.margin_pct, 25.0);
    }

    #[test]
    fn wire_def_margin_wins_over_project_default_when_no_manual_margin() {
        let data = one_segment_project(1000.0, Some(1_000_000.0));
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 2.0, Some(15.0)));

        let cut = wire_cut_length(&data, &library, 1).unwrap();
        assert_eq!(cut.margin_pct, 15.0);
    }

    #[test]
    fn twist_group_members_collapse_to_one_bundle_element() {
        let mut data = one_segment_project(1000.0, Some(120.0));
        // Segundo cable en el mismo tramo, mismo grupo de trenzado que W001.
        data.wire_instances.push(WireInstance {
            id: 2,
            short_id: "W002".into(),
            library_part_id: 100,
            color: None,
            signal_type_id: None,
            specific_name: None,
            manual_cut_margin_pct: None,
            manual_length_mm: None,
            label: None,
            end_a: cavity_end(1),
            end_b: cavity_end(2),
        });
        data.connector_instances[0].cavities.push(CavityAssignment {
            id: 3,
            cavity_id: "2".into(),
            external_reference: None,
        });
        data.connector_instances[1].cavities.push(CavityAssignment {
            id: 4,
            cavity_id: "2".into(),
            external_reference: None,
        });
        data.wire_instances[1].end_a = cavity_end(3);
        data.wire_instances[1].end_b = cavity_end(4);
        data.twist_groups.push(TwistGroup {
            id: 1,
            name: "twist I".into(),
            shielded: false,
            drain: false,
            wire_instance_ids: vec![1, 2],
        });

        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 6.0, None));

        let grouped = bundle_diameter_mm(&data, &library, 1);
        // El grupo colapsa a un solo elemento con su propio diámetro sqrt((6^2+6^2)/0.75);
        // ese elemento pasa de nuevo por la fórmula del segmento (es el único elemento presente).
        let group_diameter = bundle_diameter(&[6.0, 6.0], 0.75);
        let expected = bundle_diameter(&[group_diameter], 0.75);
        assert!((grouped - expected).abs() < 0.001);
        // El par trenzado es lo único en el tramo, pero sus cables siguen la hélice.
        let cut = wire_cut_length(&data, &library, 1).unwrap();
        assert!(cut.length_with_twist_mm > 1000.0);
    }

    #[test]
    fn bom_counts_connectors_contacts_and_wire_meterage() {
        let data = one_segment_project(1000.0, Some(1_000_000.0));

        let mut library = Library::default();
        // El contacto sale del conector de la biblioteca, uno por vía con cable.
        library
            .connector_defs
            .push(crate::model::library::ConnectorDef {
                contact_part_id: Some(200),
                ..connector_def_with_series(10, "AMP", "CE")
            });
        library
            .contact_defs
            .push(crate::model::library::ContactDef {
                part_id: 200,
                gender: "female".into(),
                contact_size: "20".into(),
                gauge_min: None,
                gauge_max: None,
            });
        library.parts = vec![
            part(10, "connector", 1.0, Some(5.0)),
            part(100, "wire", 100.0, Some(0.5)),
            part(200, "contact", 50.0, Some(0.2)),
        ];
        library.wire_defs.push(wire_def(100, 2.0, None));

        let bom = bill_of_materials(&data, &library);

        let connector_row = bom.iter().find(|r| r.library_part_id == 10).unwrap();
        assert_eq!(connector_row.quantity_needed, 2.0); // X1 y X2 usan la misma parte
        assert_eq!(connector_row.quantity_to_buy, 2.0);

        let contact_row = bom.iter().find(|r| r.library_part_id == 200).unwrap();
        assert_eq!(contact_row.quantity_needed, 2.0); // el cable va de X1 a X2: un contacto en cada punta
        assert_eq!(contact_row.quantity_to_buy, 50.0); // redondeado al pack

        let wire_row = bom.iter().find(|r| r.library_part_id == 100).unwrap();
        assert!(wire_row.quantity_needed > 1.0); // 1000mm + 10% margen, en metros
        assert!(wire_row.subtotal_usd.unwrap() > 0.0);
    }

    #[test]
    fn bom_adds_spare_by_category_and_can_bill_what_is_bought() {
        let mut data = one_segment_project(1000.0, Some(1_000_000.0));
        data.project.spare_pcts = [("connector".to_string(), 10.0)].into();
        let mut library = Library::default();
        library.parts = vec![part(10, "connector", 5.0, Some(2.0))];

        let row = bill_of_materials(&data, &library).remove(0);
        assert_eq!(row.quantity_needed, 2.0);
        assert_eq!(row.spare, 1.0); // 10% de 2 conectores, redondeado a uno entero
        assert_eq!(row.quantity_to_buy, 5.0); // 3 redondeado al pack de 5
        assert_eq!(row.subtotal_usd, Some(6.0)); // sobre lo usado: 3 × 2

        data.project.cost_on_purchased = true;
        let row = bill_of_materials(&data, &library).remove(0);
        assert_eq!(row.subtotal_usd, Some(10.0)); // sobre lo comprado: 5 × 2
    }

    #[test]
    fn bom_adds_the_adhesive_heatshrink_piece_of_each_connector() {
        let mut data = one_segment_project(1000.0, Some(1_000_000.0));
        data.connector_instances[0].termination = Some("adhesive_heatshrink".into());
        data.connector_instances[0].termination_library_part_id = Some(7);
        let mut library = Library::default();
        library.parts = vec![part(7, "covering", 1.0, None)];
        library
            .connector_defs
            .push(crate::model::library::ConnectorDef {
                adhesive_heatshrink_length_mm: Some(40.0),
                ..connector_def_with_series(10, "AMP", "CE")
            });
        let row = bill_of_materials(&data, &library)
            .into_iter()
            .find(|r| r.library_part_id == 7)
            .unwrap();
        assert_eq!(row.quantity_needed, 0.04); // una pieza de 40 mm (solo X1 tiene termo con adhesivo)
    }

    #[test]
    fn bom_adds_the_adhesive_heatshrink_piece_of_a_breakout() {
        let mut data = one_segment_project(1000.0, Some(1_000_000.0));
        data.nodes[1].termination = Some("adhesive_heatshrink".into());
        data.nodes[1].termination_library_part_id = Some(7);
        data.nodes[1].adhesive_heatshrink_length_mm = Some(60.0);
        let mut library = Library::default();
        library.parts = vec![part(7, "covering", 1.0, None)];
        let row = bill_of_materials(&data, &library)
            .into_iter()
            .find(|r| r.library_part_id == 7)
            .unwrap();
        assert_eq!(row.quantity_needed, 0.06);
    }

    #[test]
    fn a_wire_alone_in_its_segments_is_not_twisted() {
        let data = one_segment_project(500.0, None);
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 0.81, None));
        let cut = wire_cut_length(&data, &library, 1).unwrap();
        assert_eq!(cut.length_with_twist_mm, 500.0);
        assert_eq!(cut.twist_min_margin_pct, 0.0);
    }

    #[test]
    fn covering_cut_is_segment_minus_boot_leg_plus_overlap() {
        let mut data = one_segment_project(1000.0, Some(1_000_000.0));
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 6.0, None));
        let d_bundle = (36.0f64 / 0.75).sqrt();
        library.covering_defs = vec![covering(7, d_bundle * 1.2, d_bundle * 0.8, 0.4)];
        library.accessory_defs = vec![accessory(50, 0.0, 20.0, "AMP", "CE")];

        // Sin boots: el termo va de punta a punta, y es el sugerido.
        let cut = covering_cut_list(&data, &library).remove(0);
        assert_eq!(
            (cut.library_part_id, cut.suggested, cut.cut_length_mm),
            (Some(7), true, 1000.0)
        );

        // Boot en X1 (pata 30, solape 15): 1000 − 30 + 15.
        data.connector_instances[0].termination = Some("boot_straight".into());
        data.connector_instances[0].termination_library_part_id = Some(50);
        let cut = covering_cut_list(&data, &library).remove(0);
        assert_eq!(cut.cut_length_mm, 985.0);
    }

    #[test]
    fn cost_summary_adds_labor_and_optional_markup() {
        let project = Project {
            name: "T".into(),
            harness_code: "T-01".into(),
            client: None,
            revision: None,
            format_version: 1,
            main_connector_instance_id: None,
            markup_pct: 20.0,
            default_cut_margin_pct: 10.0,
            default_twist_pitch_factor: 8.0,
            fill_factor: 0.75,
            labor_hours: 2.0,
            labor_rate_usd: 25.0,
            cost_on_purchased: false,
            spare_pcts: Default::default(),
            cut_round_mm: None,
        };
        let bom = vec![BomRow {
            library_part_id: 1,
            category: "wire".into(),
            part_number: "P1".into(),
            quantity_needed: 10.0,
            spare: 0.0,
            unit: "meter".into(),
            quantity_to_buy: 10.0,
            unit_price_usd: Some(1.0),
            subtotal_usd: Some(10.0),
            price_date: None,
        }];

        let summary = cost_summary(&project, &bom);
        assert_eq!(summary.materials_usd, 10.0);
        assert_eq!(summary.labor_usd, 50.0);
        assert_eq!(summary.markup_usd, 12.0); // 20% de (10 + 50)
        assert_eq!(summary.total_usd, 72.0);
    }

    fn covering(part_id: i64, supplied: f64, shrunk: f64, wall: f64) -> CoveringDef {
        CoveringDef {
            part_id,
            supplied_diameter_mm: supplied,
            shrunk_diameter_mm: shrunk,
            shrunk_wall_thickness_mm: wall,
            has_adhesive: false,
        }
    }

    #[test]
    fn suggests_the_smallest_covering_that_fits_and_flags_the_ones_that_dont() {
        let data = one_segment_project(1000.0, Some(1_000_000.0)); // pitch enorme -> factor ~1, D_bundle solo depende del cable
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 6.0, None));
        // D_bundle de un cable de 6mm con f=0.75: sqrt(36/0.75) ≈ 6.928
        let d_bundle = (36.0f64 / 0.75).sqrt();
        library.covering_defs = vec![
            covering(1, d_bundle * 0.5, d_bundle * 0.5, 0.3), // contraído no aprieta lo suficiente igual sirve (shrunk<=d_bundle) pero suministrado no entra
            covering(2, d_bundle * 1.2, d_bundle * 0.8, 0.4), // sirve: shrunk<=d_bundle y supplied>=d_bundle*1.1
            covering(3, d_bundle * 2.0, d_bundle * 1.5, 0.5), // shrunk > d_bundle: no aprieta
            CoveringDef {
                has_adhesive: true, // serviría por medidas, pero el adhesivo es para las puntas
                ..covering(4, d_bundle * 1.15, d_bundle * 0.5, 0.4)
            },
        ];

        let fits = coverings_for_segment(&data, &library, 1);
        assert_eq!(fits.len(), 3);
        assert!(!fits.iter().find(|f| f.library_part_id == 1).unwrap().fits);
        assert!(fits.iter().find(|f| f.library_part_id == 2).unwrap().fits);
        assert!(!fits.iter().find(|f| f.library_part_id == 3).unwrap().fits);

        let final_diameter = segment_final_diameter_mm(&data, &library, 1);
        assert!((final_diameter - d_bundle).abs() < 0.001); // sin covering asignado al segmento, no suma pared
    }

    #[test]
    fn suggests_the_thinnest_catalog_gauge_that_covers_a_splices_combined_wires() {
        let mut data = one_segment_project(1000.0, Some(1_000_000.0));
        data.splice_instances = vec![SpliceInstance {
            id: 1,
            short_id: "SP1".into(),
            name: String::new(),
            library_part_id: 1,
            node_id: Some(1),
            segment_id: None,
            offset_from_end_mm: None,
            offset_from_node_id: None,
        }];
        data.wire_instances = (1..=3)
            .map(|i| WireInstance {
                id: i,
                short_id: format!("W00{i}"),
                library_part_id: 100,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: splice_end(1),
                end_b: splice_end(1),
            })
            .collect();

        let mut library = Library::default();
        library.wire_defs = vec![
            WireDef {
                part_id: 100,
                gauge: "22 AWG".into(),
                spec: None,
                color: None,
                outer_diameter_mm: 2.3,
                default_cut_margin_pct: None,
                conductors: vec![],
            },
            WireDef {
                part_id: 200,
                gauge: "18 AWG".into(),
                spec: None,
                color: None,
                outer_diameter_mm: 3.0,
                default_cut_margin_pct: None,
                conductors: vec![],
            },
            WireDef {
                part_id: 300,
                gauge: "16 AWG".into(),
                spec: None,
                color: None,
                outer_diameter_mm: 3.5,
                default_cut_margin_pct: None,
                conductors: vec![],
            },
        ];

        let infos = splice_output_gauges(&data, &library);
        assert_eq!(infos.len(), 1);
        let info = &infos[0];
        let expected_mm2 = 3.0 * crate::gauge::gauge_to_mm2("22 AWG").unwrap();
        assert!((info.combined_mm2 - expected_mm2).abs() < 1e-9);

        // 3× 22 AWG ≈ 0.98mm²: 18 AWG (≈0.82mm²) no alcanza, 16 AWG (≈1.31mm²) sí.
        let suggested = info
            .options
            .iter()
            .find(|o| o.fits)
            .expect("alguno debería cubrir");
        assert_eq!(suggested.gauge, "16 AWG");
        assert!(
            !info
                .options
                .iter()
                .find(|o| o.gauge == "18 AWG")
                .unwrap()
                .fits
        );
    }

    #[test]
    fn segment_final_diameter_adds_the_shrunk_wall_of_the_assigned_covering() {
        let mut data = one_segment_project(1000.0, Some(1_000_000.0));
        data.segments[0].covering_library_part_id = Some(1);
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 6.0, None));
        library.covering_defs.push(covering(1, 20.0, 10.0, 0.5));

        let d_bundle = bundle_diameter_mm(&data, &library, 1);
        let final_diameter = segment_final_diameter_mm(&data, &library, 1);
        assert!((final_diameter - (d_bundle + 1.0)).abs() < 0.001); // +2×0.5mm de pared
    }

    fn connector_def_with_series(
        part_id: i64,
        series: &str,
        shell_size: &str,
    ) -> crate::model::library::ConnectorDef {
        crate::model::library::ConnectorDef {
            part_id,
            gender: "female".into(),
            series: Some(series.into()),
            shell_size: Some(shell_size.into()),
            counterpart_id: None,
            back_shape: None,
            back_diameter_mm: None,
            back_width_mm: None,
            back_height_mm: None,
            suggested_termination: None,
            contact_part_id: None,
            seal_plug_part_id: None,
            adhesive_heatshrink_length_mm: None,
            image_side: None,
            image_front: None,
            image_back: None,
            cavities: vec![],
        }
    }

    fn accessory(
        part_id: i64,
        min_d: f64,
        max_d: f64,
        series: &str,
        shell_size: &str,
    ) -> AccessoryDef {
        AccessoryDef {
            part_id,
            orientation: "straight".into(),
            cable_side_min_diameter_mm: min_d,
            cable_side_max_diameter_mm: max_d,
            leg_length_mm: 30.0,
            overlap_mm: 15.0,
            compatible_connectors: vec![crate::model::library::AccessoryDefConnectorMatch {
                series: series.into(),
                shell_size: shell_size.into(),
            }],
        }
    }

    #[test]
    fn boot_fit_checks_both_connector_compatibility_and_cable_side_diameter() {
        let data = one_segment_project(1000.0, Some(1_000_000.0));
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 6.0, None));
        library
            .connector_defs
            .push(connector_def_with_series(10, "AMP", "CE"));
        let d_bundle = bundle_diameter_mm(&data, &library, 1);
        library.accessory_defs = vec![
            accessory(1, d_bundle - 1.0, d_bundle + 1.0, "AMP", "CE"), // compatible y en rango
            accessory(2, d_bundle - 1.0, d_bundle + 1.0, "DT", "06"), // rango ok, serie no compatible
            accessory(3, d_bundle + 5.0, d_bundle + 10.0, "AMP", "CE"), // compatible, fuera de rango
        ];

        let fits = boots_for_connector(&data, &library, 1); // connector X1, library_part_id 10
        let by_id = |id: i64| fits.iter().find(|f| f.library_part_id == id).unwrap();
        assert!(by_id(1).fits);
        assert!(!by_id(2).connector_compatible);
        assert!(by_id(3).connector_compatible && !by_id(3).cable_side_ok);
    }

    fn t_mold(part_id: i64, legs: &[(f64, f64)]) -> crate::model::library::TMoldDef {
        crate::model::library::TMoldDef {
            part_id,
            overlap_mm: 20.0,
            legs: legs
                .iter()
                .map(|&(min, max)| crate::model::library::TMoldLeg {
                    min_diameter_mm: min,
                    max_diameter_mm: max,
                    leg_length_mm: 30.0,
                })
                .collect(),
        }
    }

    #[test]
    fn t_mold_fit_pairs_segments_and_legs_by_size_descending() {
        // Breakout (node 2) con 3 patas: segmento 1 (grueso, ya cargado por y_shaped-like setup)
        let mut data = one_segment_project(1000.0, Some(1_000_000.0));
        // Reutilizamos el nodo 2 como breakout con dos segmentos más, de distinto diámetro.
        data.nodes.push(Node {
            id: 3,
            kind: "connector_end".into(),
            termination: None,
            termination_library_part_id: None,
            diagram_x: None,
            diagram_y: None,
            adhesive_heatshrink_length_mm: None,
        });
        data.nodes.push(Node {
            id: 4,
            kind: "connector_end".into(),
            termination: None,
            termination_library_part_id: None,
            diagram_x: None,
            diagram_y: None,
            adhesive_heatshrink_length_mm: None,
        });
        data.segments.push(Segment {
            id: 2,
            node_a_id: 2,
            node_b_id: 3,
            length_mm: 500.0,
            twist_pitch_mm: Some(1_000_000.0),
            covering_library_part_id: None,
        });
        data.segments.push(Segment {
            id: 3,
            node_a_id: 2,
            node_b_id: 4,
            length_mm: 500.0,
            twist_pitch_mm: Some(1_000_000.0),
            covering_library_part_id: None,
        });

        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 6.0, None)); // solo el segmento 1 tiene cable -> D_bundle > 0; los otros dos dan 0.0
        let d1 = bundle_diameter_mm(&data, &library, 1); // ~6.93mm
                                                         // Patas: una que cubre d1 (grande), y dos que cubren 0.0 (chicas) -> las 3 calzan.
        library.t_mold_defs = vec![t_mold(50, &[(0.0, 1.0), (0.0, 1.0), (d1 - 1.0, d1 + 1.0)])];

        let fits = t_mold_fits_for_node(&data, &library, 2);
        assert_eq!(fits.len(), 1);
        assert!(fits[0].fits);
        assert_eq!(fits[0].leg_fits.len(), 3);
    }

    #[test]
    fn t_mold_does_not_fit_when_leg_count_does_not_match_segment_count() {
        let data = one_segment_project(1000.0, Some(1_000_000.0)); // solo 1 segmento en el nodo 1 (no es un breakout de 3)
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 6.0, None));
        library.t_mold_defs = vec![t_mold(50, &[(0.0, 100.0), (0.0, 100.0), (0.0, 100.0)])];

        let fits = t_mold_fits_for_node(&data, &library, 1); // nodo 1 solo tiene 1 segmento conectado
        assert_eq!(fits.len(), 1);
        assert!(!fits[0].fits);
    }

    /// Medición, no un test: cuánto tarda una pasada con un arnés real.
    /// `HD_PROJECT=<arnés.db> HD_LIBRARY=<biblioteca.db> cargo test --release bench_real_project -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_real_project() {
        let project = crate::model::project::load(
            &crate::db::open_existing_project(&std::env::var("HD_PROJECT").unwrap()).unwrap(),
        )
        .unwrap();
        let library = crate::model::library::load(
            &crate::db::open_existing_library(&std::env::var("HD_LIBRARY").unwrap()).unwrap(),
        )
        .unwrap();
        let time = |label: &str, f: &dyn Fn()| {
            let t = std::time::Instant::now();
            f();
            println!("{label}: {:.1} ms", t.elapsed().as_secs_f64() * 1000.0);
        };
        time("costs, sin memoria", &|| {
            drop(compute_cost_report(&project, &library))
        });
        time("costs, con memoria", &|| {
            drop(with_cache(|| compute_cost_report(&project, &library)))
        });
        time("checks, sin memoria", &|| {
            drop(crate::checks::run_checks(&project, &library))
        });
        time("checks, con memoria", &|| {
            drop(with_cache(|| crate::checks::run_checks(&project, &library)))
        });
        assert_eq!(
            compute_cost_report(&project, &library),
            with_cache(|| compute_cost_report(&project, &library))
        );
    }

    #[test]
    fn cut_length_rounds_up_to_the_project_step() {
        assert_eq!(round_up(1234.5, Some(10.0)), 1240.0);
        assert_eq!(round_up(1240.0, Some(10.0)), 1240.0);
        assert_eq!(round_up(1201.0, Some(50.0)), 1250.0);
        assert_eq!(round_up(1234.5, None), 1234.5);
    }
}
