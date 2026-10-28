//! Referencias colgadas: algo que apunta a un elemento borrado (no se puede guardar).

use super::ProjectData;

/// Qué elemento tiene una referencia colgada (para que Checks lleve a él).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DanglingItem {
    Segment(i64),
    Connector(i64),
    Ground(i64),
    Splice(i64),
    Component(i64),
    Wire(i64),
    TwistGroup(i64),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Dangling {
    pub message: String,
    pub item: DanglingItem,
}

/// Referencias a algo que ya no está en el proyecto (un conector en un nodo
/// borrado, un cable de un trenzado que ya no existe…). El archivo no las
/// acepta (claves foráneas): se muestran en Checks y al guardar, con nombre.
pub fn dangling_references(data: &ProjectData) -> Vec<Dangling> {
    use std::collections::HashSet;
    let nodes: HashSet<i64> = data.nodes.iter().map(|n| n.id).collect();
    let segments: HashSet<i64> = data.segments.iter().map(|s| s.id).collect();
    let cavities: HashSet<i64> = data
        .connector_instances
        .iter()
        .flat_map(|c| c.cavities.iter().map(|cav| cav.id))
        .collect();
    let splices: HashSet<i64> = data.splice_instances.iter().map(|s| s.id).collect();
    let grounds: HashSet<i64> = data.ground_points.iter().map(|g| g.id).collect();
    let components: HashSet<i64> = data.component_instances.iter().map(|c| c.id).collect();
    let wires: HashSet<i64> = data.wire_instances.iter().map(|w| w.id).collect();
    let missing = |set: &HashSet<i64>, id: Option<i64>| id.is_some_and(|id| !set.contains(&id));

    let mut out = Vec::new();
    let mut push = |message: String, item: DanglingItem| out.push(Dangling { message, item });
    for s in &data.segments {
        if !nodes.contains(&s.node_a_id) || !nodes.contains(&s.node_b_id) {
            push(
                format!("Segment S{} goes to a node that no longer exists", s.id),
                DanglingItem::Segment(s.id),
            );
        }
    }
    for c in &data.connector_instances {
        if !nodes.contains(&c.node_id) {
            push(
                format!(
                    "{} is on node {}, which no longer exists",
                    c.short_id, c.node_id
                ),
                DanglingItem::Connector(c.id),
            );
        }
    }
    for g in &data.ground_points {
        if !nodes.contains(&g.node_id) {
            push(
                format!(
                    "{} is on node {}, which no longer exists",
                    g.short_id, g.node_id
                ),
                DanglingItem::Ground(g.id),
            );
        }
    }
    let placed = data
        .splice_instances
        .iter()
        .map(|s| {
            (
                &s.short_id,
                s.node_id,
                s.segment_id,
                s.offset_from_node_id,
                DanglingItem::Splice(s.id),
            )
        })
        .chain(data.component_instances.iter().map(|c| {
            (
                &c.short_id,
                c.node_id,
                c.segment_id,
                c.offset_from_node_id,
                DanglingItem::Component(c.id),
            )
        }));
    for (short_id, node_id, segment_id, offset_node, item) in placed {
        if missing(&nodes, node_id)
            || missing(&nodes, offset_node)
            || missing(&segments, segment_id)
        {
            push(
                format!("{short_id} is placed on a node or segment that no longer exists"),
                item,
            );
        }
    }
    for w in &data.wire_instances {
        let broken = [&w.end_a, &w.end_b].iter().any(|end| {
            missing(&cavities, end.cavity_assignment_id)
                || missing(&splices, end.splice_id)
                || missing(&grounds, end.ground_point_id)
                || missing(&components, end.component_instance_id)
        });
        if broken {
            push(
                format!("{} ends at something that no longer exists", w.short_id),
                DanglingItem::Wire(w.id),
            );
        }
    }
    for g in &data.twist_groups {
        if g.wire_instance_ids.iter().any(|id| !wires.contains(id)) {
            push(
                format!("Twist group {} lists a wire that no longer exists", g.name),
                DanglingItem::TwistGroup(g.id),
            );
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::project::test_fixtures::*;

    #[test]
    fn dangling_references_name_what_points_to_a_deleted_item() {
        let mut data = sample();
        assert!(dangling_references(&data).is_empty());
        let node = data.connector_instances[0].node_id;
        data.nodes.retain(|n| n.id != node);
        data.segments
            .retain(|s| s.node_a_id != node && s.node_b_id != node);
        let found = dangling_references(&data);
        assert!(
            found
                .iter()
                .any(|d| d.item == DanglingItem::Connector(data.connector_instances[0].id)),
            "{found:?}"
        );
    }
}
