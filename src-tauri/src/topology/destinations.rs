//! "Termina en" de cada pin, del otro lado de los splices (plan 4.3).

use super::connection_point;
use super::nets::all_nets;
use super::routes::wire_end_node;
use crate::model::project::{ProjectData, WireEnd, WireInstance};
use serde::Serialize;
use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet, VecDeque};

/// "Termina en" de una vía con cable (plan 4.3): los extremos finales de su net
/// — pines de conector, masas, componentes — y los splices por los que pasa.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PinDestinations {
    pub cavity_assignment_id: i64,
    pub ends: Vec<WireEnd>,
    pub via_splices: Vec<i64>,
}

/// Por qué rama llega un nodo a un splice: `Here` es el nodo del splice; si no,
/// el segmento por el que se sale del splice hacia ese nodo (y, en un splice
/// sobre un segmento, hacia qué punta). Es un árbol: cada nodo, una sola rama.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Here,
    Branch { segment: i64, toward_a: bool },
}

fn splice_sides(data: &ProjectData, splice_id: i64) -> HashMap<i64, Side> {
    let mut sides: HashMap<i64, Side> = HashMap::new();
    let Some(splice) = data.splice_instances.iter().find(|s| s.id == splice_id) else {
        return sides;
    };
    // Desde dónde sale cada rama. En un splice sobre un segmento, ese segmento
    // separa sus dos puntas y no se cruza.
    let starts: Vec<(i64, Side)> = if let Some(at) = splice.node_id {
        sides.insert(at, Side::Here);
        data.segments
            .iter()
            .filter_map(|seg| {
                let side = Side::Branch {
                    segment: seg.id,
                    toward_a: false,
                };
                if seg.node_a_id == at {
                    Some((seg.node_b_id, side))
                } else if seg.node_b_id == at {
                    Some((seg.node_a_id, side))
                } else {
                    None
                }
            })
            .collect()
    } else if let Some(seg) = data
        .segments
        .iter()
        .find(|s| Some(s.id) == splice.segment_id)
    {
        vec![
            (
                seg.node_a_id,
                Side::Branch {
                    segment: seg.id,
                    toward_a: true,
                },
            ),
            (
                seg.node_b_id,
                Side::Branch {
                    segment: seg.id,
                    toward_a: false,
                },
            ),
        ]
    } else {
        Vec::new()
    };
    let blocked = splice.segment_id;
    for (start, side) in starts {
        if sides.contains_key(&start) {
            continue;
        }
        sides.insert(start, side);
        let mut queue = VecDeque::from([start]);
        while let Some(node) = queue.pop_front() {
            for seg in &data.segments {
                if Some(seg.id) == blocked || (seg.node_a_id != node && seg.node_b_id != node) {
                    continue;
                }
                let next = if seg.node_a_id == node {
                    seg.node_b_id
                } else {
                    seg.node_a_id
                };
                if let Entry::Vacant(e) = sides.entry(next) {
                    e.insert(side);
                    queue.push_back(next);
                }
            }
        }
    }
    sides
}

