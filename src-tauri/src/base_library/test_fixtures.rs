//! Datos de prueba compartidos por los tests de los submódulos.

use crate::model::library::{ConnectorDef, Library};

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
