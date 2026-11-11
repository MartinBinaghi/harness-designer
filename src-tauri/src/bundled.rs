//! Los archivos que trae el instalador (`resources/`): la biblioteca del taller
//! (la de Martin, decisión 2026-11-02) y un arnés de ejemplo armado con sus
//! partes. Solo tests y mantenimiento: el programa los usa desde `settings.rs`.
//!
//! - `bundle_my_library`: copia la biblioteca de Martin al instalador, en la
//!   versión actual del formato, y rehace el ejemplo con ella.
//! - `sample_project`: el arnés de ejemplo (inventado, de ningún cliente),
//!   armado con partes buscadas por número de parte; un test asegura que el
//!   del instalador coincide con el que genera.

use crate::model::library::Library;
use crate::model::project::{
    CableInstance, CavityAssignment, ConnectorInstance, GroundPoint, Node, ProjectData, Segment,
    SpliceInstance, WireEnd, WireInstance,
};

const RESOURCES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/resources");

/// Arnés de ejemplo, "Sample · engine sensors": la ECU (X1, principal), un
/// breakout y de ahí MAP, temperatura de agua, una bobina, un inyector y una
/// termocupla de escape (con su par trenzado comprado, WC1); 5V y 0V de los
/// sensores por splices en el breakout, y la masa de la bobina a un ojal.
pub fn sample_project(library: &Library) -> ProjectData {
    let part = |pn: &str| {
        library
            .parts
            .iter()
            .find(|p| p.part_number == pn)
            .map(|p| p.id)
            .unwrap_or_else(|| panic!("the bundled library has no {pn}"))
    };
    let mut data = ProjectData::empty();
    data.project.name = "Sample · engine sensors".into();
    data.project.harness_code = "SMP-01".into();
    data.project.main_connector_instance_id = Some(1);

    // Nodos: 1 ECU, 2 breakout, 3..7 conectores, 8 masa.
    let node = |id, kind: &str| Node {
        id,
        kind: kind.into(),
        termination: None,
        termination_library_part_id: None,
        diagram_x: None,
        diagram_y: None,
        adhesive_heatshrink_length_mm: None,
        termination_segment_ids: vec![],
    };
    data.nodes = vec![node(1, "connector_end"), node(2, "breakout")];
    data.nodes
        .extend((3..=7).map(|id| node(id, "connector_end")));
    data.nodes.push(node(8, "ground_point"));
    let lengths = [
        (1, 400.0),
        (3, 250.0),
        (4, 300.0),
        (5, 350.0),
        (6, 200.0),
        (7, 450.0),
        (8, 150.0),
    ];
    data.segments = lengths
        .iter()
        .enumerate()
        .map(|(i, &(other, length_mm))| Segment {
            id: i as i64 + 1,
            node_a_id: if other == 1 { 1 } else { 2 },
            node_b_id: if other == 1 { 2 } else { other },
            length_mm,
            twist_pitch_mm: None,
            covering_library_part_id: None,
            leaves_backward: false,
        })
        .collect();

    // Conectores, con ids de vía únicos en todo el proyecto (101.., 201..).
    let connectors: [(&str, &str, &str, i64); 6] = [
        ("X1", "ECU", "DTM06-12SA", 1),
        ("X2", "MAP", "DTM06-3S", 3),
        ("X3", "Water Temp", "DTM06-2S", 4),
        ("X4", "Coil 1", "1J0 973 724", 5),
        ("X5", "Injector 1", "MINI TYMER 02W-F", 6),
        ("X6", "EGT", "SMPW-K-F", 7),
    ];
    data.connector_instances = connectors
        .iter()
        .enumerate()
        .map(|(i, &(short_id, name, pn, node_id))| {
            let id = i as i64 + 1;
            let library_part_id = part(pn);
            let def = library
                .connector_defs
                .iter()
                .find(|d| d.part_id == library_part_id)
                .unwrap();
            let mut cavity_ids: Vec<&str> =
                def.cavities.iter().map(|c| c.cavity_id.as_str()).collect();
            cavity_ids.sort_by_key(|c| (c.len(), c.to_string()));
            ConnectorInstance {
                id,
                short_id: short_id.into(),
                name: name.into(),
                library_part_id,
                device_connector_id: None,
                node_id,
                termination: def.suggested_termination.clone(),
                termination_library_part_id: None,
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: cavity_ids
                    .iter()
                    .enumerate()
                    .map(|(j, cavity_id)| CavityAssignment {
                        id: id * 100 + j as i64 + 1,
                        cavity_id: (*cavity_id).into(),
                        external_reference: None,
                    })
                    .collect(),
            }
        })
        .collect();
    data.ground_points = vec![GroundPoint {
        id: 1,
        short_id: "G1".into(),
        name: "Engine block".into(),
        terminal_library_part_id: Some(part("RING TERMINAL 16mm2 M6")),
        node_id: 8,
    }];
    data.splice_instances = [("SP1", "5V sensors"), ("SP2", "0V sensors")]
        .iter()
        .enumerate()
        .map(|(i, &(short_id, name))| SpliceInstance {
            id: i as i64 + 1,
            short_id: short_id.into(),
            name: name.into(),
            library_part_id: part("SPLICE SOLDADO"),
            node_id: Some(2),
            segment_id: None,
            offset_from_end_mm: None,
            offset_from_node_id: None,
        })
        .collect();
    data.cable_instances = vec![CableInstance {
        id: 1,
        short_id: "WC1".into(),
        library_part_id: part("TC TYPE K 24 AWG TWISTED PAIR"),
    }];

    // Cables: (función, color, tipo, extremo A, extremo B, cable comprado).
    let pin = |connector: &str, cavity: &str| {
        let c = data
            .connector_instances
            .iter()
            .find(|c| c.short_id == connector)
            .unwrap();
        let id = c
            .cavities
            .iter()
            .find(|cav| cav.cavity_id == cavity)
            .unwrap()
            .id;
        WireEnd {
            kind: "cavity".into(),
            cavity_assignment_id: Some(id),
            splice_id: None,
            ground_point_id: None,
            component_instance_id: None,
            node_id: None,
        }
    };
    let splice = |id| WireEnd {
        kind: "splice".into(),
        cavity_assignment_id: None,
        splice_id: Some(id),
        ground_point_id: None,
        component_instance_id: None,
        node_id: None,
    };
    let ground = WireEnd {
        kind: "ground".into(),
        cavity_assignment_id: None,
        splice_id: None,
        ground_point_id: Some(1),
        component_instance_id: None,
        node_id: None,
    };
    let signal = part("M22759/32-22");
    let power = part("M22759/32-20");
    let tc = part("TC TYPE K 24 AWG TWISTED PAIR");
    let wires = [
        ("5V", "violet", signal, pin("X1", "1"), splice(1), None),
        ("0V", "black", signal, pin("X1", "2"), splice(2), None),
        ("5V MAP", "violet", signal, splice(1), pin("X2", "1"), None),
        ("MAP", "blue", signal, pin("X1", "3"), pin("X2", "2"), None),
        ("0V MAP", "black", signal, splice(2), pin("X2", "3"), None),
        (
            "Water Temp",
            "blue",
            signal,
            pin("X1", "4"),
            pin("X3", "1"),
            None,
        ),
        (
            "0V Water Temp",
            "black",
            signal,
            splice(2),
            pin("X3", "2"),
            None,
        ),
        (
            "GND Coil 1",
            "black",
            power,
            pin("X4", "1"),
            ground.clone(),
            None,
        ),
        (
            "Coil 1",
            "green",
            signal,
            pin("X1", "5"),
            pin("X4", "3"),
            None,
        ),
        (
            "12V+ Coil 1",
            "red",
            power,
            pin("X1", "9"),
            pin("X4", "4"),
            None,
        ),
        (
            "Injector 1",
            "white",
            signal,
            pin("X1", "6"),
            pin("X5", "1"),
            None,
        ),
        (
            "12V+ Injector 1",
            "red",
            power,
            pin("X1", "10"),
            pin("X5", "2"),
            None,
        ),
        (
            "EGT +",
            "yellow",
            tc,
            pin("X1", "7"),
            pin("X6", "+"),
            Some(1),
        ),
        ("EGT -", "red", tc, pin("X1", "8"), pin("X6", "-"), Some(1)),
    ];
    data.wire_instances = wires
        .into_iter()
        .enumerate()
        .map(
            |(i, (name, color, library_part_id, end_a, end_b, cable))| WireInstance {
                id: i as i64 + 1,
                short_id: format!("W{:03}", i + 1),
                library_part_id,
                color: Some(color.into()),
                signal_type_id: None,
                specific_name: Some(name.into()),
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                cable_instance_id: cable,
                end_a,
                end_b,
            },
        )
        .collect();
    data
}

