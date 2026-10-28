//! Recorrido de cada cable por el árbol y distancias entre nodos (plan 4.3 y 11).

use crate::model::project::{ProjectData, Segment, WireEnd};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};

thread_local! {
    /// Recorridos ya calculados mientras dura una pasada de cálculo (ver
    /// `with_route_cache`): el proyecto no cambia en el medio, y sin esto cada
    /// largo y cada diámetro rehace el recorrido de todos los cables.
    static ROUTES: RefCell<Option<HashMap<i64, Option<Vec<i64>>>>> = const { RefCell::new(None) };
}

/// Corre `f` recordando los recorridos de cables que calcule. Solo para
/// cálculos sobre un mismo proyecto que no cambia mientras corren.
pub fn with_route_cache<T>(f: impl FnOnce() -> T) -> T {
    ROUTES.with(|c| *c.borrow_mut() = Some(HashMap::new()));
    let out = f();
    ROUTES.with(|c| *c.borrow_mut() = None);
    out
}

/// Camino de segmentos entre dos nodos del árbol, en orden de `from` a `to`.
/// `Some(vec![])` si `from == to`. `None` si no hay camino (nodos en ramas
/// desconectadas, o alguno inexistente).
pub fn path_between_nodes(data: &ProjectData, from: i64, to: i64) -> Option<Vec<i64>> {
    if from == to {
        return Some(Vec::new());
    }

    let adjacency = adjacency(data);

    let mut visited: HashSet<i64> = HashSet::from([from]);
    let mut queue: VecDeque<i64> = VecDeque::from([from]);
    let mut came_from: HashMap<i64, (i64, i64)> = HashMap::new();

    while let Some(current) = queue.pop_front() {
        if current == to {
            let mut segments = Vec::new();
            let mut node = to;
            while let Some(&(prev, segment_id)) = came_from.get(&node) {
                segments.push(segment_id);
                node = prev;
            }
            segments.reverse();
            return Some(segments);
        }
        for &(neighbor, segment) in adjacency.get(&current).into_iter().flatten() {
            if visited.insert(neighbor) {
                came_from.insert(neighbor, (current, segment.id));
                queue.push_back(neighbor);
            }
        }
    }

    None
}

/// Vecinos de cada nodo, con el segmento que los une.
fn adjacency(data: &ProjectData) -> HashMap<i64, Vec<(i64, &Segment)>> {
    let mut adjacency: HashMap<i64, Vec<(i64, &Segment)>> = HashMap::new();
    for segment in &data.segments {
        adjacency
            .entry(segment.node_a_id)
            .or_default()
            .push((segment.node_b_id, segment));
        adjacency
            .entry(segment.node_b_id)
            .or_default()
            .push((segment.node_a_id, segment));
    }
    adjacency
}

/// Distancia acumulada (suma de largos de segmento, en mm) desde `from` hasta
/// cada nodo alcanzable — para marcar en la mesa de armado desde un único punto
/// de referencia (plan 10.2). Los nodos en ramas desconectadas no aparecen.
pub fn distances_from_node(data: &ProjectData, from: i64) -> HashMap<i64, f64> {
    let adjacency = adjacency(data);
    let mut distances = HashMap::from([(from, 0.0)]);
    let mut queue = VecDeque::from([from]);
    while let Some(current) = queue.pop_front() {
        let here = distances[&current];
        for &(neighbor, segment) in adjacency.get(&current).into_iter().flatten() {
            if let std::collections::hash_map::Entry::Vacant(e) = distances.entry(neighbor) {
                e.insert(here + segment.length_mm);
                queue.push_back(neighbor);
            }
        }
    }
    distances
}

/// Resuelve un extremo de cable al nodo donde está físicamente ubicado.
/// Un splice o componente sobre un segmento (no en un nodo) se aproxima a su
/// nodo de referencia: alcanza para saber por qué segmentos pasa un cable,
/// no para el largo exacto de cada tramo (eso es la etapa 3, que corta el
/// segmento en el punto real).
pub(super) fn wire_end_node(data: &ProjectData, end: &WireEnd) -> Option<i64> {
    match end.kind.as_str() {
        "cavity" => {
            let cavity_id = end.cavity_assignment_id?;
            data.connector_instances
                .iter()
                .find(|c| c.cavities.iter().any(|cav| cav.id == cavity_id))
                .map(|c| c.node_id)
        }
        "ground" => {
            let ground_id = end.ground_point_id?;
            data.ground_points
                .iter()
                .find(|g| g.id == ground_id)
                .map(|g| g.node_id)
        }
        "splice" => {
            let splice_id = end.splice_id?;
            let splice = data.splice_instances.iter().find(|s| s.id == splice_id)?;
            splice.node_id.or(splice.offset_from_node_id)
        }
        "component" => {
            let component_id = end.component_instance_id?;
            let component = data
                .component_instances
                .iter()
                .find(|c| c.id == component_id)?;
            component.node_id.or(component.offset_from_node_id)
        }
        _ => None,
    }
}

