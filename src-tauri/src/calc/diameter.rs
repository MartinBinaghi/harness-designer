//! Diámetro del bundle de cada tramo (plan 5.2) y diámetro final con coberturas.

use super::{coverings_for_segment, twist_group_of_wire, wire_def_of, CoveringFit, PASS};
use crate::model::library::Library;
use crate::model::project::ProjectData;
use crate::topology::wire_route;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