fn bundled_library() -> Library {
    let conn = rusqlite::Connection::open_with_flags(
        format!("{RESOURCES}/default-library.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    crate::model::library::load(&conn).unwrap()
}

/// El ejemplo del instalador es el que arma `sample_project` con la biblioteca
/// del instalador: si alguna de las dos cambia, correr `bundle_my_library`.
#[test]
fn bundled_sample_matches_its_generator() {
    let conn = crate::db::open_bundled_project(&format!("{RESOURCES}/sample-project.db")).unwrap();
    let bundled = crate::model::project::load(&conn).unwrap();
    assert_eq!(bundled, sample_project(&bundled_library()));
}

/// El ejemplo no tiene errores con la biblioteca del instalador.
#[test]
fn bundled_sample_has_no_errors() {
    let library = bundled_library();
    let findings =
        crate::calc::with_cache(|| crate::checks::run_checks(&sample_project(&library), &library));
    let errors: Vec<_> = findings.iter().filter(|f| f.severity == "error").collect();
    assert!(errors.is_empty(), "{errors:?}");
}

/// Mantenimiento, no un test: la biblioteca de Martin pasa a ser la del
/// instalador (copiada y llevada a la versión actual; el original no se toca)
/// y el ejemplo se rehace con ella. Correr antes de cada release:
/// `HD_LIBRARY="C:/Users/yo/Documents/Harness Designer/library.db" cargo test bundle_my_library -- --ignored`
#[test]
#[ignore]
fn bundle_my_library() {
    let source = std::env::var("HD_LIBRARY").expect("HD_LIBRARY = path of the library to bundle");
    let target = format!("{RESOURCES}/default-library.db");
    let staging = format!("{target}.new");
    std::fs::copy(&source, &staging).unwrap();
    drop(crate::db::open_library(&staging).unwrap()); // migra la copia
    for v in 0..crate::db::LIBRARY.version() {
        let _ = std::fs::remove_file(format!("{staging}.v{v}.bak"));
    }
    std::fs::rename(&staging, &target).unwrap();

    let sample_path = format!("{RESOURCES}/sample-project.db");
    let _ = std::fs::remove_file(&sample_path);
    let mut conn = crate::db::project_for_saving(&sample_path).unwrap();
    crate::model::project::save(&mut conn, &sample_project(&bundled_library())).unwrap();
    println!("bundled {source} and rebuilt the sample");
}
