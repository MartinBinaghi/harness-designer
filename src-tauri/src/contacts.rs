//! Contacto y tapón de cada vía de un conector del proyecto, deducidos de la
//! biblioteca: el ConnectorDef dice qué contacto lleva (y qué tapón para las
//! vías sin usar), uno por conector, como se trabaja en el taller. Una vía con
//! cable lleva contacto; una sin cable, tapón. Ver docs/BITACORA.md,
//! "Contacto y tapón por conector, no por vía".

use crate::model::library::{ConnectorDef, ContactDef, Library};
use crate::model::project::{CavityAssignment, ConnectorInstance, ProjectData, WireInstance};
use serde::Serialize;
use std::collections::BTreeMap;

/// Rango de calibre (mín, máx) en mm² a partir de dos textos de calibre
/// ("20 AWG", "0.5 mm²"); None si falta o no se entiende alguno.
pub fn gauge_range_mm2(gauge_min: Option<&str>, gauge_max: Option<&str>) -> Option<(f64, f64)> {
    let a = crate::gauge::gauge_to_mm2(gauge_min?)?;
    let b = crate::gauge::gauge_to_mm2(gauge_max?)?;
    Some((a.min(b), a.max(b)))
}

pub fn wires_in_cavity<'a>(
    data: &'a ProjectData,
    cavity: &CavityAssignment,
) -> Vec<&'a WireInstance> {
    data.wire_instances
        .iter()
        .filter(|w| {
            w.end_a.cavity_assignment_id == Some(cavity.id)
                || w.end_b.cavity_assignment_id == Some(cavity.id)
        })
        .collect()
}

/// Sección total de los cables de la vía (varios cables en un contacto se suman);
/// None si algún calibre no se pudo interpretar.
pub fn cavity_wire_mm2(
    data: &ProjectData,
    library: &Library,
    cavity: &CavityAssignment,
) -> Option<f64> {
    wires_in_cavity(data, cavity)
        .iter()
        .map(|w| {
            library
                .wire_defs
                .iter()
                .find(|wd| wd.part_id == w.library_part_id)
                .and_then(|wd| crate::gauge::gauge_to_mm2(&wd.gauge))
        })
        .sum()
}

fn connector_def<'a>(
    library: &'a Library,
    connector: &ConnectorInstance,
) -> Option<&'a ConnectorDef> {
    library
        .connector_defs
        .iter()
        .find(|d| d.part_id == connector.library_part_id)
}

/// Tamaño de contacto de la vía según el ConnectorDef ("" si no figura).
fn cavity_size<'a>(def: &'a ConnectorDef, cavity: &CavityAssignment) -> &'a str {
    def.cavities
        .iter()
        .find(|c| c.cavity_id == cavity.cavity_id)
        .map(|c| c.contact_size.as_str())
        .unwrap_or("")
}

fn takes(contact: &ContactDef, mm2: Option<f64>) -> bool {
    match (
        mm2,
        gauge_range_mm2(contact.gauge_min.as_deref(), contact.gauge_max.as_deref()),
    ) {
        (Some(total), Some((min, max))) => total >= min && total <= max,
        _ => true, // calibre o rango desconocido: no hay con qué descartarlo
    }
}

/// Contacto de una vía con cable: el del conector si es de ese tamaño y le
/// entra el calibre; si no, otro de la biblioteca del mismo tamaño y género
/// que sí sirva; si ninguno sirve, el del conector igual (Checks avisa del
/// calibre). Una vía sin cable no lleva contacto.
pub fn cavity_contact(
    data: &ProjectData,
    library: &Library,
    connector: &ConnectorInstance,
    cavity: &CavityAssignment,
) -> Option<i64> {
    if wires_in_cavity(data, cavity).is_empty() {
        return None;
    }
    let def = connector_def(library, connector)?;
    let mm2 = cavity_wire_mm2(data, library, cavity);
    let usable = usable_contacts(library, def, cavity_size(def, cavity));
    let default = def
        .contact_part_id
        .filter(|id| usable.first().is_some_and(|c| c.part_id == *id));
    usable
        .iter()
        .find(|c| takes(c, mm2))
        .map(|c| c.part_id)
        .or(default)
}

