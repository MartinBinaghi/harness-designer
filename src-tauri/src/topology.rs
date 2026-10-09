//! Recorridos y nets sobre un `ProjectData`. Ver ../../CLAUDE.md secciones 4.3 y 11.
//! La topología es un árbol (nodos + segmentos): entre dos nodos hay un único
//! camino, se calcula recorriendo el árbol (sin loops posibles por diseño).

use crate::model::project::{ProjectData, Segment, WireEnd};
use std::collections::{HashMap, HashSet, VecDeque};

/// Punto donde dos o más cables pueden estar unidos: misma cavidad (varios
/// cables en un contacto), mismo splice, misma masa o mismo componente.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum ConnectionPoint {
    Cavity(i64),
    Splice(i64),
    Ground(i64),
    Component(i64),
}

fn connection_point(end: &WireEnd) -> Option<ConnectionPoint> {
    match end.kind.as_str() {
        "cavity" => end.cavity_assignment_id.map(ConnectionPoint::Cavity),
        "splice" => end.splice_id.map(ConnectionPoint::Splice),
        "ground" => end.ground_point_id.map(ConnectionPoint::Ground),
        "component" => end.component_instance_id.map(ConnectionPoint::Component),
        _ => None,
    }
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
            if !distances.contains_key(&neighbor) {
                distances.insert(neighbor, here + segment.length_mm);
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
fn wire_end_node(data: &ProjectData, end: &WireEnd) -> Option<i64> {
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
    let wire = data.wire_instances.iter().find(|w| w.id == wire_id)?;
    let node_a = wire_end_node(data, &wire.end_a)?;
    let node_b = wire_end_node(data, &wire.end_b)?;
    path_between_nodes(data, node_a, node_b)
}

/// Net completa de un cable: todos los cables unidos transitivamente por
/// compartir cavidad, splice, masa o componente (cable → splice → cable…).
/// Se corta sola en intercos y referencias externas porque de ese lado no
/// hay más cables modelados en este archivo. Incluye al propio `wire_id`.
/// Devuelve los ids ordenados.
pub fn net_of_wire(data: &ProjectData, wire_id: i64) -> Vec<i64> {
    let mut points_by_wire: HashMap<i64, Vec<ConnectionPoint>> = HashMap::new();
    let mut wires_by_point: HashMap<ConnectionPoint, Vec<i64>> = HashMap::new();
    for wire in &data.wire_instances {
        let points: Vec<ConnectionPoint> =
            [connection_point(&wire.end_a), connection_point(&wire.end_b)]
                .into_iter()
                .flatten()
                .collect();
        for &point in &points {
            wires_by_point.entry(point).or_default().push(wire.id);
        }
        points_by_wire.insert(wire.id, points);
    }

    let mut visited: HashSet<i64> = HashSet::from([wire_id]);
    let mut queue: VecDeque<i64> = VecDeque::from([wire_id]);

    while let Some(current) = queue.pop_front() {
        for point in points_by_wire.get(&current).into_iter().flatten() {
            for &neighbor in wires_by_point.get(point).into_iter().flatten() {
                if visited.insert(neighbor) {
                    queue.push_back(neighbor);
                }
            }
        }
    }

    let mut result: Vec<i64> = visited.into_iter().collect();
    result.sort_unstable();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::project::{
        CavityAssignment, ConnectorInstance, GroundPoint, Node, Project, ProjectData, Segment,
        SpliceInstance, WireInstance,
    };

    fn wire_end(
        kind: &str,
        cavity: Option<i64>,
        splice: Option<i64>,
        ground: Option<i64>,
        component: Option<i64>,
    ) -> WireEnd {
        WireEnd {
            kind: kind.into(),
            cavity_assignment_id: cavity,
            splice_id: splice,
            ground_point_id: ground,
            component_instance_id: component,
        }
    }

    fn empty_project() -> Project {
        Project {
            name: "Test".into(),
            harness_code: "T-01".into(),
            client: None,
            revision: None,
            format_version: 1,
            main_connector_instance_id: None,
            markup_pct: 0.0,
            default_cut_margin_pct: 10.0,
            default_twist_pitch_factor: 8.0,
            fill_factor: 0.75,
            labor_hours: 0.0,
            labor_rate_usd: 0.0,
            cost_on_purchased: false,
            spare_pcts: Default::default(),
        }
    }

    /// Árbol en Y: 1 --seg1(100mm)-- 2 --seg2(200mm)-- 3
    ///                                \--seg3(50mm)-- 4
    fn y_shaped_topology() -> ProjectData {
        ProjectData {
            project: empty_project(),
            nodes: vec![
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
                Node {
                    id: 4,
                    kind: "connector_end".into(),
                    termination: None,
                    termination_library_part_id: None,
                    diagram_x: None,
                    diagram_y: None,
                    adhesive_heatshrink_length_mm: None,
                },
            ],
            segments: vec![
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
                    length_mm: 200.0,
                    twist_pitch_mm: None,
                    covering_library_part_id: None,
                },
                Segment {
                    id: 3,
                    node_a_id: 2,
                    node_b_id: 4,
                    length_mm: 50.0,
                    twist_pitch_mm: None,
                    covering_library_part_id: None,
                },
            ],
            connector_instances: vec![],
            ground_points: vec![],
            splice_instances: vec![],
            component_instances: vec![],
            wire_instances: vec![],
            twist_groups: vec![],
        }
    }

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

    fn topology_with_connectors_and_a_splice() -> ProjectData {
        let mut data = y_shaped_topology();
        data.connector_instances = vec![
            ConnectorInstance {
                id: 1,
                short_id: "X1".into(),
                name: "Damper FL".into(),
                library_part_id: 1,
                device_connector_id: None,
                node_id: 1,
                termination: None,
                termination_library_part_id: None,
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![CavityAssignment {
                    id: 100,
                    cavity_id: "1".into(),
                    external_reference: None,
                }],
            },
            ConnectorInstance {
                id: 2,
                short_id: "X9".into(),
                name: "PDM".into(),
                library_part_id: 2,
                device_connector_id: None,
                node_id: 3,
                termination: None,
                termination_library_part_id: None,
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![CavityAssignment {
                    id: 101,
                    cavity_id: "47".into(),
                    external_reference: None,
                }],
            },
            ConnectorInstance {
                id: 3,
                short_id: "X4".into(),
                name: "Sensor".into(),
                library_part_id: 3,
                device_connector_id: None,
                node_id: 4,
                termination: None,
                termination_library_part_id: None,
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![CavityAssignment {
                    id: 102,
                    cavity_id: "1".into(),
                    external_reference: None,
                }],
            },
        ];
        data.ground_points = vec![GroundPoint {
            id: 1,
            short_id: "G1".into(),
            name: "Masa chasis".into(),
            terminal_library_part_id: None,
            node_id: 4,
        }];
        data.splice_instances = vec![SpliceInstance {
            id: 1,
            short_id: "SP1".into(),
            library_part_id: 1,
            node_id: Some(2),
            segment_id: None,
            offset_from_end_mm: None,
            offset_from_node_id: None,
        }];
        data
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
