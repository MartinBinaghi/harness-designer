//! Capacidad de un cable donde pasa (pedido de Martin del 2026-11-19; fuentes y
//! decisiones en la bitácora): su corriente solo al aire, corregida por la
//! temperatura del arnés y por el mazo de cada tramo. Es el método de la
//! FAA AC 43.13-1B (párrafos 11-67 a 11-69) y de la SAE AS50881:
//!
//! ```text
//! capacidad = al aire(ΔT) × factor de mazo(cables del tramo, % con corriente)
//! ```
//!
//! - **Al aire:** cada tipo de cable guarda la de Raychem (Wire and Cable
//!   10-59: 40 °C de ambiente, 60 °C de aumento). Para otro margen,
//!   ΔT = temperatura máxima del cable − ambiente del arnés, se escala con
//!   (ΔT / 60)^0,57. El exponente sale de los ejemplos resueltos de la FAA
//!   (22 AWG 16,2 A y 20 AWG 21,5 A con ΔT 140; 14 AWG 47 A con ΔT 150; 12 AWG
//!   61 y 68 A con ΔT 140 y 175) contra los valores de Raychem, y reproduce la
//!   tabla 11-9 de la FAA (ver el test). Las curvas de la FAA van de ΔT 30 a
//!   300 °C: con menos margen no hay dato y no se adivina.
//! - **Factor de mazo:** la figura 4 de la AS50881 (2015, igual a la 11-5 de la
//!   FAA), digitalizada de 1 a 45 cables para 20, 40, 60, 80 y 100 % de carga.
//!   El % de carga es la parte de los cables del tramo que llevan corriente
//!   (decisión de Martin; así lo usan los ejemplos de la FAA). Entre curvas se
//!   interpola; menos del 20 %, la del 20 %; más de 45 cables, la de 45 (las
//!   curvas ya son planas).
//! - **Altura:** al nivel del mar (factor 1; la tabla 11-9 de la FAA es para
//!   60.000 ft, factor 0,79).
//! - **Dónde:** en cada pedazo de tramo de su recorrido (un splice o componente
//!   sobre un tramo lo parte en dos: `topology::segment_spans`); vale el más
//!   exigente. Un cable que no recorre ninguno (sus dos puntas en el mismo
//!   nodo, como un splice pegado al conector) toma el pedazo con más cables que
//!   llega a ese nodo: está metido en ese mazo.

use crate::model::library::WireDef;
use crate::model::project::{ProjectData, WireInstance};
use crate::topology::{segment_spans, span_at_node, wire_end_node, wire_route};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Aumento de temperatura al que da Raychem la corriente al aire.
const REFERENCE_RISE_C: f64 = 60.0;
/// Exponente de la corriente al aire contra el margen de temperatura.
const RISE_EXPONENT: f64 = 0.57;
/// Margen de temperatura que cubren las curvas de la FAA (figura 11-4).
const MIN_RISE_C: f64 = 30.0;
const MAX_RISE_C: f64 = 300.0;