/// Contactos que puede llevar una vía de ese tamaño en ese conector, en el orden
/// en que se prueban: el del conector (si es de ese tamaño) y después los de la
/// biblioteca del mismo tamaño y género. Es la única definición de "qué contacto
/// sirve": la usan `cavity_contact`, los chequeos y la pantalla (`gauge_facts`).
fn usable_contacts<'a>(
    library: &'a Library,
    def: &ConnectorDef,
    size: &str,
) -> Vec<&'a ContactDef> {
    let fits_size = |c: &&ContactDef| size.is_empty() || c.contact_size == size;
    let default = def
        .contact_part_id
        .and_then(|id| library.contact_defs.iter().find(|c| c.part_id == id))
        .filter(fits_size);
    let others = library
        .contact_defs
        .iter()
        .filter(fits_size)
        .filter(|c| c.gender == def.gender && Some(c.part_id) != default.map(|d| d.part_id));
    default.into_iter().chain(others).collect()
}

/// Lo que la pantalla necesita para elegir el tipo de un cable nuevo con el
/// mismo criterio que los chequeos, sin volver a interpretar calibres: la
/// sección de cada tipo de cable y, por conector de la biblioteca y tamaño de
/// contacto, el rango de cada contacto que puede llevar.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct GaugeFacts {
    /// Tipo de cable → sección (mm²); `None` si su calibre no se entiende.
    pub wire_mm2: BTreeMap<i64, Option<f64>>,
    /// Conector → tamaño de contacto → rango (mm²) de cada contacto usable;
    /// `None` = rango desconocido (no descarta ningún calibre, como `takes`).
    pub contact_ranges: BTreeMap<i64, BTreeMap<String, Vec<Option<(f64, f64)>>>>,
}

pub fn gauge_facts(library: &Library) -> GaugeFacts {
    let wire_mm2 = library
        .wire_defs
        .iter()
        .map(|w| (w.part_id, crate::gauge::gauge_to_mm2(&w.gauge)))
        .collect();
    let contact_ranges = library
        .connector_defs
        .iter()
        .map(|def| {
            let sizes: BTreeMap<String, Vec<Option<(f64, f64)>>> = def
                .cavities
                .iter()
                .map(|c| {
                    let ranges = usable_contacts(library, def, &c.contact_size)
                        .iter()
                        .map(|contact| {
                            gauge_range_mm2(
                                contact.gauge_min.as_deref(),
                                contact.gauge_max.as_deref(),
                            )
                        })
                        .collect();
                    (c.contact_size.clone(), ranges)
                })
                .collect();
            (def.part_id, sizes)
        })
        .collect();
    GaugeFacts {
        wire_mm2,
        contact_ranges,
    }
}

