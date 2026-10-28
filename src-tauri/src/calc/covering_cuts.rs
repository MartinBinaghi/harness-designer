//! Lista de corte de coberturas: un tramo de termo por segmento (plan 8.1).

use super::fits::{legs_by_size, node_segments_by_diameter};
use super::{bundle_diameter_mm, coverings_for_segment};
use crate::model::library::Library;
use crate::model::project::ProjectData;
use serde::{Deserialize, Serialize};

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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::calc::test_fixtures::*;

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
}
