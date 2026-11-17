//! Carga eléctrica: corriente de cada cable, caída de tensión de cada circuito y
//! corriente de cada contacto (pedido de Martin del 2026-11-16).
//!
//! Cada cable puede tener dos corrientes cargadas a mano:
//! - el **consumo** de lo que alimenta: para la caída de tensión y la corriente
//!   que de verdad pasa;
//! - el **límite de la protección** que lo alimenta (canal del PDM, fusible): el
//!   cable y el contacto lo tienen que aguantar, porque es lo que la protección
//!   deja pasar antes de cortar.
//!
//! Reglas:
//! - **Consumo en un splice:** si un solo cable del splice queda sin consumo
//!   (cargado o ya deducido), toma la suma de los otros y es el que lo alimenta;
//!   se repite hasta que no se deduce nada más, así sigue por splices
//!   encadenados. Con todos cargados a mano, lo alimenta el grupo de cables que
//!   lleva lo mismo que el resto: uno solo, o varios en paralelo (una salida del
//!   PDM en dos pines). Si cierran varios grupos, gana el de menos cables y, con
//!   empate, el que tiene la protección cargada a mano en todos sus cables (sale
//!   del PDM o de un fusible). Lo que no se puede saber se avisa (`SpliceIssue`)
//!   y no se adivina.
//! - **Protección de un circuito** (cables unidos por splices o por compartir
//!   una vía): un cable sin protección cargada toma la mayor de su circuito, lo
//!   más exigente para los cables (un ramal con su propio fusible lleva el suyo).
//! - **Caída de tensión:** consumo × resistencia del conductor × largo de corte.
//!   La de un circuito, en la punta de cada cable, es la suya más la de los
//!   cables que lo alimentan, splice por splice hasta la fuente. La resistencia es
//!   a 20 °C (como la tabla de la FAA de donde salen los valores de la base).
//! - **Contacto:** por él pasan todos los cables de su vía: su consumo es la
//!   suma, y su protección la mayor de ellos.
//!
//! Las masas no unen circuitos (cada cable a un ojal es su propio retorno) y los
//! componentes tampoco: una resistencia de terminación no es un empalme.

