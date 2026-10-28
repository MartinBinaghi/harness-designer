//! Chequeo de lazos en la topología: el arnés tiene que ser un árbol (plan 13).

use super::{error, Finding, FindingTarget};
use crate::model::project::ProjectData;
use std::collections::HashMap;

/// Une componentes conectados; si dos nodos ya están unidos antes de agregar
/// un segmento, ese segmento cierra un lazo.
struct DisjointSet {
    parent: Vec<usize>,
}

impl DisjointSet {
    fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
        }
    }
    fn find(&mut self, x: usize) -> usize {
        if self.parent[x] != x {
            self.parent[x] = self.find(self.parent[x]);
        }
        self.parent[x]
    }
    /// Devuelve `false` si `a` y `b` ya estaban en el mismo componente (lazo).
    fn union(&mut self, a: usize, b: usize) -> bool {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra == rb {
            return false;
        }
        self.parent[ra] = rb;
        true
    }
}

pub(super) fn check_topology_has_no_loops(data: &ProjectData) -> Vec<Finding> {
    let index: HashMap<i64, usize> = data
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id, i))
        .collect();
    let mut dsu = DisjointSet::new(data.nodes.len());
    let mut findings = Vec::new();
    for seg in &data.segments {
        let (Some(&a), Some(&b)) = (index.get(&seg.node_a_id), index.get(&seg.node_b_id)) else {
            continue;
        };
        if !dsu.union(a, b) {
            findings.push(error(format!(
                "Segment S{} closes a loop in the topology (node {} and node {} were already connected)",
                seg.id, seg.node_a_id, seg.node_b_id
            )).at(FindingTarget::Segment { id: seg.id }));
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::checks::test_fixtures::*;
    use crate::model::project::{Node, Segment};

    #[test]
    fn flags_a_loop_in_the_topology() {
        let mut data = empty_project();
        data.nodes = vec![
            Node {
                id: 1,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
            Node {
                id: 2,
                kind: "breakout".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
            Node {
                id: 3,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
        ];
        data.segments = vec![
            Segment {
                id: 1,
                node_a_id: 1,
                node_b_id: 2,
                length_mm: 100.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            },
            Segment {
                id: 2,
                node_a_id: 2,
                node_b_id: 3,
                length_mm: 100.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            },
            Segment {
                id: 3,
                node_a_id: 3,
                node_b_id: 1,
                length_mm: 100.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            }, // closes the loop
        ];
        let findings = check_topology_has_no_loops(&data);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, "error");
    }

    #[test]
    fn a_tree_has_no_loop_findings() {
        let mut data = empty_project();
        data.nodes = vec![
            Node {
                id: 1,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
            Node {
                id: 2,
                kind: "breakout".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
            Node {
                id: 3,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
                adhesive_heatshrink_length_mm: None,
            },
        ];
        data.segments = vec![
            Segment {
                id: 1,
                node_a_id: 1,
                node_b_id: 2,
                length_mm: 100.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            },
            Segment {
                id: 2,
                node_a_id: 2,
                node_b_id: 3,
                length_mm: 100.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            },
        ];
        assert!(check_topology_has_no_loops(&data).is_empty());
    }
}