/// Recorrido físico (ids de segmentos, en orden) de un cable. `None` si el
/// cable no existe, si alguno de sus extremos no resuelve a un nodo (ej. un
/// splice o componente sin ubicación cargada) o si sus dos extremos no están
/// en el mismo árbol.
pub fn wire_route(data: &ProjectData, wire_id: i64) -> Option<Vec<i64>> {
    if let Some(hit) = ROUTES.with(|c| c.borrow().as_ref().and_then(|m| m.get(&wire_id).cloned())) {
        return hit;
    }
    let route = compute_wire_route(data, wire_id);
    ROUTES.with(|c| {
        if let Some(m) = c.borrow_mut().as_mut() {
            m.insert(wire_id, route.clone());
        }
    });
    route
}

fn compute_wire_route(data: &ProjectData, wire_id: i64) -> Option<Vec<i64>> {
    let wire = data.wire_instances.iter().find(|w| w.id == wire_id)?;
    let node_a = wire_end_node(data, &wire.end_a)?;
    let node_b = wire_end_node(data, &wire.end_b)?;
    path_between_nodes(data, node_a, node_b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::project::WireInstance;
    use crate::topology::test_fixtures::*;

    #[test]
    fn finds_the_unique_path_in_a_y_shaped_tree() {
        let data = y_shaped_topology();
        assert_eq!(path_between_nodes(&data, 1, 3), Some(vec![1, 2]));
        assert_eq!(path_between_nodes(&data, 1, 4), Some(vec![1, 3]));
        assert_eq!(path_between_nodes(&data, 3, 4), Some(vec![2, 3]));
        assert_eq!(path_between_nodes(&data, 1, 1), Some(vec![]));
    }

    #[test]
    fn accumulates_distances_from_a_reference_node() {
        let data = y_shaped_topology();
        let from_1 = distances_from_node(&data, 1);
        assert_eq!(from_1.get(&1), Some(&0.0));
        assert_eq!(from_1.get(&2), Some(&100.0));
        assert_eq!(from_1.get(&3), Some(&300.0));
        assert_eq!(from_1.get(&4), Some(&150.0));
        // Desde una hoja, el camino a la otra hoja pasa por el breakout.
        assert_eq!(distances_from_node(&data, 3).get(&4), Some(&250.0));
    }

    #[test]
    fn returns_none_for_disconnected_or_unknown_nodes() {
        let data = y_shaped_topology();
        assert_eq!(path_between_nodes(&data, 1, 99), None);
    }

    #[test]
    fn wire_route_follows_the_tree_path_between_its_two_cavities() {
        let mut data = topology_with_connectors_and_a_splice();
        data.wire_instances = vec![WireInstance {
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
            end_b: wire_end("cavity", Some(101), None, None, None),
        }];

        assert_eq!(wire_route(&data, 1), Some(vec![1, 2]));
    }

    #[test]
    fn wire_route_follows_the_path_to_a_component_on_a_node() {
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
        data.wire_instances = vec![WireInstance {
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
        }];

        assert_eq!(wire_route(&data, 1), Some(vec![1, 2]));
    }

    #[test]
    fn wire_route_is_none_when_a_component_has_no_location_loaded() {
        let mut data = topology_with_connectors_and_a_splice();
        data.component_instances = vec![crate::model::project::ComponentInstance {
            id: 1,
            short_id: "R1".into(),
            name: "Terminación CAN".into(),
            library_part_id: 5,
            node_id: None,
            segment_id: Some(1),
            offset_from_end_mm: Some(20.0),
            offset_from_node_id: None, // dato incompleto a propósito
        }];
        data.wire_instances = vec![WireInstance {
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
        }];

        assert_eq!(wire_route(&data, 1), None);
    }
}