/// Tapón de una vía sin cable: el del conector si es de ese tamaño; si no,
/// otro de la biblioteca del mismo tamaño. Una vía con cable no lleva tapón.
pub fn cavity_seal_plug(
    data: &ProjectData,
    library: &Library,
    connector: &ConnectorInstance,
    cavity: &CavityAssignment,
) -> Option<i64> {
    if !wires_in_cavity(data, cavity).is_empty() {
        return None;
    }
    let def = connector_def(library, connector)?;
    let size = cavity_size(def, cavity);
    let plugs = || {
        library
            .seal_plug_defs
            .iter()
            .filter(|p| size.is_empty() || p.contact_size == size)
    };
    plugs()
        .find(|p| Some(p.part_id) == def.seal_plug_part_id)
        .or_else(|| plugs().next())
        .map(|p| p.part_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::library::{ConnectorDefCavity, SealPlugDef, WireDef};
    use crate::model::project::WireEnd;

    fn contact(part_id: i64, size: &str, min: &str, max: &str) -> ContactDef {
        ContactDef {
            part_id,
            gender: "female".into(),
            contact_size: size.into(),
            gauge_min: Some(min.into()),
            gauge_max: Some(max.into()),
        }
    }

    /// DTM hembra de 3 vías tamaño 20 con contacto 16–20 AWG por defecto; la
    /// biblioteca tiene además uno reducido para 22–24 AWG y un tapón tamaño 20.
    fn setup(wire_gauge: &str) -> (ProjectData, Library) {
        let mut data = crate::demo::sample_project();
        let mut library = crate::demo::sample_library();
        library.connector_defs = vec![ConnectorDef {
            part_id: 1,
            gender: "female".into(),
            series: Some("DTM".into()),
            shell_size: None,
            counterpart_id: None,
            back_shape: None,
            back_diameter_mm: None,
            back_width_mm: None,
            back_height_mm: None,
            suggested_termination: None,
            contact_part_id: Some(500),
            seal_plug_part_id: Some(600),
            adhesive_heatshrink_length_mm: None,
            cavities: ["1", "2", "3"]
                .iter()
                .map(|id| ConnectorDefCavity {
                    cavity_id: id.to_string(),
                    contact_size: "20".into(),
                })
                .collect(),
        }];
        library.contact_defs = vec![
            contact(500, "20", "20 AWG", "16 AWG"),
            contact(501, "20", "24 AWG", "22 AWG"),
            contact(502, "16", "24 AWG", "14 AWG"),
        ];
        library.seal_plug_defs = vec![SealPlugDef {
            part_id: 600,
            contact_size: "20".into(),
        }];
        library.wire_defs.push(WireDef {
            part_id: 99,
            gauge: wire_gauge.into(),
            spec: None,
            color: None,
            outer_diameter_mm: 1.0,
            default_cut_margin_pct: None,
            conductors: vec![],
        });
        // X1 pasa a ser el DTM de 3 vías: la vía 1 con un cable del calibre pedido, 2 y 3 sin cable.
        let x1 = &mut data.connector_instances[0];
        x1.library_part_id = 1;
        x1.cavities = ["1", "2", "3"]
            .iter()
            .enumerate()
            .map(|(i, id)| CavityAssignment {
                id: 900 + i as i64,
                cavity_id: id.to_string(),
                external_reference: None,
            })
            .collect();
        data.wire_instances = vec![WireInstance {
            id: 1,
            short_id: "W001".into(),
            library_part_id: 99,
            color: None,
            signal_type_id: None,
            specific_name: None,
            manual_cut_margin_pct: None,
            manual_length_mm: None,
            label: None,
            end_a: WireEnd {
                kind: "cavity".into(),
                cavity_assignment_id: Some(900),
                splice_id: None,
                ground_point_id: None,
                component_instance_id: None,
            },
            end_b: WireEnd {
                kind: "splice".into(),
                cavity_assignment_id: None,
                splice_id: Some(1),
                ground_point_id: None,
                component_instance_id: None,
            },
        }];
        (data, library)
    }

    #[test]
    fn used_cavities_take_the_connector_contact_unused_ones_its_seal_plug() {
        let (data, library) = setup("18 AWG");
        let x1 = &data.connector_instances[0];
        assert_eq!(
            cavity_contact(&data, &library, x1, &x1.cavities[0]),
            Some(500)
        );
        assert_eq!(cavity_seal_plug(&data, &library, x1, &x1.cavities[0]), None);
        assert_eq!(cavity_contact(&data, &library, x1, &x1.cavities[1]), None);
        assert_eq!(
            cavity_seal_plug(&data, &library, x1, &x1.cavities[1]),
            Some(600)
        );
    }

    #[test]
    fn a_wire_too_thin_for_the_default_contact_picks_another_of_the_same_size() {
        let (data, library) = setup("22 AWG");
        let x1 = &data.connector_instances[0];
        assert_eq!(
            cavity_contact(&data, &library, x1, &x1.cavities[0]),
            Some(501)
        );
    }

    #[test]
    fn with_nothing_that_fits_it_keeps_the_connector_contact() {
        let (data, library) = setup("10 AWG");
        let x1 = &data.connector_instances[0];
        assert_eq!(
            cavity_contact(&data, &library, x1, &x1.cavities[0]),
            Some(500)
        );
    }

    #[test]
    fn the_screen_gets_the_same_contact_ranges_the_checks_use() {
        // La vía de tamaño 20 de X1 puede llevar el contacto del conector (500) y
        // el otro macho de tamaño 20 (501): la pantalla ve los dos rangos, en ese orden.
        let (_, library) = setup("22 AWG");
        let facts = gauge_facts(&library);
        let expected: Vec<Option<(f64, f64)>> = [500, 501]
            .iter()
            .map(|id| {
                let c = library
                    .contact_defs
                    .iter()
                    .find(|c| c.part_id == *id)
                    .unwrap();
                gauge_range_mm2(c.gauge_min.as_deref(), c.gauge_max.as_deref())
            })
            .collect();
        assert_eq!(facts.contact_ranges[&1]["20"], expected);
        assert_eq!(facts.wire_mm2[&99], crate::gauge::gauge_to_mm2("22 AWG"));
    }
}