/// "Termina en" de cada vía con cable. Del otro lado de un splice solo cuenta lo
/// que está del otro lado (Martin): se ocultan los extremos que llegan al splice
/// por la misma rama que la vía consultada (desde una bobina no se ven las otras
/// bobinas, sí los pines del conector de motor; desde el motor, todas las
/// bobinas). Lo que está en el nodo del splice no comparte rama con nada. Si así
/// no quedara ningún destino, se muestran todos. No sigue por las masas.
pub fn pin_destinations(data: &ProjectData) -> Vec<PinDestinations> {
    let nets = all_nets(data);
    let mut sides: HashMap<i64, HashMap<i64, Side>> = HashMap::new();
    let mut out = Vec::new();
    for connector in &data.connector_instances {
        for cavity in &connector.cavities {
            let is_here =
                |e: &WireEnd| e.kind == "cavity" && e.cavity_assignment_id == Some(cavity.id);
            let here: Vec<&WireInstance> = data
                .wire_instances
                .iter()
                .filter(|w| is_here(&w.end_a) || is_here(&w.end_b))
                .collect();
            if here.is_empty() {
                continue;
            }
            let members: HashSet<i64> = here
                .iter()
                .flat_map(|w| nets[&w.id].iter().copied())
                .collect();
            let my_splices: Vec<i64> = here
                .iter()
                .flat_map(|w| [&w.end_a, &w.end_b])
                .filter(|e| e.kind == "splice")
                .filter_map(|e| e.splice_id)
                .collect();
            for &s in &my_splices {
                sides.entry(s).or_insert_with(|| splice_sides(data, s));
            }
            let same_side = |end: &WireEnd| {
                let Some(node) = wire_end_node(data, end) else {
                    return false;
                };
                !my_splices.is_empty()
                    && my_splices
                        .iter()
                        .all(|s| match sides[s].get(&connector.node_id) {
                            Some(&mine @ Side::Branch { .. }) => sides[s].get(&node) == Some(&mine),
                            _ => false,
                        })
            };
            let mut ends: Vec<WireEnd> = Vec::new();
            let mut hidden: Vec<WireEnd> = Vec::new();
            let mut via: Vec<i64> = Vec::new();
            for wire in data
                .wire_instances
                .iter()
                .filter(|w| members.contains(&w.id))
            {
                for end in [&wire.end_a, &wire.end_b] {
                    if is_here(end) || connection_point(end).is_none() {
                        continue;
                    }
                    if let Some(splice) = end.splice_id.filter(|_| end.kind == "splice") {
                        if !via.contains(&splice) {
                            via.push(splice);
                        }
                        continue;
                    }
                    let list = if same_side(end) {
                        &mut hidden
                    } else {
                        &mut ends
                    };
                    if !list.contains(end) {
                        list.push(end.clone());
                    }
                }
            }
            if ends.is_empty() {
                ends = hidden;
            }
            out.push(PinDestinations {
                cavity_assignment_id: cavity.id,
                ends,
                via_splices: via,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::project::{CavityAssignment, ProjectData};
    use crate::topology::net_of_wire;
    use crate::topology::test_fixtures::*;

    fn destinations_of(data: &ProjectData, cavity_id: i64) -> (Vec<WireEnd>, Vec<i64>) {
        let d = pin_destinations(data)
            .into_iter()
            .find(|d| d.cavity_assignment_id == cavity_id)
            .unwrap();
        (d.ends, d.via_splices)
    }

    #[test]
    fn a_ground_lug_ends_the_net() {
        // Dos pines al mismo ojal G1: cada uno termina en G1, no en el otro.
        let mut data = topology_with_connectors_and_a_splice();
        let g1 = wire_end("ground", None, None, Some(1), None);
        data.wire_instances = vec![
            wire(1, cavity(100), g1.clone()),
            wire(2, cavity(101), g1.clone()),
        ];
        assert_eq!(net_of_wire(&data, 1), vec![1]);
        assert_eq!(destinations_of(&data, 100), (vec![g1], vec![]));
    }

    #[test]
    fn ends_at_shows_only_the_other_side_of_a_splice() {
        // SP1 en el breakout (nodo 2): X1 llega por S1, X9 por S2 y X4 por S3.
        // X9 lleva dos vías al splice (101 y 103), por la misma rama.
        let mut data = topology_with_connectors_and_a_splice();
        data.connector_instances[1].cavities.push(CavityAssignment {
            id: 103,
            cavity_id: "48".into(),
            external_reference: None,
        });
        let sp1 = wire_end("splice", None, Some(1), None, None);
        data.wire_instances = vec![
            wire(1, cavity(100), sp1.clone()),
            wire(2, sp1.clone(), cavity(101)),
            wire(3, sp1.clone(), cavity(103)),
            wire(4, sp1.clone(), cavity(102)),
        ];
        // Desde X9:47 no se ve X9:48 (misma rama); sí X1 y X4.
        assert_eq!(
            destinations_of(&data, 101),
            (vec![cavity(100), cavity(102)], vec![1])
        );
        // Desde X1 se ven todas.
        assert_eq!(
            destinations_of(&data, 100),
            (vec![cavity(101), cavity(103), cavity(102)], vec![1])
        );
    }

    #[test]
    fn ends_at_shows_everything_when_all_ends_are_on_the_same_side() {
        // Splice sobre el segmento 2 (nodo 2 — nodo 3): X1 (nodo 1) y X4 (nodo 4)
        // llegan los dos por la punta del nodo 2. Desde X1, X4 estaría oculto
        // (misma rama), pero no queda otro destino: se muestra igual.
        let mut data = topology_with_connectors_and_a_splice();
        data.splice_instances[0].node_id = None;
        data.splice_instances[0].segment_id = Some(2);
        data.splice_instances[0].offset_from_end_mm = Some(10.0);
        data.splice_instances[0].offset_from_node_id = Some(2);
        let sp1 = wire_end("splice", None, Some(1), None, None);
        data.wire_instances = vec![
            wire(1, cavity(100), sp1.clone()),
            wire(2, sp1.clone(), cavity(102)),
        ];
        assert_eq!(destinations_of(&data, 100), (vec![cavity(102)], vec![1]));
    }
}