/// AS50881 (2015), figura 4: factor de mazo según la cantidad de cables (fila
/// `n - 1`) y el % de la capacidad del mazo en uso (columnas: 20, 40, 60, 80 y
/// 100 %). Digitalizada de la reproducción de Glenair (GT-20-394); coincide
/// con los ejemplos de la FAA y con los factores de Raychem (ver los tests).
const BUNDLE_DERATING: [[f64; 5]; 45] = [
    [1.000, 1.000, 1.000, 1.000, 1.000], // 1
    [0.959, 0.910, 0.881, 0.844, 0.802], // 2
    [0.924, 0.849, 0.801, 0.757, 0.719], // 3
    [0.909, 0.824, 0.772, 0.724, 0.688], // 4
    [0.870, 0.760, 0.694, 0.644, 0.611], // 5
    [0.843, 0.724, 0.652, 0.602, 0.571], // 6
    [0.825, 0.703, 0.631, 0.581, 0.548], // 7
    [0.794, 0.667, 0.592, 0.544, 0.511], // 8
    [0.777, 0.649, 0.575, 0.528, 0.493], // 9
    [0.748, 0.618, 0.543, 0.498, 0.462], // 10
    [0.728, 0.599, 0.525, 0.479, 0.444], // 11
    [0.716, 0.587, 0.514, 0.468, 0.433], // 12
    [0.695, 0.564, 0.494, 0.447, 0.412], // 13
    [0.684, 0.552, 0.482, 0.434, 0.401], // 14
    [0.674, 0.543, 0.471, 0.425, 0.391], // 15
    [0.660, 0.531, 0.458, 0.412, 0.379], // 16
    [0.645, 0.518, 0.444, 0.398, 0.367], // 17
    [0.636, 0.509, 0.435, 0.391, 0.359], // 18
    [0.623, 0.498, 0.424, 0.381, 0.349], // 19
    [0.614, 0.488, 0.415, 0.375, 0.340], // 20
    [0.604, 0.480, 0.407, 0.368, 0.332], // 21
    [0.598, 0.473, 0.400, 0.361, 0.325], // 22
    [0.589, 0.464, 0.394, 0.356, 0.316], // 23
    [0.583, 0.457, 0.386, 0.350, 0.309], // 24
    [0.573, 0.446, 0.376, 0.340, 0.299], // 25
    [0.569, 0.442, 0.374, 0.336, 0.295], // 26
    [0.564, 0.433, 0.365, 0.326, 0.290], // 27
    [0.557, 0.431, 0.361, 0.324, 0.285], // 28
    [0.548, 0.424, 0.354, 0.316, 0.278], // 29
    [0.543, 0.418, 0.350, 0.310, 0.275], // 30
    [0.539, 0.415, 0.348, 0.309, 0.271], // 31
    [0.535, 0.411, 0.344, 0.304, 0.269], // 32
    [0.529, 0.404, 0.340, 0.300, 0.265], // 33
    [0.526, 0.402, 0.338, 0.298, 0.263], // 34
    [0.524, 0.398, 0.335, 0.294, 0.261], // 35
    [0.521, 0.395, 0.333, 0.291, 0.260], // 36
    [0.518, 0.391, 0.331, 0.288, 0.259], // 37
    [0.517, 0.390, 0.330, 0.287, 0.258], // 38
    [0.515, 0.390, 0.329, 0.286, 0.258], // 39
    [0.514, 0.389, 0.327, 0.285, 0.257], // 40
    [0.512, 0.388, 0.326, 0.284, 0.256], // 41
    [0.511, 0.387, 0.325, 0.283, 0.255], // 42
    [0.510, 0.387, 0.324, 0.282, 0.255], // 43
    [0.508, 0.386, 0.322, 0.281, 0.254], // 44
    [0.507, 0.385, 0.321, 0.280, 0.253], // 45
];

/// Factor de mazo para `wires` cables de los que `loaded` llevan corriente.
pub(crate) fn bundle_factor(wires: usize, loaded: usize) -> f64 {
    let row = &BUNDLE_DERATING[wires.clamp(1, 45) - 1];
    let pct = (100.0 * loaded as f64 / wires.max(1) as f64).clamp(20.0, 100.0);
    let at = (pct - 20.0) / 20.0; // 0 = curva del 20 %, 4 = la del 100 %
    let low = (at.floor() as usize).min(3);
    row[low] + (row[low + 1] - row[low]) * (at - low as f64)
}

/// Por qué no hay capacidad para un cable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapacityLimit {
    /// A su tipo de cable le falta la corriente al aire o la temperatura máxima.
    NoLibraryData,
    /// El ambiente del arnés ya llega a la temperatura máxima del cable.
    TooHot,
    /// Le quedan menos de 30 °C de margen: fuera de las curvas de la FAA.
    BeyondCurves,
    /// No tiene recorrido (le falta una punta o su ubicación): no se sabe en qué mazo va.
    NoRoute,
}

/// El mazo donde un cable tiene su capacidad (el tramo más exigente).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BundleAt {
    /// `None`: no hay ningún tramo en su nodo; va solo, al aire.
    pub segment_id: Option<i64>,
    /// Largo del pedazo (mm) cuando un splice o componente parte el tramo:
    /// cada lado es otro mazo. `None` si es el tramo entero.
    pub piece_mm: Option<f64>,
    pub wires: usize,
    pub loaded: usize,
    pub factor: f64,
}

/// Cables de un pedazo de tramo y cuántos llevan corriente.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct SegmentLoad {
    pub start_mm: f64,
    pub end_mm: f64,
    pub wires: usize,
    pub loaded: usize,
}

