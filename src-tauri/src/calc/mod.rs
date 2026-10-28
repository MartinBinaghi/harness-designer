//! Largo de corte, diámetro de bundle, BOM y costos. Ver ../../../CLAUDE.md
//! secciones 5 y 8.
//!
//! Sin módulo concéntrico (etapa 7, opcional) no sabemos en qué capa va cada
//! cable, así que el diámetro de hélice `D` del factor de trenzado (5.1) se
//! aproxima al `D_bundle` del segmento entero: es el "peor caso" que el plan
//! ya pide usar mientras no haya construcción concéntrica cargada.

mod bom;
mod covering_cuts;
mod cut_length;
mod diameter;
mod fits;
mod splice_gauges;
#[cfg(test)]
mod test_fixtures;

pub use bom::*;
pub use covering_cuts::*;
pub use cut_length::*;
pub use diameter::*;
pub use fits::*;
pub use splice_gauges::*;

use crate::model::library::{Library, WireDef};
use crate::model::project::{ProjectData, WireInstance};
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

    /// Medición, no un test: cuánto tarda una pasada con un arnés real.
    /// `HD_PROJECT=<arnés.db> HD_LIBRARY=<biblioteca.db> cargo test --release bench_real_project -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_real_project() {
        let project = crate::model::project::load(
            &crate::db::open_project(&std::env::var("HD_PROJECT").unwrap()).unwrap(),
        )
        .unwrap();
        let library = crate::model::library::load(
            &crate::db::open_library(&std::env::var("HD_LIBRARY").unwrap()).unwrap(),
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
}
