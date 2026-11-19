//! Recorrido de cada cable por el árbol y distancias entre nodos (plan 4.3 y 11).

use crate::model::project::{ProjectData, Segment, WireEnd};
use serde::Serialize;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::rc::Rc;

/// Los pedazos de cada segmento (ver `segment_spans`).
pub type SegmentSpans = HashMap<i64, Vec<SegmentSpan>>;

thread_local! {
    /// Recorridos ya calculados mientras dura una pasada de cálculo (ver
    /// `with_route_cache`): el proyecto no cambia en el medio, y sin esto cada
    /// largo y cada diámetro rehace el recorrido de todos los cables.
    static ROUTES: RefCell<Option<HashMap<i64, Option<Vec<RouteLeg>>>>> = const { RefCell::new(None) };
    /// Los pedazos de los segmentos de la pasada (los usan el diámetro y la
    /// capacidad): `Some(None)` mientras no se calcularon.
    static SPANS: RefCell<Option<Option<Rc<SegmentSpans>>>> = const { RefCell::new(None) };
}

/// Corre `f` recordando los recorridos de cables que calcule. Solo para
/// cálculos sobre un mismo proyecto que no cambia mientras corren.
pub fn with_route_cache<T>(f: impl FnOnce() -> T) -> T {
    ROUTES.with(|c| *c.borrow_mut() = Some(HashMap::new()));
    SPANS.with(|c| *c.borrow_mut() = Some(None));
    let out = f();
    ROUTES.with(|c| *c.borrow_mut() = None);
    SPANS.with(|c| *c.borrow_mut() = None);
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

/// Resuelve un extremo de cable a un nodo. Un splice o componente sobre un
/// segmento da su nodo de referencia (el extremo desde el que se mide): sirve
/// para saber de qué lado está, no para medir (eso es `wire_route`).
pub(crate) fn wire_end_node(data: &ProjectData, end: &WireEnd) -> Option<i64> {
    match wire_end_place(data, end)? {
        Place::Node(node) => Some(node),
        Place::OnSegment { reference, .. } => Some(reference),
    }
}

/// Dónde está un extremo de cable: en un nodo, o sobre un segmento a `at_mm`
/// de su nodo A (un splice o componente medido desde `reference`, una de las
/// puntas del segmento).
#[derive(Debug, Clone, Copy)]
enum Place {
    Node(i64),
    OnSegment {
        segment: i64,
        at_mm: f64,
        reference: i64,
    },
}

fn wire_end_place(data: &ProjectData, end: &WireEnd) -> Option<Place> {
    let placed = |node_id: Option<i64>,
                  segment_id: Option<i64>,
                  offset_mm: Option<f64>,
                  reference: Option<i64>| {
        if let Some(node) = node_id {
            return Some(Place::Node(node));
        }
        let segment = data.segments.iter().find(|s| Some(s.id) == segment_id)?;
        let reference = reference?;
        let length = segment.length_mm.max(0.0);
        // Fuera del segmento se toma su punta (Checks lo avisa).
        let offset = offset_mm.unwrap_or(0.0).clamp(0.0, length);
        let at_mm = if reference == segment.node_a_id {
            offset
        } else if reference == segment.node_b_id {
            length - offset
        } else {
            return None;
        };
        Some(Place::OnSegment {
            segment: segment.id,
            at_mm,
            reference,
        })
    };
    match end.kind.as_str() {
        "cavity" => {
            let cavity_id = end.cavity_assignment_id?;
            data.connector_instances
                .iter()
                .find(|c| c.cavities.iter().any(|cav| cav.id == cavity_id))
                .map(|c| Place::Node(c.node_id))
        }
        "ground" => {
            let ground_id = end.ground_point_id?;
            data.ground_points
                .iter()
                .find(|g| g.id == ground_id)
                .map(|g| Place::Node(g.node_id))
        }
        "splice" => {
            let splice_id = end.splice_id?;
            let s = data.splice_instances.iter().find(|s| s.id == splice_id)?;
            placed(
                s.node_id,
                s.segment_id,
                s.offset_from_end_mm,
                s.offset_from_node_id,
            )
        }
        // Suelto en un nodo: llega hasta ahí.
        "loose" => end.node_id.map(Place::Node),
        "component" => {
            let component_id = end.component_instance_id?;
            let c = data
                .component_instances
                .iter()
                .find(|c| c.id == component_id)?;
            placed(
                c.node_id,
                c.segment_id,
                c.offset_from_end_mm,
                c.offset_from_node_id,
            )
        }
        _ => None,
    }
}

/// Lo que un cable recorre de un segmento: de `start_mm` a `end_mm`, medidos
/// desde su nodo A (`start_mm <= end_mm`). Entero va de 0 al largo del
/// segmento; menos si el cable termina en un splice o componente sobre él.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct RouteLeg {
    pub segment_id: i64,
    pub start_mm: f64,
    pub end_mm: f64,
    /// Del splice o componente a su nodo de referencia: va derecho, sin
    /// trenzarse (Martin, 2026-11-19: es el pedazo bajo el boot del conector).
    pub straight: bool,
}

