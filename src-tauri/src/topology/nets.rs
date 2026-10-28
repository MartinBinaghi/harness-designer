//! Nets: qué cables quedan unidos por splices, cavidades compartidas y componentes (plan 4.3).

use super::{connection_point, ConnectionPoint};
use crate::model::project::{ProjectData, WireEnd};
use std::collections::{HashMap, HashSet, VecDeque};

/// Un punto por el que la net sigue: vía, splice o componente. Una masa no: es
/// donde termina el cable (un pin que va a G1 termina en G1, no en todo lo
/// atornillado al mismo ojal — decisión de Martin, plan 4.3).
fn joining_point(end: &WireEnd) -> Option<ConnectionPoint> {
    connection_point(end).filter(|p| !matches!(p, ConnectionPoint::Ground(_)))
}

/// Todas las nets del proyecto en una pasada: para cada cable, los ids
/// (ordenados) de los cables unidos a él transitivamente por compartir vía,
/// splice o componente (cable → splice → cable…). No siguen por las masas (ver
/// `joining_point`) y se cortan solas en conectores de interconexión y
/// referencias externas, porque de ese lado no hay más cables en este archivo.
pub fn all_nets(data: &ProjectData) -> HashMap<i64, std::rc::Rc<Vec<i64>>> {
    let mut wires_by_point: HashMap<ConnectionPoint, Vec<i64>> = HashMap::new();
    let mut points_by_wire: HashMap<i64, Vec<ConnectionPoint>> = HashMap::new();
    for wire in &data.wire_instances {
        let points: Vec<ConnectionPoint> = [joining_point(&wire.end_a), joining_point(&wire.end_b)]
            .into_iter()
            .flatten()
            .collect();
        for &point in &points {
            wires_by_point.entry(point).or_default().push(wire.id);
        }
        points_by_wire.insert(wire.id, points);
    }
    let mut nets: HashMap<i64, std::rc::Rc<Vec<i64>>> = HashMap::new();
    for wire in &data.wire_instances {
        if nets.contains_key(&wire.id) {
            continue;
        }
        let mut members: HashSet<i64> = HashSet::from([wire.id]);
        let mut queue = VecDeque::from([wire.id]);
        while let Some(current) = queue.pop_front() {
            for point in &points_by_wire[&current] {
                for &neighbor in &wires_by_point[point] {
                    if members.insert(neighbor) {
                        queue.push_back(neighbor);
                    }
                }
            }
        }
        let mut sorted: Vec<i64> = members.into_iter().collect();
        sorted.sort_unstable();
        let net = std::rc::Rc::new(sorted);
        for &id in net.iter() {
            nets.insert(id, net.clone());
        }
    }
    nets
}

/// La net de un cable (ver `all_nets`), incluido él mismo; ids ordenados.
pub fn net_of_wire(data: &ProjectData, wire_id: i64) -> Vec<i64> {
    all_nets(data)
        .get(&wire_id)
        .map_or_else(|| vec![wire_id], |net| net.as_ref().clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::project::WireInstance;
    use crate::topology::test_fixtures::*;

    #[test]
    fn net_of_wire_follows_splices_and_stays_separate_from_unrelated_wires() {
        let mut data = topology_with_connectors_and_a_splice();
        data.wire_instances = vec![
            // W1: X1 (cavidad 100) -- SP1
            WireInstance {
                id: 1,
                short_id: "W001".into(),
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: wire_end("cavity", Some(100), None, None, None),
                end_b: wire_end("splice", None, Some(1), None, None),
            },
            // W2: SP1 -- X9 (cavidad 101)
            WireInstance {
                id: 2,
                short_id: "W002".into(),
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: wire_end("splice", None, Some(1), None, None),
                end_b: wire_end("cavity", Some(101), None, None, None),
            },
            // W3: SP1 -- masa G1
            WireInstance {
                id: 3,
                short_id: "W003".into(),
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: wire_end("splice", None, Some(1), None, None),
                end_b: wire_end("ground", None, None, Some(1), None),
            },
            // W4: cable suelto sin relación con SP1 (X4 cavidad 102 -- masa G1... distinta masa a propósito)
            WireInstance {
                id: 4,
                short_id: "W004".into(),
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: wire_end("cavity", Some(102), None, None, None),
                end_b: wire_end("cavity", Some(102), None, None, None),
            },
        ];

        assert_eq!(net_of_wire(&data, 1), vec![1, 2, 3]);
        assert_eq!(net_of_wire(&data, 2), vec![1, 2, 3]);
        assert_eq!(net_of_wire(&data, 4), vec![4]);
    }

    #[test]
    fn net_of_wire_joins_through_a_shared_component() {
        let mut data = topology_with_connectors_and_a_splice();
        data.component_instances = vec![crate::model::project::ComponentInstance {
            id: 1,
            short_id: "R1".into(),
            name: "Terminación CAN".into(),
            library_part_id: 5,
            node_id: Some(3),
            segment_id: None,
            offset_from_end_mm: None,
            offset_from_node_id: None,
        }];
        data.wire_instances = vec![
            WireInstance {
                id: 1,
                short_id: "W001".into(),
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: wire_end("cavity", Some(100), None, None, None),
                end_b: wire_end("component", None, None, None, Some(1)),
            },
            WireInstance {
                id: 2,
                short_id: "W002".into(),
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: wire_end("component", None, None, None, Some(1)),
                end_b: wire_end("cavity", Some(101), None, None, None),
            },
        ];

        assert_eq!(net_of_wire(&data, 1), vec![1, 2]);
    }
}