/// Cuántos cables pasan por cada pedazo de cada tramo (`segment_spans`, en el
/// mismo orden) y cuántos llevan corriente (`carries(cable)`). Cada conductor
/// de un cable comprado cuenta aparte, como en la AS50881.
pub(crate) fn segment_loads(
    data: &ProjectData,
    carries: impl Fn(i64) -> bool,
) -> HashMap<i64, Vec<SegmentLoad>> {
    segment_spans(data)
        .iter()
        .map(|(&segment, spans)| {
            let loads = spans
                .iter()
                .map(|span| SegmentLoad {
                    start_mm: span.start_mm,
                    end_mm: span.end_mm,
                    wires: span.wire_ids.len(),
                    loaded: span.wire_ids.iter().filter(|&&w| carries(w)).count(),
                })
                .collect();
            (segment, loads)
        })
        .collect()
}

/// Corriente solo al aire con el margen `rise_c` (°C) que le deja el ambiente.
fn free_air_a(at_reference_a: f64, rise_c: f64) -> Result<f64, CapacityLimit> {
    if rise_c <= 0.0 {
        return Err(CapacityLimit::TooHot);
    }
    if rise_c < MIN_RISE_C {
        return Err(CapacityLimit::BeyondCurves);
    }
    Ok(at_reference_a * (rise_c.min(MAX_RISE_C) / REFERENCE_RISE_C).powf(RISE_EXPONENT))
}

/// El mazo más exigente del cable: el pedazo de tramo de su recorrido con menor
/// factor, o, si no recorre ninguno, el pedazo con más cables que llega a su
/// nodo.
fn worst_bundle(
    data: &ProjectData,
    wire: &WireInstance,
    loads: &HashMap<i64, Vec<SegmentLoad>>,
) -> Option<BundleAt> {
    let spans_of = |segment_id: i64| {
        loads
            .get(&segment_id)
            .map(Vec::as_slice)
            .unwrap_or_default()
    };
    let at = |segment_id: i64, load: &SegmentLoad| BundleAt {
        segment_id: Some(segment_id),
        piece_mm: (spans_of(segment_id).len() > 1).then_some(load.end_mm - load.start_mm),
        wires: load.wires,
        loaded: load.loaded,
        factor: bundle_factor(load.wires, load.loaded),
    };
    let route = wire_route(data, wire.id)?;
    let worst = route
        .iter()
        .flat_map(|leg| {
            spans_of(leg.segment_id)
                .iter()
                .filter(|l| leg.covers(l.start_mm, l.end_mm))
                .map(|l| at(leg.segment_id, l))
        })
        .min_by(|a, b| a.factor.total_cmp(&b.factor));
    if worst.is_some() {
        return worst;
    }
    let node = wire_end_node(data, &wire.end_a).or_else(|| wire_end_node(data, &wire.end_b))?;
    let busiest = data
        .segments
        .iter()
        .filter_map(|s| span_at_node(spans_of(s.id), s, node).map(|l| (s.id, l)))
        .max_by_key(|(id, l)| (l.wires, std::cmp::Reverse(*id)));
    Some(busiest.map_or(
        BundleAt {
            segment_id: None,
            piece_mm: None,
            wires: 1,
            loaded: 1,
            factor: 1.0,
        },
        |(id, l)| at(id, l),
    ))
}

