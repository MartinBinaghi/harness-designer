//! Recorridos y nets sobre un `ProjectData`. Ver ../../../CLAUDE.md secciones 4.3 y 11.
//! La topología es un árbol (nodos + segmentos): entre dos nodos hay un único
//! camino, se calcula recorriendo el árbol (sin loops posibles por diseño).

mod destinations;
mod nets;
mod routes;
#[cfg(test)]
mod test_fixtures;

pub use destinations::{pin_destinations, PinDestinations};
pub use nets::{all_nets, net_of_wire};
pub use routes::{distances_from_node, wire_route, with_route_cache};

use crate::model::project::WireEnd;

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
