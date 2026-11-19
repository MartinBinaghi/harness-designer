//! Chequeos de splices: cantidad de cables y calibre combinado (plan 12).

use super::{error, warning, Finding, FindingTarget};
use crate::model::library::Library;
use crate::model::project::ProjectData;
use std::collections::HashMap;

pub(super) fn check_splices_within_capacity(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let mut counts: HashMap<i64, i64> = HashMap::new();
    for wire in &data.wire_instances {
        if let Some(id) = wire.end_a.splice_id {
            *counts.entry(id).or_default() += 1;
        }
        if let Some(id) = wire.end_b.splice_id {
            *counts.entry(id).or_default() += 1;
        }
    }
    let mut findings = Vec::new();
    for splice in &data.splice_instances {
        let Some(def) = library
            .splice_defs
            .iter()
            .find(|d| d.part_id == splice.library_part_id)
        else {
            continue;
        };
        let count = counts.get(&splice.id).copied().unwrap_or(0);
        if count > def.max_wires {
            findings.push(
                error(format!(
                    "Splice {} has {count} wires, more than its part allows ({})",
                    splice.short_id, def.max_wires
                ))
                .at(FindingTarget::Splice { id: splice.id }),
            );
        }
    }
    findings
}

/// Calibre total fuera del rango del splice (plan sección 12: "splice con...
/// calibre fuera de lo que admite su SpliceDef"), mismo patrón que el chequeo
/// de calibre vs. contacto: suma la sección de todos los cables que llegan al
/// splice y la compara contra su rango.
pub(super) fn check_gauge_within_splice_range(
    data: &ProjectData,
    library: &Library,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    for splice in &data.splice_instances {
        let Some(def) = library
            .splice_defs
            .iter()
            .find(|d| d.part_id == splice.library_part_id)
        else {
            continue;
        };
        let Some((range_min, range_max)) =
            crate::contacts::gauge_range_mm2(def.gauge_min.as_deref(), def.gauge_max.as_deref())
        else {
            continue;
        };

        let wires: Vec<&crate::model::project::WireInstance> = data
            .wire_instances
            .iter()
            .filter(|w| {
                w.end_a.splice_id == Some(splice.id) || w.end_b.splice_id == Some(splice.id)
            })
            .collect();
        if wires.is_empty() {
            continue;
        }
        let Some(total_mm2) = wires
            .iter()
            .map(|w| {
                library
                    .wire_defs
                    .iter()
                    .find(|wd| wd.part_id == w.library_part_id)
                    .and_then(|wd| crate::gauge::gauge_to_mm2(&wd.gauge))
            })
            .sum::<Option<f64>>()
        else {
            continue; // algún calibre involucrado no se pudo interpretar
        };

        if total_mm2 < range_min || total_mm2 > range_max {
            findings.push(
                error(format!(
                    "Splice {}'s wire gauge ({total_mm2:.2}mm² total) is outside its part's range",
                    splice.short_id
                ))
                .at(FindingTarget::Splice { id: splice.id }),
            );
        }
    }
    findings
}

