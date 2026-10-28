//! Largo de corte de cada cable: recorrido, trenzado, margen y redondeo (plan 5.1).

use super::{bundle_diameter_mm, wire_def_of, wires_in_segment};
use crate::model::library::Library;
use crate::model::project::{Project, ProjectData};
use crate::topology::wire_route;
use serde::{Deserialize, Serialize};

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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::calc::test_fixtures::*;

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
    fn a_wire_alone_in_its_segments_is_not_twisted() {
        let data = one_segment_project(500.0, None);
        let mut library = Library::default();
        library.wire_defs.push(wire_def(100, 0.81, None));
        let cut = wire_cut_length(&data, &library, 1).unwrap();
        assert_eq!(cut.length_with_twist_mm, 500.0);
        assert_eq!(cut.twist_min_margin_pct, 0.0);
    }

    #[test]
    fn cut_length_rounds_up_to_the_project_step() {
        assert_eq!(round_up(1234.5, Some(10.0)), 1240.0);
        assert_eq!(round_up(1240.0, Some(10.0)), 1240.0);
        assert_eq!(round_up(1201.0, Some(50.0)), 1250.0);
        assert_eq!(round_up(1234.5, None), 1234.5);
    }
}