impl RouteLeg {
    pub fn length_mm(&self) -> f64 {
        self.end_mm - self.start_mm
    }

    /// Si recorre el pedazo de `start_mm` a `end_mm` del segmento (uno de
    /// `segment_spans`). Solo un segmento de largo 0 (sin medir todavía) tiene
    /// un pedazo de largo 0, y lo recorren todos los cables que pasan por él;
    /// un cable que solo toca una punta (un splice pegado al nodo) no recorre
    /// ninguno.
    pub fn covers(&self, start_mm: f64, end_mm: f64) -> bool {
        start_mm >= self.start_mm && end_mm <= self.end_mm
    }
}

/// Recorrido físico de un cable, de su extremo A al B: lo que recorre de cada
/// segmento. `None` si el cable no existe, si alguno de sus extremos no tiene
/// ubicación (ej. un splice o componente sin ubicación cargada) o si sus dos
/// extremos no están en el mismo árbol.
pub fn wire_route(data: &ProjectData, wire_id: i64) -> Option<Vec<RouteLeg>> {
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

fn compute_wire_route(data: &ProjectData, wire_id: i64) -> Option<Vec<RouteLeg>> {
    let wire = data.wire_instances.iter().find(|w| w.id == wire_id)?;
    let a = wire_end_place(data, &wire.end_a)?;
    let b = wire_end_place(data, &wire.end_b)?;

    // Dos puntos sobre el mismo segmento: solo lo que hay entre ellos.
    if let (
        Place::OnSegment {
            segment: sa,
            at_mm: xa,
            ..
        },
        Place::OnSegment {
            segment: sb,
            at_mm: xb,
            ..
        },
    ) = (a, b)
    {
        if sa == sb {
            return Some(vec![RouteLeg {
                segment_id: sa,
                start_mm: xa.min(xb),
                end_mm: xa.max(xb),
                straight: false,
            }]);
        }
    }

    // Es un árbol: de las salidas posibles de cada punta, una sola combinación
    // no vuelve a cruzar el segmento donde está un splice o componente.
    for (from, first) in exits(data, a) {
        for (to, last) in exits(data, b) {
            let Some(path) = path_between_nodes(data, from, to) else {
                continue;
            };
            let crosses =
                |leg: &Option<RouteLeg>| leg.is_some_and(|l| path.contains(&l.segment_id));
            if crosses(&first) || crosses(&last) {
                continue;
            }
            let mut legs: Vec<RouteLeg> = first.into_iter().collect();
            for id in &path {
                let segment = data.segments.iter().find(|s| s.id == *id)?;
                legs.push(RouteLeg {
                    segment_id: segment.id,
                    start_mm: 0.0,
                    end_mm: segment.length_mm.max(0.0),
                    straight: false,
                });
            }
            legs.extend(last);
            return Some(legs);
        }
    }
    None
}

/// Por dónde se sale de un punto hacia el árbol: un nodo, por sí mismo; un
/// punto sobre un segmento, por cualquiera de sus dos puntas, recorriendo el
/// pedazo hasta ahí.
fn exits(data: &ProjectData, place: Place) -> Vec<(i64, Option<RouteLeg>)> {
    match place {
        Place::Node(node) => vec![(node, None)],
        Place::OnSegment {
            segment,
            at_mm,
            reference,
        } => {
            let Some(s) = data.segments.iter().find(|s| s.id == segment) else {
                return Vec::new();
            };
            let leg = |node: i64, start_mm: f64, end_mm: f64| {
                (
                    node,
                    Some(RouteLeg {
                        segment_id: segment,
                        start_mm,
                        end_mm,
                        straight: node == reference,
                    }),
                )
            };
            vec![
                leg(s.node_a_id, 0.0, at_mm),
                leg(s.node_b_id, at_mm, s.length_mm.max(0.0)),
            ]
        }
    }
}

/// Un pedazo de segmento entre los puntos donde empieza o termina algún cable
/// (splices y componentes sobre él, o sus puntas), con los cables que lo
/// recorren. Cada pedazo es un mazo: diámetro, trenzado y capacidad se
/// calculan por pedazo (Martin, 2026-11-19: el splice se hace después de pasar
/// los termos, y los cables que entran a un splice y los que salen no van
/// juntos en el mazo).
#[derive(Debug, Clone, PartialEq)]
pub struct SegmentSpan {
    pub start_mm: f64,
    pub end_mm: f64,
    pub wire_ids: Vec<i64>,
}

/// Pedazos de cada segmento, en orden desde su nodo A. Un segmento sin splices
/// ni componentes encima es un solo pedazo. Dentro de `with_route_cache` se
/// calculan una vez por pasada.
pub fn segment_spans(data: &ProjectData) -> Rc<SegmentSpans> {
    if let Some(hit) = SPANS.with(|c| c.borrow().clone().flatten()) {
        return hit;
    }
    let spans = Rc::new(compute_segment_spans(data));
    SPANS.with(|c| {
        if let Some(slot) = c.borrow_mut().as_mut() {
            *slot = Some(spans.clone());
        }
    });
    spans
}

fn compute_segment_spans(data: &ProjectData) -> SegmentSpans {
    let mut legs: HashMap<i64, Vec<(i64, RouteLeg)>> = HashMap::new();
    for w in &data.wire_instances {
        for leg in wire_route(data, w.id).unwrap_or_default() {
            legs.entry(leg.segment_id).or_default().push((w.id, leg));
        }
    }
    data.segments
        .iter()
        .map(|s| {
            let on = legs.get(&s.id).map(Vec::as_slice).unwrap_or_default();
            let mut cuts: Vec<f64> = [0.0, s.length_mm.max(0.0)]
                .into_iter()
                .chain(on.iter().flat_map(|(_, l)| [l.start_mm, l.end_mm]))
                .collect();
            cuts.sort_by(f64::total_cmp);
            cuts.dedup();
            // Un segmento de largo 0 es un solo pedazo, de largo 0.
            let bounds: Vec<(f64, f64)> = match cuts.as_slice() {
                [only] => vec![(*only, *only)],
                _ => cuts.windows(2).map(|w| (w[0], w[1])).collect(),
            };
            let spans = bounds
                .into_iter()
                .map(|(start_mm, end_mm)| SegmentSpan {
                    start_mm,
                    end_mm,
                    wire_ids: on
                        .iter()
                        .filter(|(_, l)| l.covers(start_mm, end_mm))
                        .map(|(id, _)| *id)
                        .collect(),
                })
                .collect();
            (s.id, spans)
        })
        .collect()
}

/// El pedazo de un segmento (de `segment_spans`, o algo calculado por pedazo
/// en el mismo orden) que llega a `node`, una de sus puntas.
pub fn span_at_node<'a, T>(spans: &'a [T], segment: &Segment, node: i64) -> Option<&'a T> {
    if node == segment.node_a_id {
        spans.first()
    } else if node == segment.node_b_id {
        spans.last()
    } else {
        None
    }
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
            cable_instance_id: None,
            load_current_a: None,
            protection_current_a: None,
            end_a: wire_end("cavity", Some(100), None, None, None),
            end_b: wire_end("cavity", Some(101), None, None, None),
        }];

        assert_eq!(segment_ids(wire_route(&data, 1)), Some(vec![1, 2]));
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
            cable_instance_id: None,
            load_current_a: None,
            protection_current_a: None,
            end_a: wire_end("cavity", Some(100), None, None, None),
            end_b: wire_end("component", None, None, None, Some(1)),
        }];

        assert_eq!(segment_ids(wire_route(&data, 1)), Some(vec![1, 2]));
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
            cable_instance_id: None,
            load_current_a: None,
            protection_current_a: None,
            end_a: wire_end("cavity", Some(100), None, None, None),
            end_b: wire_end("component", None, None, None, Some(1)),
        }];

        assert_eq!(wire_route(&data, 1), None);
    }

    fn segment_ids(route: Option<Vec<RouteLeg>>) -> Option<Vec<i64>> {
        route.map(|r| r.iter().map(|l| l.segment_id).collect())
    }

    fn leg(segment_id: i64, start_mm: f64, end_mm: f64, straight: bool) -> RouteLeg {
        RouteLeg {
            segment_id,
            start_mm,
            end_mm,
            straight,
        }
    }

    /// SP1 sobre el segmento `segment` a `offset` mm de `from` (como SP1 del
    /// TC2000, a 40 mm de X1 bajo el boot).
    fn splice_on(data: &mut ProjectData, segment: i64, offset: f64, from: i64) {
        let sp = &mut data.splice_instances[0];
        sp.node_id = None;
        sp.segment_id = Some(segment);
        sp.offset_from_end_mm = Some(offset);
        sp.offset_from_node_id = Some(from);
    }

    #[test]
    fn a_splice_40_mm_from_a_connector_splits_its_segment() {
        // X1 (nodo 1) --seg1 100mm-- 2 --seg2 200mm-- X9 (nodo 3); SP1 a 40 mm de X1.
        let mut data = topology_with_connectors_and_a_splice();
        splice_on(&mut data, 1, 40.0, 1);
        let sp1 = wire_end("splice", None, Some(1), None, None);
        data.wire_instances = vec![
            wire(1, cavity(100), sp1.clone()),
            wire(2, sp1.clone(), cavity(101)),
        ];
        // Hacia X1, solo los 40 mm, derechos.
        assert_eq!(wire_route(&data, 1), Some(vec![leg(1, 0.0, 40.0, true)]));
        // Hacia el otro lado, el resto del segmento y lo que sigue.
        assert_eq!(
            wire_route(&data, 2),
            Some(vec![leg(1, 40.0, 100.0, false), leg(2, 0.0, 200.0, false)])
        );
        // El segmento queda en dos pedazos, cada uno con lo que pasa por él.
        let spans = &segment_spans(&data)[&1];
        assert_eq!(
            spans,
            &vec![
                SegmentSpan {
                    start_mm: 0.0,
                    end_mm: 40.0,
                    wire_ids: vec![1],
                },
                SegmentSpan {
                    start_mm: 40.0,
                    end_mm: 100.0,
                    wire_ids: vec![2],
                },
            ]
        );
        assert_eq!(segment_spans(&data)[&2].len(), 1);
    }

    #[test]
    fn a_splice_measured_from_node_b_counts_from_that_end() {
        // SP1 sobre seg2 a 30 mm de X9 (nodo 3, su punta B).
        let mut data = topology_with_connectors_and_a_splice();
        splice_on(&mut data, 2, 30.0, 3);
        let sp1 = wire_end("splice", None, Some(1), None, None);
        data.wire_instances = vec![
            wire(1, cavity(100), sp1.clone()),
            wire(2, sp1.clone(), cavity(101)),
            wire(3, sp1.clone(), cavity(102)),
        ];
        assert_eq!(
            wire_route(&data, 1),
            Some(vec![leg(1, 0.0, 100.0, false), leg(2, 0.0, 170.0, false)])
        );
        assert_eq!(wire_route(&data, 2), Some(vec![leg(2, 170.0, 200.0, true)]));
        // A X4 (otra rama del breakout 2) sale por la punta A de seg2.
        assert_eq!(
            wire_route(&data, 3),
            Some(vec![leg(2, 0.0, 170.0, false), leg(3, 0.0, 50.0, false)])
        );
    }

    #[test]
    fn two_splices_on_the_same_segment_are_joined_by_what_lies_between() {
        let mut data = topology_with_connectors_and_a_splice();
        splice_on(&mut data, 2, 30.0, 3);
        let mut second = data.splice_instances[0].clone();
        second.id = 2;
        second.offset_from_end_mm = Some(50.0);
        second.offset_from_node_id = Some(2);
        data.splice_instances.push(second);
        data.wire_instances = vec![wire(
            1,
            wire_end("splice", None, Some(1), None, None),
            wire_end("splice", None, Some(2), None, None),
        )];
        assert_eq!(wire_route(&data, 1), Some(vec![leg(2, 50.0, 170.0, false)]));
    }

    #[test]
    fn a_segment_not_measured_yet_is_one_piece_with_every_wire_through_it() {
        // seg1 sin largo todavía (0 mm): su mazo cuenta igual para la capacidad.
        let mut data = topology_with_connectors_and_a_splice();
        data.segments[0].length_mm = 0.0;
        data.wire_instances = vec![wire(1, cavity(100), cavity(101))];
        let spans = &segment_spans(&data)[&1];
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].wire_ids, vec![1]);
        let route = wire_route(&data, 1).unwrap();
        assert!(route[0].covers(spans[0].start_mm, spans[0].end_mm));
        // Un cable que solo toca la punta de un tramo medido no recorre nada de él.
        assert!(!leg(2, 0.0, 0.0, true).covers(0.0, 50.0));
    }

    #[test]
    fn a_splice_beyond_its_segment_is_taken_at_its_end() {
        let mut data = topology_with_connectors_and_a_splice();
        splice_on(&mut data, 1, 250.0, 1); // el segmento mide 100
        data.wire_instances = vec![wire(
            1,
            cavity(100),
            wire_end("splice", None, Some(1), None, None),
        )];
        assert_eq!(wire_route(&data, 1), Some(vec![leg(1, 0.0, 100.0, true)]));
        // Medido desde un nodo que no es punta del segmento: sin recorrido.
        data.splice_instances[0].offset_from_node_id = Some(4);
        assert_eq!(wire_route(&data, 1), None);
    }
}
