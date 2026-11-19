//! Diámetro del bundle de cada tramo (plan 5.2) y diámetro final con coberturas.
//! El mazo es el de cada pedazo del segmento (`topology::segment_spans`): con
//! un splice sobre el tramo, los que entran y los que salen no van juntos.

use super::{
    cable_def_of, coverings_for_segment, element_of, twist_group_of_wire, wire_def_of, CoveringFit,
    Element, PASS,
};
use crate::model::library::Library;
use crate::model::project::{ProjectData, WireInstance};
use crate::topology::{segment_spans, span_at_node};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Elementos de un mazo (los cables `wires`; un cable comprado cuenta uno) y el
/// diámetro de cada uno: cables sueltos por su propio `WireDef`, cada cable
/// comprado una vez con el diámetro del cable entero, y cada grupo de trenzado
/// (`group_of`: cable -> grupo) colapsado a un solo elemento (mismo cálculo
/// `sqrt(Σd²/f)` aplicado a sus miembros presentes en el mazo).
fn element_diameters<'a>(
    data: &ProjectData,
    library: &Library,
    group_of: &HashMap<i64, i64>,
    wires: impl Iterator<Item = &'a WireInstance>,
) -> (usize, Vec<f64>) {
    let mut loose = Vec::new();
    let mut group_members: HashMap<i64, Vec<f64>> = HashMap::new();
    let mut seen = HashSet::new();

    for wire in wires {
        let element = element_of(wire);
        if !seen.insert(element) {
            continue; // otro conductor del mismo cable comprado: ya está
        }
        let def = match element {
            Element::Cable(cable_id) => cable_def_of(data, library, cable_id),
            Element::Wire(_) => wire_def_of(library, wire),
        };
        let Some(def) = def else {
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

    let mut diameters = loose;
    for members in group_members.into_values() {
        diameters.push(bundle_diameter(&members, data.project.fill_factor));
    }
    (seen.len(), diameters)
}

fn bundle_diameter(element_diameters_mm: &[f64], fill_factor: f64) -> f64 {
    let sum_sq: f64 = element_diameters_mm.iter().map(|d| d * d).sum();
    (sum_sq / fill_factor).sqrt()
}

/// El mazo de un pedazo de segmento: dónde está, cuántos elementos lleva (un
/// cable comprado cuenta uno) y su `D_bundle` (0 si no pasa ningún cable).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BundleSpan {
    pub start_mm: f64,
    pub end_mm: f64,
    pub elements: usize,
    pub diameter_mm: f64,
}

fn compute_bundle_spans(data: &ProjectData, library: &Library) -> HashMap<i64, Vec<BundleSpan>> {
    let group_of = twist_group_of_wire(data);
    let by_id: HashMap<i64, &WireInstance> =
        data.wire_instances.iter().map(|w| (w.id, w)).collect();
    segment_spans(data)
        .iter()
        .map(|(&segment_id, spans)| {
            let bundles = spans
                .iter()
                .map(|span| {
                    let wires = span.wire_ids.iter().filter_map(|id| by_id.get(id).copied());
                    let (elements, diameters) = element_diameters(data, library, &group_of, wires);
                    BundleSpan {
                        start_mm: span.start_mm,
                        end_mm: span.end_mm,
                        elements,
                        diameter_mm: if diameters.is_empty() {
                            0.0
                        } else {
                            bundle_diameter(&diameters, data.project.fill_factor)
                        },
                    }
                })
                .collect();
            (segment_id, bundles)
        })
        .collect()
}

/// Los mazos de cada pedazo de un segmento, en orden desde su nodo A.
pub(crate) fn bundle_spans(
    data: &ProjectData,
    library: &Library,
    segment_id: i64,
) -> Vec<BundleSpan> {
    let of =
        |all: &HashMap<i64, Vec<BundleSpan>>| all.get(&segment_id).cloned().unwrap_or_default();
    // Fuera de una pasada no hay dónde guardarlo; dentro, se calcula sin tener
    // tomado el caché (lo que se calcula también lo consulta).
    let in_pass = PASS.with(|c| c.borrow().as_ref().map(|p| p.bundle_spans.as_ref().map(of)));
    match in_pass {
        Some(Some(hit)) => hit,
        Some(None) => {
            let all = compute_bundle_spans(data, library);
            let hit = of(&all);
            PASS.with(|c| {
                if let Some(pass) = c.borrow_mut().as_mut() {
                    pass.bundle_spans = Some(all);
                }
            });
            hit
        }
        None => of(&compute_bundle_spans(data, library)),
    }
}

/// `D_bundle = √(Σdᵢ²/f)` del segmento (plan 5.2): el de su pedazo más grueso.
/// `0.0` si no pasa ningún cable.
pub fn bundle_diameter_mm(data: &ProjectData, library: &Library, segment_id: i64) -> f64 {
    bundle_spans(data, library, segment_id)
        .iter()
        .map(|s| s.diameter_mm)
        .fold(0.0, f64::max)
}

/// `D_bundle` del segmento donde llega a `node` (una de sus puntas): lo que
/// entra en el boot o la pata del molde de ese nodo.
pub(crate) fn bundle_diameter_at_node_mm(
    data: &ProjectData,
    library: &Library,
    segment_id: i64,
    node: i64,
) -> f64 {
    let Some(segment) = data.segments.iter().find(|s| s.id == segment_id) else {
        return 0.0;
    };
    span_at_node(&bundle_spans(data, library, segment_id), segment, node)
        .map_or(0.0, |s| s.diameter_mm)
}

/// Lo que suma el termo del segmento al diámetro: dos veces su pared contraída.
fn covering_walls_mm(data: &ProjectData, library: &Library, segment_id: i64) -> f64 {
    2.0 * data
        .segments
        .iter()
        .find(|s| s.id == segment_id)
        .and_then(|s| s.covering_library_part_id)
        .and_then(|id| library.covering_defs.iter().find(|c| c.part_id == id))
        .map(|c| c.shrunk_wall_thickness_mm)
        .unwrap_or(0.0)
}

/// Diámetro final del segmento con su cobertura aplicada (plan 5.2): el termo
/// rodea el bundle, así que suma dos veces el espesor de pared contraído.
pub fn segment_final_diameter_mm(data: &ProjectData, library: &Library, segment_id: i64) -> f64 {
    bundle_diameter_mm(data, library, segment_id) + covering_walls_mm(data, library, segment_id)
}

/// Diámetro final del segmento donde llega a `node`, con su cobertura.
pub(crate) fn final_diameter_at_node_mm(
    data: &ProjectData,
    library: &Library,
    segment_id: i64,
    node: i64,
) -> f64 {
    bundle_diameter_at_node_mm(data, library, segment_id, node)
        + covering_walls_mm(data, library, segment_id)
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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::calc::test_fixtures::*;
    use crate::calc::wire_cut_length;
    use crate::model::project::{CavityAssignment, TwistGroup, WireInstance};

    #[test]
    fn bundle_diameter_matches_the_plan_formula() {
        // Dos cables de 6mm cada uno, f=0.75 -> sqrt((6^2+6^2)/0.75) = sqrt(96) ≈ 9.798
        let diameters = [6.0, 6.0];
        let d = bundle_diameter(&diameters, 0.75);
        assert!((d - 9.798).abs() < 0.001, "got {d}");
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
            cable_instance_id: None,
            load_current_a: None,
            protection_current_a: None,
            end_a: cavity_end(1),
            end_b: cavity_end(2),
        });
        data.connector_instances[0].cavities.push(CavityAssignment {
            id: 3,
            cavity_id: "2".into(),
            external_reference: None,
            is_source: false,
        });
        data.connector_instances[1].cavities.push(CavityAssignment {
            id: 4,
            cavity_id: "2".into(),
            external_reference: None,
            is_source: false,
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
    fn a_splice_on_a_segment_splits_its_bundle_in_two() {
        // De X1 a SP1 van W001 y W003; de SP1 a X2, W002, W003 y W004. El termo
        // no pasa por el splice (se hace después): no se suman los dos lados.
        let mut data = splice_40_mm_from_x1();
        data.wire_instances.push(WireInstance {
            id: 4,
            short_id: "W004".into(),
            ..data.wire_instances[1].clone()
        });
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 2.0, None));
        let two = bundle_diameter(&[2.0, 2.0], 0.75);
        let three = bundle_diameter(&[2.0, 2.0, 2.0], 0.75);

        assert!((bundle_diameter_mm(&data, &library, 1) - three).abs() < 1e-9);
        // Al boot de X1 llegan solo los dos de su lado.
        assert!((bundle_diameter_at_node_mm(&data, &library, 1, 1) - two).abs() < 1e-9);
        assert!((bundle_diameter_at_node_mm(&data, &library, 1, 2) - three).abs() < 1e-9);
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
}
