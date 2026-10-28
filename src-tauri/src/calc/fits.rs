//! Qué termo, boot o molde en T sirve en cada tramo, conector y breakout (plan 9).

use super::{bundle_diameter_mm, segment_final_diameter_mm};
use crate::model::library::{Library, TMoldDef, TMoldLeg};
use crate::model::project::{ConnectorInstance, ProjectData};
use serde::{Deserialize, Serialize};

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
pub(super) fn node_segments_by_diameter(
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

pub(super) fn legs_by_size(t_mold: &TMoldDef) -> Vec<TMoldLeg> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calc::test_fixtures::*;
    use crate::model::library::CoveringDef;
    use crate::model::project::{Node, Segment};

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
}