use super::{cut_list, wire_def_of, PASS};
use crate::contacts::{cavity_contact, wires_in_cavity};
use crate::model::library::Library;
use crate::model::project::{ProjectData, WireEnd, WireInstance};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WireElectrical {
    pub wire_id: i64,
    /// Consumo (A): el cargado, o el deducido en un splice.
    pub load_a: Option<f64>,
    /// Si el consumo se dedujo: el splice donde es la suma de los otros cables.
    pub load_from_splice_id: Option<i64>,
    /// Límite de la protección que lo alimenta (A): el cargado o el de su circuito.
    pub protection_a: Option<f64>,
    /// La protección no se cargó en este cable: es la de su circuito.
    pub protection_from_circuit: bool,
    /// De su tipo de cable (por conductor).
    pub max_current_a: Option<f64>,
    pub resistance_mohm_per_m: Option<f64>,
    /// Caída de tensión en este cable (V).
    pub drop_v: Option<f64>,
    /// Caída desde la fuente del circuito hasta la punta de este cable (V).
    pub circuit_drop_v: Option<f64>,
    /// Este cable no alimenta a ningún splice: su punta es donde se consume, y
    /// su `circuit_drop_v` es la que se compara con el límite del arnés.
    pub ends_at_load: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CavityElectrical {
    pub cavity_assignment_id: i64,
    pub connector_instance_id: i64,
    /// Suma de los consumos de sus cables (los que lo tienen).
    pub load_a: Option<f64>,
    /// La mayor protección de sus cables.
    pub protection_a: Option<f64>,
    pub contact_part_id: Option<i64>,
    pub max_current_a: Option<f64>,
}

/// Un splice con algún consumo cargado donde no se sabe qué cables lo
/// alimentan: la caída de tensión no pasa por él.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SpliceIssue {
    /// Dos o más cables sin consumo (ej. dos pines en paralelo que lo
    /// alimentan): no se puede saber cómo se reparte la corriente entre ellos.
    MissingLoads { splice_id: i64, wire_ids: Vec<i64> },
    /// Todos tienen consumo, pero ningún cable, ni grupo de cables en paralelo,
    /// lleva la suma del resto.
    Unbalanced { splice_id: i64 },
    /// Dos grupos distintos llevan lo mismo que el resto, con la misma cantidad
    /// de cables, y no se sabe cuál alimenta (se resuelve cargando la protección
    /// en los que alimentan).
    UnknownFeed { splice_id: i64 },
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ElectricalReport {
    pub wires: Vec<WireElectrical>,
    /// Solo las vías con alguna corriente.
    pub cavities: Vec<CavityElectrical>,
    pub splice_issues: Vec<SpliceIssue>,
}

/// Diferencia que se tolera entre el que alimenta un splice y la suma de los
/// otros: 0,05 A o el 1 %, lo que sea mayor (redondeos al cargar).
fn tolerance_a(current: f64) -> f64 {
    (current * 0.01).max(0.05)
}

fn splice_of(end: &WireEnd) -> Option<i64> {
    (end.kind == "splice").then_some(end.splice_id).flatten()
}

fn cavity_of(end: &WireEnd) -> Option<i64> {
    (end.kind == "cavity")
        .then_some(end.cavity_assignment_id)
        .flatten()
}

/// Cables de cada splice, sin repetir (un cable con las dos puntas en el mismo
/// splice es un lazo: no lleva corriente de un lado al otro y no cuenta).
fn wires_by_splice(data: &ProjectData) -> BTreeMap<i64, Vec<i64>> {
    let mut map: BTreeMap<i64, Vec<i64>> = BTreeMap::new();
    for w in &data.wire_instances {
        let (a, b) = (splice_of(&w.end_a), splice_of(&w.end_b));
        if a.is_some() && a == b {
            continue;
        }
        for s in [a, b].into_iter().flatten() {
            map.entry(s).or_default().push(w.id);
        }
    }
    map
}

/// Consumo de cada cable: el cargado y, splice por splice, el deducido. Devuelve
/// también de qué splice salió cada deducido.
fn loads(
    data: &ProjectData,
    by_splice: &BTreeMap<i64, Vec<i64>>,
) -> (HashMap<i64, f64>, HashMap<i64, i64>) {
    let mut load: HashMap<i64, f64> = data
        .wire_instances
        .iter()
        .filter_map(|w| w.load_current_a.map(|a| (w.id, a)))
        .collect();
    let mut from_splice: HashMap<i64, i64> = HashMap::new();
    loop {
        let mut changed = false;
        for (&splice, wires) in by_splice {
            let unknown: Vec<i64> = wires
                .iter()
                .copied()
                .filter(|w| !load.contains_key(w))
                .collect();
            if wires.len() >= 2 && unknown.len() == 1 {
                let sum = wires.iter().filter_map(|w| load.get(w)).sum();
                load.insert(unknown[0], sum);
                from_splice.insert(unknown[0], splice);
                changed = true;
            }
        }
        if !changed {
            return (load, from_splice);
        }
    }
}

/// Más cables que esto en un splice no se prueban de a grupos (2ⁿ combinaciones):
/// el que alimenta tiene que ser el deducido. En un arnés no pasa (un splice
/// junta, a lo sumo, una docena).
const MAX_WIRES_TO_SPLIT: usize = 16;

/// Lo que se sabe de cada splice.
enum SpliceSide {
    /// Los cables que lo alimentan (uno, o varios en paralelo).
    Fed(Vec<i64>),
    /// No se sabe; se avisa.
    Issue(SpliceIssue),
    /// Ningún consumo cargado, o un solo cable: no hay nada que calcular ni avisar.
    Unknown,
}

/// Qué cables alimentan el splice (ver las reglas arriba del archivo).
fn splice_side(
    splice_id: i64,
    wires: &[i64],
    load: &HashMap<i64, f64>,
    from_splice: &HashMap<i64, i64>,
    hand_protected: &HashSet<i64>,
) -> SpliceSide {
    let mut missing: Vec<i64> = wires
        .iter()
        .copied()
        .filter(|w| !load.contains_key(w))
        .collect();
    if wires.len() < 2 || missing.len() == wires.len() {
        return SpliceSide::Unknown;
    }
    if !missing.is_empty() {
        missing.sort_unstable();
        return SpliceSide::Issue(SpliceIssue::MissingLoads {
            splice_id,
            wire_ids: missing,
        });
    }
    if let Some(&deduced) = wires
        .iter()
        .find(|w| from_splice.get(w) == Some(&splice_id))
    {
        return SpliceSide::Fed(vec![deduced]);
    }
    let n = wires.len();
    if n > MAX_WIRES_TO_SPLIT {
        return SpliceSide::Issue(SpliceIssue::UnknownFeed { splice_id });
    }
    let total: f64 = wires.iter().map(|w| load[w]).sum();
    // El mejor grupo que cierra: menos cables y, con empate, todos con su
    // protección cargada. `tied`: otro grupo distinto igual de bueno.
    let mut best: Option<((u32, bool), u32)> = None;
    let mut tied = false;
    for mask in 1..(1u32 << n) - 1 {
        let size = mask.count_ones();
        if size as usize * 2 > n {
            continue; // el lado de más cables: lo cubre su complemento
        }
        let in_group = |i: usize| mask & (1 << i) != 0;
        let group_a: f64 = (0..n)
            .filter(|&i| in_group(i))
            .map(|i| load[&wires[i]])
            .sum();
        if (group_a - (total - group_a)).abs() > tolerance_a(group_a) {
            continue;
        }
        let protected = (0..n)
            .filter(|&i| in_group(i))
            .all(|i| hand_protected.contains(&wires[i]));
        let key = (size, !protected);
        match best {
            Some((b, _)) if b < key => {}
            Some((b, _)) if b == key => tied = true,
            _ => {
                best = Some((key, mask));
                tied = false;
            }
        }
    }
    match best {
        None => SpliceSide::Issue(SpliceIssue::Unbalanced { splice_id }),
        // Dos cables con el mismo consumo: da igual cuál alimenta, la caída de
        // punta a punta es la misma.
        Some(_) if tied && n == 2 => SpliceSide::Fed(vec![*wires.iter().min().unwrap()]),
        Some(_) if tied => SpliceSide::Issue(SpliceIssue::UnknownFeed { splice_id }),
        Some((_, mask)) => SpliceSide::Fed(
            (0..n)
                .filter(|&i| mask & (1 << i) != 0)
                .map(|i| wires[i])
                .collect(),
        ),
    }
}

/// Circuitos para la protección: cables unidos por splices o por compartir una
/// vía. Devuelve, para cada cable, un representante de su circuito.
fn circuits(data: &ProjectData) -> HashMap<i64, i64> {
    let mut parent: HashMap<i64, i64> = data.wire_instances.iter().map(|w| (w.id, w.id)).collect();
    fn root(parent: &mut HashMap<i64, i64>, mut x: i64) -> i64 {
        while parent[&x] != x {
            let up = parent[&parent[&x]];
            parent.insert(x, up);
            x = up;
        }
        x
    }
    let mut first_at: HashMap<(char, i64), i64> = HashMap::new();
    for w in &data.wire_instances {
        for end in [&w.end_a, &w.end_b] {
            let key = splice_of(end)
                .map(|s| ('s', s))
                .or_else(|| cavity_of(end).map(|c| ('c', c)));
            let Some(key) = key else { continue };
            match first_at.get(&key) {
                Some(&other) => {
                    let (ra, rb) = (root(&mut parent, w.id), root(&mut parent, other));
                    parent.insert(ra.max(rb), ra.min(rb));
                }
                None => {
                    first_at.insert(key, w.id);
                }
            }
        }
    }
    data.wire_instances
        .iter()
        .map(|w| (w.id, root(&mut parent, w.id)))
        .collect()
}

/// Caída en el cable (V), si están el consumo, la resistencia y el largo.
fn wire_drop_v(
    load_a: Option<f64>,
    resistance_mohm_per_m: Option<f64>,
    cut_mm: Option<f64>,
) -> Option<f64> {
    Some(load_a? * resistance_mohm_per_m? / 1000.0 * cut_mm? / 1000.0)
}

/// Caída desde la fuente hasta la punta del cable: la suya más la de los cables
/// que lo alimentan, subiendo por los splices donde no es él el que alimenta;
/// con varios en paralelo, la del peor camino. `None` si a algún cable del
/// camino le falta un dato, o si el camino pasa por un splice sin definir (no se
/// sabe por dónde llega la corriente).
fn circuit_drop_v(
    wire_id: i64,
    by_id: &HashMap<i64, &WireInstance>,
    feeds: &HashMap<i64, Vec<i64>>,
    drop: &HashMap<i64, Option<f64>>,
    seen: &mut HashSet<i64>,
) -> Option<f64> {
    let own = drop[&wire_id]?;
    let wire = by_id[&wire_id];
    let mut upstream: f64 = 0.0;
    for s in [&wire.end_a, &wire.end_b].into_iter().filter_map(splice_of) {
        let group = feeds.get(&s)?;
        if group.contains(&wire_id) {
            continue; // por esta punta sale la corriente
        }
        for &feeder in group {
            if seen.insert(feeder) {
                upstream = upstream.max(circuit_drop_v(feeder, by_id, feeds, drop, seen)?);
            } // ya visto: lazo de splices (no es un árbol), se corta
        }
    }
    Some(own + upstream)
}

/// La carga eléctrica del proyecto. Dentro de una pasada de cálculo
/// (`with_cache`) se hace una vez: la usan la pantalla y los chequeos.
pub fn electrical_report(data: &ProjectData, library: &Library) -> ElectricalReport {
    if let Some(hit) = PASS.with(|c| c.borrow().as_ref().and_then(|p| p.electrical.clone())) {
        return hit;
    }
    let report = compute_electrical_report(data, library);
    PASS.with(|c| {
        if let Some(p) = c.borrow_mut().as_mut() {
            p.electrical = Some(report.clone());
        }
    });
    report
}

fn compute_electrical_report(data: &ProjectData, library: &Library) -> ElectricalReport {
    let by_splice = wires_by_splice(data);
    let (load, from_splice) = loads(data, &by_splice);
    let hand_protected: HashSet<i64> = data
        .wire_instances
        .iter()
        .filter(|w| w.protection_current_a.is_some())
        .map(|w| w.id)
        .collect();
    let mut feeds: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut splice_issues = Vec::new();
    for (&splice, wires) in &by_splice {
        match splice_side(splice, wires, &load, &from_splice, &hand_protected) {
            SpliceSide::Fed(group) => {
                feeds.insert(splice, group);
            }
            SpliceSide::Issue(issue) => splice_issues.push(issue),
            SpliceSide::Unknown => {}
        }
    }
    let circuit = circuits(data);
    let mut circuit_protection: HashMap<i64, f64> = HashMap::new();
    for w in &data.wire_instances {
        if let Some(p) = w.protection_current_a {
            let entry = circuit_protection.entry(circuit[&w.id]).or_insert(p);
            *entry = entry.max(p);
        }
    }
    let cut: HashMap<i64, f64> = cut_list(data, library)
        .into_iter()
        .map(|c| (c.wire_id, c.cut_length_mm))
        .collect();
    let def = |w: &WireInstance| wire_def_of(library, w);
    let drop: HashMap<i64, Option<f64>> = data
        .wire_instances
        .iter()
        .map(|w| {
            let r = def(w).and_then(|d| d.resistance_mohm_per_m);
            (
                w.id,
                wire_drop_v(load.get(&w.id).copied(), r, cut.get(&w.id).copied()),
            )
        })
        .collect();
    let feeding: HashSet<i64> = feeds.values().flatten().copied().collect();
    let by_id: HashMap<i64, &WireInstance> =
        data.wire_instances.iter().map(|w| (w.id, w)).collect();

    let wires = data
        .wire_instances
        .iter()
        .map(|w| {
            let d = def(w);
            WireElectrical {
                wire_id: w.id,
                load_a: load.get(&w.id).copied(),
                load_from_splice_id: from_splice.get(&w.id).copied(),
                protection_a: w
                    .protection_current_a
                    .or_else(|| circuit_protection.get(&circuit[&w.id]).copied()),
                protection_from_circuit: w.protection_current_a.is_none()
                    && circuit_protection.contains_key(&circuit[&w.id]),
                max_current_a: d.and_then(|d| d.max_current_a),
                resistance_mohm_per_m: d.and_then(|d| d.resistance_mohm_per_m),
                drop_v: drop[&w.id],
                circuit_drop_v: circuit_drop_v(
                    w.id,
                    &by_id,
                    &feeds,
                    &drop,
                    &mut HashSet::from([w.id]),
                ),
                ends_at_load: !feeding.contains(&w.id),
            }
        })
        .collect::<Vec<_>>();

    let by_wire: HashMap<i64, &WireElectrical> = wires.iter().map(|e| (e.wire_id, e)).collect();
    let mut cavities = Vec::new();
    for connector in &data.connector_instances {
        for cavity in &connector.cavities {
            let in_cavity = wires_in_cavity(data, cavity);
            let loads: Vec<f64> = in_cavity
                .iter()
                .filter_map(|w| by_wire[&w.id].load_a)
                .collect();
            let protection_a = in_cavity
                .iter()
                .filter_map(|w| by_wire[&w.id].protection_a)
                .reduce(f64::max);
            if loads.is_empty() && protection_a.is_none() {
                continue;
            }
            let contact_part_id = cavity_contact(data, library, connector, cavity);
            cavities.push(CavityElectrical {
                cavity_assignment_id: cavity.id,
                connector_instance_id: connector.id,
                load_a: (!loads.is_empty()).then(|| loads.iter().sum()),
                protection_a,
                contact_part_id,
                max_current_a: contact_part_id.and_then(|id| {
                    library
                        .contact_defs
                        .iter()
                        .find(|c| c.part_id == id)
                        .and_then(|c| c.max_current_a)
                }),
            });
        }
    }

    ElectricalReport {
        wires,
        cavities,
        splice_issues,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calc::test_fixtures::*;

    fn wire(id: i64, a: WireEnd, b: WireEnd, length_mm: f64) -> WireInstance {
        WireInstance {
            id,
            short_id: format!("W{id:03}"),
            library_part_id: 100,
            manual_length_mm: Some(length_mm),
            end_a: a,
            end_b: b,
            ..one_segment_project(1000.0, None).wire_instances[0].clone()
        }
    }

    /// Un 12V+ que sale de X1:1 (W1, 1 m) a SP1 y de ahí a dos cargas (W2 y W3,
    /// 2 m cada uno). El tipo de cable: 22 AWG, 5 A, 53,15 mΩ/m.
    fn feed_and_two_loads() -> (ProjectData, Library) {
        let mut data = one_segment_project(1000.0, None);
        data.wire_instances = vec![
            wire(1, cavity_end(1), splice_end(1), 1000.0),
            wire(2, splice_end(1), cavity_end(2), 2000.0),
            wire(3, splice_end(1), cavity_end(3), 2000.0),
        ];
        let mut library = Library::default();
        library.wire_defs.push(crate::model::library::WireDef {
            max_current_a: Some(5.0),
            resistance_mohm_per_m: Some(53.15),
            ..wire_def(100, 1.1, None)
        });
        (data, library)
    }

    fn of(report: &ElectricalReport, id: i64) -> &WireElectrical {
        report.wires.iter().find(|w| w.wire_id == id).unwrap()
    }

    #[test]
    fn the_wire_feeding_a_splice_takes_the_sum_of_the_loads() {
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances[1].load_current_a = Some(1.2);
        data.wire_instances[2].load_current_a = Some(3.0);
        let report = electrical_report(&data, &library);
        assert_eq!(of(&report, 1).load_a, Some(4.2));
        assert_eq!(of(&report, 1).load_from_splice_id, Some(1));
        assert_eq!(of(&report, 2).load_from_splice_id, None);
        assert!(!of(&report, 1).ends_at_load);
        assert!(of(&report, 2).ends_at_load);
        assert!(report.splice_issues.is_empty());
    }

    #[test]
    fn the_drop_adds_the_wires_from_the_source_to_each_load() {
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances[1].load_current_a = Some(1.2);
        data.wire_instances[2].load_current_a = Some(3.0);
        let report = electrical_report(&data, &library);
        let r = 53.15 / 1000.0;
        let w1 = 4.2 * r * 1.0;
        let w3 = 3.0 * r * 2.0;
        assert!((of(&report, 1).drop_v.unwrap() - w1).abs() < 1e-9);
        assert!((of(&report, 3).drop_v.unwrap() - w3).abs() < 1e-9);
        // En la carga de W3: W3 + W1 (0,32 + 0,22 V).
        assert!((of(&report, 3).circuit_drop_v.unwrap() - (w3 + w1)).abs() < 1e-9);
        // El que alimenta el splice: solo la suya.
        assert!((of(&report, 1).circuit_drop_v.unwrap() - w1).abs() < 1e-9);
    }

    #[test]
    fn splices_in_a_chain_are_deduced_one_after_the_other() {
        // X1:1 -W1- SP1 -W2- SP2 -W3- X1:2, y de SP1 sale W4 (1 A), de SP2 W5 (2 A).
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances = vec![
            wire(1, cavity_end(1), splice_end(1), 1000.0),
            wire(2, splice_end(1), splice_end(2), 1000.0),
            wire(3, splice_end(2), cavity_end(2), 1000.0),
            wire(4, splice_end(1), cavity_end(3), 1000.0),
            wire(5, splice_end(2), cavity_end(4), 1000.0),
        ];
        data.wire_instances[2].load_current_a = Some(0.5);
        data.wire_instances[3].load_current_a = Some(1.0);
        data.wire_instances[4].load_current_a = Some(2.0);
        let report = electrical_report(&data, &library);
        assert_eq!(of(&report, 2).load_a, Some(2.5));
        assert_eq!(of(&report, 2).load_from_splice_id, Some(2));
        assert_eq!(of(&report, 1).load_a, Some(3.5));
        assert_eq!(of(&report, 1).load_from_splice_id, Some(1));
        // W3 se alimenta por W2 y W2 por W1: su caída suma los tres.
        let drops: f64 = [1, 2, 3]
            .iter()
            .map(|&id| of(&report, id).drop_v.unwrap())
            .sum();
        assert!((of(&report, 3).circuit_drop_v.unwrap() - drops).abs() < 1e-9);
    }

    #[test]
    fn with_two_wires_missing_nothing_is_guessed() {
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances[1].load_current_a = Some(1.2);
        let report = electrical_report(&data, &library);
        assert_eq!(of(&report, 1).load_a, None);
        assert_eq!(of(&report, 3).load_a, None);
        assert_eq!(
            of(&report, 2).circuit_drop_v,
            None,
            "falta el consumo de quien lo alimenta"
        );
        assert_eq!(
            report.splice_issues,
            vec![SpliceIssue::MissingLoads {
                splice_id: 1,
                wire_ids: vec![1, 3]
            }]
        );
    }

    /// SP1 alimentado por dos pines en paralelo (W1 y W4, 1 m cada uno) que
    /// reparte a las cargas `loads` (W2, W3, …, 2 m cada una).
    fn two_feeds(loads: &[f64]) -> (ProjectData, Library) {
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances.truncate(1);
        for (i, &a) in loads.iter().enumerate() {
            let id = i as i64 + 2;
            let mut w = wire(id, splice_end(1), cavity_end(id), 2000.0);
            w.load_current_a = Some(a);
            data.wire_instances.push(w);
        }
        let id = loads.len() as i64 + 2;
        data.wire_instances
            .push(wire(id, cavity_end(1), splice_end(1), 1000.0));
        (data, library)
    }

    fn set_load(data: &mut ProjectData, id: i64, a: f64) {
        let w = data.wire_instances.iter_mut().find(|w| w.id == id).unwrap();
        w.load_current_a = Some(a);
    }

    #[test]
    fn two_feeds_in_parallel_are_found_when_their_share_is_set_by_hand() {
        // Cuatro bobinas de 2 A por dos pines (W1 y W6): sin su parte, no se sabe.
        let (mut data, library) = two_feeds(&[2.0, 2.0, 2.0, 2.0]);
        let report = electrical_report(&data, &library);
        assert_eq!(
            report.splice_issues,
            vec![SpliceIssue::MissingLoads {
                splice_id: 1,
                wire_ids: vec![1, 6]
            }]
        );
        assert_eq!(of(&report, 2).circuit_drop_v, None);
        // La mitad cada uno: el grupo de dos que lleva lo que las cuatro bobinas.
        set_load(&mut data, 1, 4.0);
        set_load(&mut data, 6, 4.0);
        let report = electrical_report(&data, &library);
        assert!(
            report.splice_issues.is_empty(),
            "{:?}",
            report.splice_issues
        );
        assert!(!of(&report, 1).ends_at_load && !of(&report, 6).ends_at_load);
        assert!(of(&report, 2).ends_at_load);
        // En cada bobina: la suya más la de un pin (los dos iguales).
        let expected = of(&report, 2).drop_v.unwrap() + of(&report, 1).drop_v.unwrap();
        assert!((of(&report, 2).circuit_drop_v.unwrap() - expected).abs() < 1e-9);
    }

    #[test]
    fn two_groups_that_both_add_up_need_the_protection_to_tell_the_feed() {
        // Dos pines de 2 A y cargas de 1 A y 3 A: {W1, W4} y {W2, W3} cierran igual.
        let (mut data, library) = two_feeds(&[1.0, 3.0]);
        set_load(&mut data, 1, 2.0);
        set_load(&mut data, 4, 2.0);
        let report = electrical_report(&data, &library);
        assert_eq!(
            report.splice_issues,
            vec![SpliceIssue::UnknownFeed { splice_id: 1 }]
        );
        assert_eq!(of(&report, 3).circuit_drop_v, None, "no se adivina");
        // Con la protección del PDM en los dos pines, son ellos.
        for w in data
            .wire_instances
            .iter_mut()
            .filter(|w| [1, 4].contains(&w.id))
        {
            w.protection_current_a = Some(8.0);
        }
        let report = electrical_report(&data, &library);
        assert!(
            report.splice_issues.is_empty(),
            "{:?}",
            report.splice_issues
        );
        assert!(of(&report, 3).ends_at_load && !of(&report, 4).ends_at_load);
        let expected = of(&report, 3).drop_v.unwrap() + of(&report, 1).drop_v.unwrap();
        assert!((of(&report, 3).circuit_drop_v.unwrap() - expected).abs() < 1e-9);
    }

    #[test]
    fn a_splice_joining_two_wires_works_either_way() {
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances.truncate(2);
        data.wire_instances[0].load_current_a = Some(3.0);
        data.wire_instances[1].load_current_a = Some(3.0);
        let report = electrical_report(&data, &library);
        assert!(report.splice_issues.is_empty());
        let total = of(&report, 1).drop_v.unwrap() + of(&report, 2).drop_v.unwrap();
        assert!((of(&report, 2).circuit_drop_v.unwrap() - total).abs() < 1e-9);
    }

    #[test]
    fn loads_that_dont_add_up_at_a_splice_are_reported() {
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances[0].load_current_a = Some(8.0);
        data.wire_instances[1].load_current_a = Some(1.2);
        data.wire_instances[2].load_current_a = Some(3.0);
        let report = electrical_report(&data, &library);
        assert_eq!(
            report.splice_issues,
            vec![SpliceIssue::Unbalanced { splice_id: 1 }]
        );
        assert_eq!(of(&report, 2).circuit_drop_v, None);
        // Dentro de la tolerancia (0,05 A), no.
        data.wire_instances[0].load_current_a = Some(4.23);
        assert!(electrical_report(&data, &library).splice_issues.is_empty());
    }

    #[test]
    fn the_protection_of_a_circuit_reaches_its_wires_unless_they_have_their_own() {
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances[0].protection_current_a = Some(20.0);
        data.wire_instances[2].protection_current_a = Some(5.0); // ramal con su fusible
        data.wire_instances
            .push(wire(4, cavity_end(4), cavity_end(5), 500.0)); // otro circuito
        let report = electrical_report(&data, &library);
        assert_eq!(of(&report, 1).protection_a, Some(20.0));
        assert!(!of(&report, 1).protection_from_circuit);
        assert_eq!(of(&report, 2).protection_a, Some(20.0));
        assert!(of(&report, 2).protection_from_circuit);
        assert_eq!(of(&report, 3).protection_a, Some(5.0));
        assert_eq!(of(&report, 4).protection_a, None);
    }

    #[test]
    fn wires_sharing_a_pin_are_one_circuit_and_add_up_in_the_contact() {
        // Dos cables en X1:1 (un canal del PDM con dos salidas), 2 A y 3 A.
        let (mut data, mut library) = feed_and_two_loads();
        data.wire_instances = vec![
            wire(1, cavity_end(1), cavity_end(2), 1000.0),
            wire(2, cavity_end(1), cavity_end(3), 1000.0),
        ];
        data.wire_instances[0].load_current_a = Some(2.0);
        data.wire_instances[1].load_current_a = Some(3.0);
        data.wire_instances[0].protection_current_a = Some(8.0);
        library
            .contact_defs
            .push(crate::model::library::ContactDef {
                part_id: 200,
                gender: "female".into(),
                contact_size: "20".into(),
                gauge_min: None,
                gauge_max: None,
                max_current_a: Some(7.5),
            });
        let x1 = data.connector_instances[0].library_part_id;
        library
            .connector_defs
            .push(crate::model::library::ConnectorDef {
                contact_part_id: Some(200),
                ..crate::calc::test_fixtures::connector_def_with_series(x1, "DTM", "DTM")
            });
        let report = electrical_report(&data, &library);
        assert_eq!(
            of(&report, 2).protection_a,
            Some(8.0),
            "mismo circuito por la vía"
        );
        let pin = report
            .cavities
            .iter()
            .find(|c| c.cavity_assignment_id == 1)
            .unwrap();
        assert_eq!(pin.load_a, Some(5.0));
        assert_eq!(pin.protection_a, Some(8.0));
        assert_eq!(pin.max_current_a, Some(7.5));
    }

    #[test]
    fn a_wire_type_without_resistance_leaves_the_drop_empty() {
        let (mut data, mut library) = feed_and_two_loads();
        library.wire_defs[0].resistance_mohm_per_m = None;
        data.wire_instances[1].load_current_a = Some(1.0);
        let report = electrical_report(&data, &library);
        assert_eq!(of(&report, 2).load_a, Some(1.0));
        assert_eq!(of(&report, 2).drop_v, None);
    }
}