/// Capacidad del cable donde pasa (A), o por qué no se puede saber; y el mazo
/// que la limita.
pub(crate) fn wire_capacity(
    data: &ProjectData,
    def: Option<&WireDef>,
    wire: &WireInstance,
    loads: &HashMap<i64, Vec<SegmentLoad>>,
) -> (Result<f64, CapacityLimit>, Option<BundleAt>) {
    let bundle = worst_bundle(data, wire, loads);
    let capacity = (|| {
        let def = def.ok_or(CapacityLimit::NoLibraryData)?;
        let (Some(reference), Some(max_c)) = (def.free_air_current_a, def.max_temperature_c) else {
            return Err(CapacityLimit::NoLibraryData);
        };
        let free_air = free_air_a(reference, max_c - data.project.ambient_temperature_c)?;
        let factor = bundle.as_ref().ok_or(CapacityLimit::NoRoute)?.factor;
        Ok(free_air * factor)
    })();
    (capacity, bundle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tolerance: f64) -> bool {
        (a - b).abs() <= tolerance
    }

    #[test]
    fn each_wire_takes_the_bundle_of_the_pieces_it_runs_through() {
        // Con SP1 a 40 mm de X1, el tramo son dos mazos de dos cables (W001 y
        // W003; W002 y W003), no uno de tres.
        let data = crate::calc::test_fixtures::splice_40_mm_from_x1();
        let loads = segment_loads(&data, |_| true);
        let wires: Vec<usize> = loads[&1].iter().map(|l| l.wires).collect();
        assert_eq!(wires, vec![2, 2]);
        let mut pieces = Vec::new();
        for wire in &data.wire_instances {
            let bundle = worst_bundle(&data, wire, &loads).unwrap();
            assert_eq!((bundle.segment_id, bundle.wires), (Some(1), 2));
            pieces.push(bundle.piece_mm);
        }
        // Los mensajes dicen de qué lado: los 40 mm de X1 o los 460 hasta X2.
        assert_eq!(pieces, vec![Some(40.0), Some(460.0), Some(40.0)]);
    }

    #[test]
    fn the_digitized_curves_match_the_published_points() {
        // Ejemplos resueltos de la FAA (párrafos 11-67 y 11-69).
        assert!(close(bundle_factor(35, 7), 0.52, 0.01)); // 35 cables, 20 %
        assert!(close(bundle_factor(12, 12), 0.43, 0.01)); // 12 cables, 100 %
        assert!(close(bundle_factor(8, 5), 0.60, 0.02)); // 8 cables, ≈60 %: FAA 0,6
                                                         // Raychem, Wire and Cable 10-59: todos los cables cargados.
        for (n, factor) in [
            (2, 0.825),
            (3, 0.73),
            (4, 0.66),
            (7, 0.54),
            (9, 0.49),
            (12, 0.43),
            (15, 0.39),
            (18, 0.36),
            (21, 0.33),
            (24, 0.31),
            (27, 0.29),
            (30, 0.28),
            (37, 0.26),
        ] {
            assert!(
                close(bundle_factor(n, n), factor, 0.03),
                "{n} cables: {} contra {factor}",
                bundle_factor(n, n)
            );
        }
    }

    #[test]
    fn the_loading_is_interpolated_and_clamped_to_the_curves() {
        assert_eq!(bundle_factor(1, 1), 1.0);
        assert_eq!(bundle_factor(20, 0), bundle_factor(20, 4)); // menos del 20 % = 20 %
        let mid = bundle_factor(20, 6); // 30 %: entre la del 20 % y la del 40 %
        assert!(close(mid, (0.614 + 0.488) / 2.0, 1e-9));
        assert_eq!(bundle_factor(60, 60), BUNDLE_DERATING[44][4]); // más de 45: la de 45
    }

    #[test]
    fn it_reproduces_the_faa_bundled_table() {
        // Tabla 11-9 de la FAA (150 °C, en mazo): 70 °C de ambiente, 33 cables o
        // más con no más del 20 % de la capacidad en uso, y 60.000 ft (× 0,79).
        // Con los valores al aire de Raychem, el método la reproduce: 16 AWG
        // queda 11 % abajo (Raychem es más conservador en ese calibre).
        for (raychem_a, faa_a) in [
            (7.5, 4.0),
            (10.0, 5.0),
            (13.0, 7.0),
            (17.5, 9.0),
            (20.0, 11.0),
            (28.0, 14.0),
            (37.5, 19.0),
        ] {
            let ours = free_air_a(raychem_a, 150.0 - 70.0).unwrap() * bundle_factor(33, 6) * 0.79;
            assert!(
                (ours - faa_a).abs() / faa_a < 0.12,
                "{raychem_a} A al aire: {ours:.2} contra {faa_a} de la FAA"
            );
        }
    }

    #[test]
    fn without_enough_temperature_margin_there_is_no_capacity() {
        assert_eq!(free_air_a(17.5, 0.0), Err(CapacityLimit::TooHot));
        assert_eq!(free_air_a(17.5, -10.0), Err(CapacityLimit::TooHot));
        assert_eq!(free_air_a(17.5, 25.0), Err(CapacityLimit::BeyondCurves));
        assert!(close(free_air_a(17.5, 60.0).unwrap(), 17.5, 1e-9));
        // 18 AWG a 105 °C (ΔT 45): ≈14,9 A al aire.
        assert!(close(free_air_a(17.5, 45.0).unwrap(), 14.9, 0.1));
    }
}
