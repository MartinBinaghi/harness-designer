//! Datos de prueba compartidos por los tests de los submódulos.

use super::catalog::OTHER_HOUSINGS;
use crate::model::library::{ConnectorDef, Library};
use std::collections::BTreeSet;

pub(super) fn def_by_pn<'a>(library: &'a Library, part_number: &str) -> &'a ConnectorDef {
    let id = library
        .parts
        .iter()
        .find(|p| p.part_number == part_number)
        .unwrap()
        .id;
    library
        .connector_defs
        .iter()
        .find(|d| d.part_id == id)
        .unwrap()
}

/// Contactos distintos de las carcasas sueltas (varias comparten el mismo terminal).
pub(super) fn housing_contacts() -> BTreeSet<&'static str> {
    OTHER_HOUSINGS
        .iter()
        .flat_map(|h| h.contacts.iter().map(|c| c.part_number))
        .collect()
}