/// Splices y componentes sobre un segmento con una ubicación que no cierra: a
/// más distancia que el largo del tramo (o negativa), que el largo de corte
/// toma en la punta, o sin el nodo desde el que se mide o medida desde uno que
/// no es punta del tramo, que dejan sus cables sin recorrido.
pub(super) fn check_placement_on_segment(data: &ProjectData) -> Vec<Finding> {
    let placed = data
        .splice_instances
        .iter()
        .map(|s| {
            (
                format!("Splice {}", s.short_id),
                Some(FindingTarget::Splice { id: s.id }),
                s.node_id,
                s.segment_id,
                s.offset_from_end_mm,
                s.offset_from_node_id,
            )
        })
        .chain(data.component_instances.iter().map(|c| {
            (
                format!("Component {}", c.short_id),
                None,
                c.node_id,
                c.segment_id,
                c.offset_from_end_mm,
                c.offset_from_node_id,
            )
        }));
    let mut findings = Vec::new();
    for (who, target, node, segment_id, offset, from) in placed {
        let Some(segment) = data
            .segments
            .iter()
            .find(|s| node.is_none() && Some(s.id) == segment_id)
        else {
            continue;
        };
        let offset = offset.unwrap_or(0.0);
        let finding = match from {
            None => warning(format!(
                "{who} is on S{} but has no node it's measured from: its wires have no route",
                segment.id
            )),
            Some(from) if from != segment.node_a_id && from != segment.node_b_id => {
                warning(format!(
                    "{who} is measured from node {from}, which isn't an end of S{}: its wires have no route",
                    segment.id
                ))
            }
            Some(from) if offset < 0.0 || offset > segment.length_mm => warning(format!(
                "{who} is {offset} mm from node {from} on S{}, which is {} mm long: its wires are cut as if it were at the end",
                segment.id, segment.length_mm
            )),
            Some(_) => continue,
        };
        findings.push(match target {
            Some(t) => finding.at(t),
            None => finding,
        });
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checks::test_fixtures::*;
    use crate::model::library::{Library, Part, SpliceDef};
    use crate::model::project::{ProjectData, SpliceInstance, WireInstance};

    #[test]
    fn flags_a_splice_placed_beyond_its_segment() {
        let mut data = segment_with_one_wire(); // S1 de 500 mm, nodos 1 y 2
        data.splice_instances = vec![SpliceInstance {
            id: 1,
            short_id: "SP1".into(),
            name: String::new(),
            library_part_id: 1,
            node_id: None,
            segment_id: Some(1),
            offset_from_end_mm: Some(40.0),
            offset_from_node_id: Some(1),
        }];
        assert!(check_placement_on_segment(&data).is_empty());
        data.splice_instances[0].offset_from_end_mm = Some(600.0);
        let findings = check_placement_on_segment(&data);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("600 mm from node 1 on S1"));
        data.splice_instances[0].offset_from_end_mm = Some(40.0);
        data.splice_instances[0].offset_from_node_id = Some(7);
        assert!(check_placement_on_segment(&data)[0]
            .message
            .contains("isn't an end of S1"));
        data.splice_instances[0].offset_from_node_id = None;
        let findings = check_placement_on_segment(&data);
        assert!(findings[0]
            .message
            .contains("has no node it's measured from"));
        assert_eq!(findings[0].target, Some(FindingTarget::Splice { id: 1 }));
    }

    #[test]
    fn flags_a_splice_over_its_wire_capacity() {
        let mut data = empty_project();
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
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                cable_instance_id: None,
                load_current_a: None,
                protection_current_a: None,
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("splice", None, Some(1), None, None),
            })
            .collect();

        let mut library = empty_library();
        library.parts = vec![Part {
            id: 1,
            part_number: "SPLICE-2".into(),
            manufacturer: None,
            description: None,
            category: "splice".into(),
            purchase_unit: "unit".into(),
            qty_per_pack: 1.0,
            price_usd: None,
            price_date: None,
        }];
        library.splice_defs = vec![SpliceDef {
            part_id: 1,
            gauge_min: None,
            gauge_max: None,
            max_wires: 2,
        }];

        let findings = check_splices_within_capacity(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("more than its part allows"));
    }

    /// Un splice con 3 cables de 22 AWG (≈0.326mm² cada uno, ≈0.98mm² total) y
    /// su biblioteca de cables (`WireDef` 100, reusa `library_with_wire_def`).
    fn splice_with_three_22awg_wires() -> (ProjectData, Library) {
        let mut data = empty_project();
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
                cable_instance_id: None,
                load_current_a: None,
                protection_current_a: None,
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("splice", None, Some(1), None, None),
            })
            .collect();
        let mut library = library_with_wire_def(6.0);
        library.parts = vec![Part {
            id: 1,
            part_number: "SPLICE-1".into(),
            manufacturer: None,
            description: None,
            category: "splice".into(),
            purchase_unit: "unit".into(),
            qty_per_pack: 1.0,
            price_usd: None,
            price_date: None,
        }];
        (data, library)
    }

    #[test]
    fn no_gauge_finding_when_the_splice_fits_the_combined_wire_gauge() {
        let (data, mut library) = splice_with_three_22awg_wires();
        library.splice_defs = vec![SpliceDef {
            part_id: 1,
            gauge_min: Some("20 AWG".into()),
            gauge_max: Some("16 AWG".into()),
            max_wires: 5,
        }];
        assert!(check_gauge_within_splice_range(&data, &library).is_empty());
    }

    #[test]
    fn flags_a_splice_gauge_outside_its_combined_wire_range() {
        let (data, mut library) = splice_with_three_22awg_wires();
        // Rango pensado para calibres mucho más finos que la suma real (~0.98mm²).
        library.splice_defs = vec![SpliceDef {
            part_id: 1,
            gauge_min: Some("24 AWG".into()),
            gauge_max: Some("22 AWG".into()),
            max_wires: 5,
        }];
        let findings = check_gauge_within_splice_range(&data, &library);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, "error");
        assert!(findings[0].message.contains("SP1"));
    }
}
