//! Calibre mínimo del cable que sale de un splice (plan 13).

use super::wire_def_of;
use crate::model::library::Library;
use crate::model::project::{ProjectData, WireInstance};
use serde::{Deserialize, Serialize};

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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::calc::test_fixtures::*;
    use crate::model::library::WireDef;
    use crate::model::project::SpliceInstance;

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

        let library = Library {
            wire_defs: vec![
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
            ],
            ..Default::default()
        };

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
}
