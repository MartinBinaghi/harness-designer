//! Carga eléctrica: corriente de cada cable, caída de tensión de cada circuito y
//! corriente de cada contacto (pedido de Martin del 2026-11-16; la fuente por
//! vía, del 2026-11-18).
//!
//! Cada cable puede tener dos corrientes cargadas a mano:
//! - el **consumo** de lo que alimenta: para la caída de tensión y la corriente
//!   que de verdad pasa;
//! - el **límite de la protección** que lo alimenta (canal del PDM, fusible): el
//!   cable y el contacto lo tienen que aguantar, porque es lo que la protección
//!   deja pasar antes de cortar.
//!
//! Reglas:
//! - **Sentido de la corriente:** sale de las vías marcadas como **fuente** (la
//!   salida del PDM, el pin que trae el 12V de otro arnés) y vuelve a las masas,
//!   que también cuentan como fuente (el cable a un ojal lleva la suma del
//!   retorno). Cada cable va desde su punta más cercana a una fuente, contando
//!   cables. Si sus dos puntas quedan igual de cerca (dos fuentes, o un lazo de
//!   cables) o su circuito no tiene fuente, no tiene sentido conocido.
//! - **Consumo en un splice:** lo que entra es lo que sale. Con el consumo de
//!   todos los que salen, el único cable que entra sin consumo toma la suma; si
//!   entran varios en paralelo (una salida del PDM en dos pines), el que falta
//!   toma la diferencia. Se repite hasta que no se deduce nada más, así sigue por
//!   splices encadenados. Lo que no se puede saber se avisa (`SpliceIssue`) y no
//!   se adivina: sin fuente, con cables que salen sin consumo, con varios en
//!   paralelo sin su parte, o si no cierra.
//! - **Protección de un circuito** (cables unidos por splices o por compartir
//!   una vía): un cable sin protección cargada toma la mayor de su circuito, lo
//!   más exigente para los cables (un ramal con su propio fusible lleva el suyo).
//! - **Cable suelto** (una punta "suelta en un nodo", ej. uno de repuesto): no
//!   lleva corriente, cuenta 0 A sin cargarlo.
//! - **Caída de tensión:** consumo × resistencia del conductor × largo de corte.
//!   La de un circuito, en la punta de cada cable, es la suya más la de los
//!   cables que lo alimentan, splice por splice hasta la fuente; con varios en
//!   paralelo, la del peor camino. También sigue por una **vía con varios
//!   cables** que no es la fuente (un puente en el contacto: de ahí la corriente
//!   sigue a otro equipo); como lo que consume el equipo de esa vía no se sabe, el
//!   consumo del que la alimenta se carga a mano y no se deduce. La resistencia es a 20 °C (como la tabla de la
//!   FAA de donde salen los valores de la base).
//! - **Contacto:** por él pasan todos los cables de su vía: su consumo es la
//!   suma, y su protección la mayor de ellos.
//!
//! Las masas no unen circuitos (cada cable a un ojal es su propio retorno) y los
//! componentes tampoco: una resistencia de terminación no es un empalme.

use super::capacity::{segment_loads, wire_capacity, BundleAt, CapacityLimit};
use super::{cut_list, wire_def_of, PASS};
use crate::contacts::{cavity_contact, wires_in_cavity};
use crate::model::library::Library;
use crate::model::project::{ProjectData, WireEnd, WireInstance};
use crate::topology::{connection_point, ConnectionPoint};
use serde::{Deserialize, Serialize};
use std::collections::{hash_map::Entry, BTreeMap, HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WireElectrical {
    pub wire_id: i64,
    /// Consumo (A): el cargado, o el deducido en un splice.
    pub load_a: Option<f64>,
    /// Si el consumo se dedujo: el splice al que alimenta.
    pub load_from_splice_id: Option<i64>,
    /// Límite de la protección que lo alimenta (A): el cargado o el de su circuito.
    pub protection_a: Option<f64>,
    /// La protección no se cargó en este cable: es la de su circuito.
    pub protection_from_circuit: bool,
    /// Capacidad donde pasa (A): la de su tipo de cable al aire, con la
    /// temperatura del arnés y el mazo más exigente de su recorrido
    /// (`calc::capacity`); `None` con `capacity_limit` diciendo por qué.
    pub max_current_a: Option<f64>,
    pub capacity_limit: Option<CapacityLimit>,
    /// El mazo que limita la capacidad.
    pub bundle: Option<BundleAt>,
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

/// Un splice con algún consumo donde no se puede saber cuánto lleva cada cable:
/// la caída de tensión no pasa por él.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SpliceIssue {
    /// Su circuito no tiene ninguna vía marcada como fuente (ni una masa): no se
    /// sabe por dónde entra la corriente.
    NoSource { splice_id: i64 },
    /// La corriente le llega por más de un lado (dos fuentes, o un lazo de
    /// cables): no se sabe cómo se reparte.
    SeveralWays { splice_id: i64 },
    /// Cables que salen del splice hacia lo que alimenta, sin consumo: no se
    /// puede sumar lo que entra.
    MissingLoads { splice_id: i64, wire_ids: Vec<i64> },
    /// Lo alimentan varios cables en paralelo y a más de uno le falta su parte.
    MissingShare { splice_id: i64, wire_ids: Vec<i64> },
    /// Lo que entra (`in_a`, los que lo alimentan con consumo) no es lo que sale.
    Unbalanced {
        splice_id: i64,
        in_a: f64,
        out_a: f64,
    },
}

/// Una vía con varios cables, después de la fuente, a la que le llega la
/// corriente por cables sin consumo (`wire_ids`): la caída no sigue de largo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PinIssue {
    pub cavity_assignment_id: i64,
    pub wire_ids: Vec<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ElectricalReport {
    pub wires: Vec<WireElectrical>,
    /// Solo las vías con alguna corriente.
    pub cavities: Vec<CavityElectrical>,
    pub splice_issues: Vec<SpliceIssue>,
    pub pin_issues: Vec<PinIssue>,
}

/// Diferencia que se tolera entre lo que entra a un splice y lo que sale: 0,05 A
/// o el 1 %, lo que sea mayor (redondeos al cargar).
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

/// Dónde se juntan puntas de cables para la carga eléctrica: los componentes no
/// cuentan (no unen circuitos).
fn electrical_point(end: &WireEnd) -> Option<ConnectionPoint> {
    connection_point(end).filter(|p| !matches!(p, ConnectionPoint::Component(_)))
}

/// Un cable con una punta suelta (no llega a nada): no lleva corriente.
fn is_loose(w: &WireInstance) -> bool {
    w.end_a.kind == "loose" || w.end_b.kind == "loose"
}

/// Cables de cada splice (o vía, según `point`), sin repetir: un cable con las
/// dos puntas en el mismo lugar es un lazo, no lleva corriente de un lado al
/// otro y no cuenta.
fn wires_at(data: &ProjectData, point: fn(&WireEnd) -> Option<i64>) -> BTreeMap<i64, Vec<i64>> {
    let mut map: BTreeMap<i64, Vec<i64>> = BTreeMap::new();
    for w in &data.wire_instances {
        let (a, b) = (point(&w.end_a), point(&w.end_b));
        if a.is_some() && a == b {
            continue;
        }
        for s in [a, b].into_iter().flatten() {
            map.entry(s).or_default().push(w.id);
        }
    }
    map
}

/// Hacia dónde va la corriente: de qué punta viene cada cable y a cuál llega
/// (`None`: una punta que no es un punto, como un componente o una punta suelta).
type Flow = (Option<ConnectionPoint>, Option<ConnectionPoint>);

/// El sentido de cada cable que lo tiene, y a cuántos cables de una fuente está
/// cada punto (los que no están en el mapa no tienen fuente en su circuito).
fn flows(data: &ProjectData) -> (HashMap<i64, Flow>, HashMap<ConnectionPoint, usize>) {
    let mut around: HashMap<ConnectionPoint, Vec<ConnectionPoint>> = HashMap::new();
    for w in &data.wire_instances {
        if let (Some(a), Some(b)) = (electrical_point(&w.end_a), electrical_point(&w.end_b)) {
            if a != b {
                around.entry(a).or_default().push(b);
                around.entry(b).or_default().push(a);
            }
        }
    }
    let sources = data
        .connector_instances
        .iter()
        .flat_map(|c| &c.cavities)
        .filter(|cav| cav.is_source)
        .map(|cav| ConnectionPoint::Cavity(cav.id))
        .chain(
            data.ground_points
                .iter()
                .map(|g| ConnectionPoint::Ground(g.id)),
        );
    let mut distance: HashMap<ConnectionPoint, usize> = HashMap::new();
    let mut queue = VecDeque::new();
    for s in sources {
        if distance.insert(s, 0).is_none() {
            queue.push_back(s);
        }
    }
    while let Some(p) = queue.pop_front() {
        let next = distance[&p] + 1;
        for &q in around.get(&p).into_iter().flatten() {
            if let Entry::Vacant(e) = distance.entry(q) {
                e.insert(next);
                queue.push_back(q);
            }
        }
    }
    let flow = data
        .wire_instances
        .iter()
        .filter_map(|w| {
            let (a, b) = (electrical_point(&w.end_a), electrical_point(&w.end_b));
            let far = |p: Option<ConnectionPoint>| p.and_then(|p| distance.get(&p).copied());
            let towards_b = match (far(a), far(b)) {
                (Some(x), Some(y)) if x != y => x < y,
                // La otra punta no es un punto (si lo fuera, estaría tan unida a
                // una fuente como esta).
                (Some(_), None) => true,
                (None, Some(_)) => false,
                _ => return None, // igual de cerca, o sin fuente
            };
            Some((w.id, if towards_b { (a, b) } else { (b, a) }))
        })
        .collect();
    (flow, distance)
}

/// Los cables de un splice según el sentido de la corriente.
struct SpliceSides {
    /// Los que entran: lo alimentan (uno, o varios en paralelo).
    feeders: Vec<i64>,
    /// Los que salen hacia lo que alimenta.
    outs: Vec<i64>,
    /// Algún cable sin sentido conocido.
    undirected: bool,
    /// El splice está unido a alguna fuente.
    reached: bool,
}

fn splice_sides(
    by_splice: &BTreeMap<i64, Vec<i64>>,
    flow: &HashMap<i64, Flow>,
    distance: &HashMap<ConnectionPoint, usize>,
) -> BTreeMap<i64, SpliceSides> {
    by_splice
        .iter()
        .filter(|(_, wires)| wires.len() >= 2)
        .map(|(&s, wires)| {
            let here = ConnectionPoint::Splice(s);
            let mut sides = SpliceSides {
                feeders: Vec::new(),
                outs: Vec::new(),
                undirected: false,
                reached: distance.contains_key(&here),
            };
            for &w in wires {
                match flow.get(&w) {
                    Some((_, to)) if *to == Some(here) => sides.feeders.push(w),
                    Some(_) => sides.outs.push(w),
                    None => sides.undirected = true,
                }
            }
            (s, sides)
        })
        .collect()
}

/// Suma de los consumos, si todos lo tienen.
fn sum_of(wires: &[i64], load: &HashMap<i64, f64>) -> Option<f64> {
    wires.iter().map(|w| load.get(w).copied()).sum()
}

/// Consumo de cada cable: el cargado y, splice por splice, el deducido. Devuelve
/// también a qué splice alimenta cada deducido.
fn loads(
    data: &ProjectData,
    sides: &BTreeMap<i64, SpliceSides>,
) -> (HashMap<i64, f64>, HashMap<i64, i64>) {
    let mut load: HashMap<i64, f64> = data
        .wire_instances
        .iter()
        .filter_map(|w| {
            let a = w.load_current_a.or_else(|| is_loose(w).then_some(0.0));
            a.map(|a| (w.id, a))
        })
        .collect();
    let mut from_splice: HashMap<i64, i64> = HashMap::new();
    loop {
        let mut changed = false;
        for (&splice, side) in sides {
            if side.undirected || side.outs.is_empty() {
                continue;
            }
            let Some(out) = sum_of(&side.outs, &load) else {
                continue;
            };
            let missing: Vec<i64> = side
                .feeders
                .iter()
                .copied()
                .filter(|w| !load.contains_key(w))
                .collect();
            let [only] = missing[..] else { continue };
            let known: f64 = side.feeders.iter().filter_map(|w| load.get(w)).sum();
            let rest = out - known;
            if rest >= -tolerance_a(out) {
                load.insert(only, rest.max(0.0));
                from_splice.insert(only, splice);
                changed = true;
            }
        }
        if !changed {
            return (load, from_splice);
        }
    }
}

/// Lo que no se puede saber de un splice con algún consumo; `None` si quedó
/// definido (o si no tiene ningún consumo: no hay nada que calcular ni avisar).
fn splice_issue(
    splice_id: i64,
    wires: &[i64],
    side: &SpliceSides,
    load: &HashMap<i64, f64>,
) -> Option<SpliceIssue> {
    if !wires.iter().any(|w| load.contains_key(w)) {
        return None;
    }
    if side.undirected {
        return Some(if side.reached {
            SpliceIssue::SeveralWays { splice_id }
        } else {
            SpliceIssue::NoSource { splice_id }
        });
    }
    let without = |wires: &[i64]| -> Vec<i64> {
        let mut v: Vec<i64> = wires
            .iter()
            .copied()
            .filter(|w| !load.contains_key(w))
            .collect();
        v.sort_unstable();
        v
    };
    let missing_out = without(&side.outs);
    if !missing_out.is_empty() {
        return Some(SpliceIssue::MissingLoads {
            splice_id,
            wire_ids: missing_out,
        });
    }
    let missing_feed = without(&side.feeders);
    if missing_feed.len() >= 2 {
        return Some(SpliceIssue::MissingShare {
            splice_id,
            wire_ids: missing_feed,
        });
    }
    let out = sum_of(&side.outs, load).unwrap_or(0.0);
    let fed = side.feeders.iter().filter_map(|w| load.get(w)).sum::<f64>();
    // Uno solo sin consumo que no se dedujo: los otros ya llevan más de lo que sale.
    if !missing_feed.is_empty() || (fed - out).abs() > tolerance_a(out) {
        return Some(SpliceIssue::Unbalanced {
            splice_id,
            in_a: fed,
            out_a: out,
        });
    }
    None
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

/// Lo que hace falta para subir desde un cable hasta la fuente.
struct Upstream<'a> {
    flow: &'a HashMap<i64, Flow>,
    /// Los cables que alimentan cada splice definido.
    feeds: &'a HashMap<i64, Vec<i64>>,
    /// Los que alimentan cada vía con varios cables después de la fuente;
    /// `None` si alguno de sus cables no tiene sentido conocido.
    pin_feeds: &'a HashMap<i64, Option<Vec<i64>>>,
    drop: &'a HashMap<i64, Option<f64>>,
    /// Cables con alguna punta en un splice.
    at_splice: &'a HashSet<i64>,
}

/// Caída desde la fuente hasta la punta del cable: la suya más la de los cables
/// que alimentan el splice (o la vía con varios cables) de donde viene, hasta la
/// fuente; con varios en paralelo, la del peor camino. `None` si a algún cable
/// del camino le falta un dato o el camino pasa por un splice sin definir. Cada
/// paso sube hacia una fuente (el sentido sale de la distancia a ella), así que
/// termina siempre; `memo` guarda cada cable ya resuelto, para no repetir
/// caminos compartidos.
fn circuit_drop_v(
    wire_id: i64,
    up: &Upstream,
    memo: &mut HashMap<i64, Option<f64>>,
) -> Option<f64> {
    if let Some(&known) = memo.get(&wire_id) {
        return known;
    }
    let result = uncached_circuit_drop_v(wire_id, up, memo);
    memo.insert(wire_id, result);
    result
}

fn uncached_circuit_drop_v(
    wire_id: i64,
    up: &Upstream,
    memo: &mut HashMap<i64, Option<f64>>,
) -> Option<f64> {
    let own = up.drop[&wire_id]?;
    let feeders = match up.flow.get(&wire_id) {
        Some((Some(ConnectionPoint::Splice(s)), _)) => up.feeds.get(s)?,
        Some((Some(ConnectionPoint::Cavity(c)), _)) => match up.pin_feeds.get(c) {
            Some(group) => group.as_ref()?,
            None => return Some(own), // la fuente, o una vía con un solo cable
        },
        // Viene de una masa.
        Some(_) => return Some(own),
        // Sin sentido: solo se sabe si no pasa por ningún splice.
        None => return (!up.at_splice.contains(&wire_id)).then_some(own),
    };
    let mut worst: f64 = 0.0;
    for &feeder in feeders {
        worst = worst.max(circuit_drop_v(feeder, up, memo)?);
    }
    Some(own + worst)
}

/// Las vías con varios cables después de la fuente (un puente en el contacto):
/// qué cables la alimentan, y el aviso si alguno no tiene consumo y otro sí.
fn pin_feeds(
    data: &ProjectData,
    flow: &HashMap<i64, Flow>,
    distance: &HashMap<ConnectionPoint, usize>,
    load: &HashMap<i64, f64>,
) -> (HashMap<i64, Option<Vec<i64>>>, Vec<PinIssue>) {
    let mut feeds = HashMap::new();
    let mut issues = Vec::new();
    for (cavity, wires) in wires_at(data, cavity_of) {
        let here = ConnectionPoint::Cavity(cavity);
        // La fuente no tiene de dónde venir; una vía sin fuente, no se sabe.
        if wires.len() < 2 || distance.get(&here).is_none_or(|&d| d == 0) {
            continue;
        }
        let mut feeders = Vec::new();
        let mut undirected = false;
        for &w in &wires {
            match flow.get(&w) {
                Some((_, to)) if *to == Some(here) => feeders.push(w),
                Some(_) => {}
                None => undirected = true,
            }
        }
        if undirected {
            feeds.insert(cavity, None);
            continue;
        }
        let mut missing: Vec<i64> = feeders
            .iter()
            .copied()
            .filter(|w| !load.contains_key(w))
            .collect();
        if !missing.is_empty() && wires.iter().any(|w| load.contains_key(w)) {
            missing.sort_unstable();
            issues.push(PinIssue {
                cavity_assignment_id: cavity,
                wire_ids: missing,
            });
        }
        feeds.insert(cavity, Some(feeders));
    }
    (feeds, issues)
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
    let by_splice = wires_at(data, splice_of);
    let (flow, distance) = flows(data);
    let sides = splice_sides(&by_splice, &flow, &distance);
    let (load, from_splice) = loads(data, &sides);
    let mut feeds: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut splice_issues = Vec::new();
    for (&splice, side) in &sides {
        match splice_issue(splice, &by_splice[&splice], side, &load) {
            Some(issue) => splice_issues.push(issue),
            None if !side.undirected => {
                feeds.insert(splice, side.feeders.clone());
            }
            None => {}
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
    let (pin_feeds, pin_issues) = pin_feeds(data, &flow, &distance, &load);
    let at_splice: HashSet<i64> = by_splice.values().flatten().copied().collect();
    let up = Upstream {
        flow: &flow,
        feeds: &feeds,
        pin_feeds: &pin_feeds,
        drop: &drop,
        at_splice: &at_splice,
    };
    let mut memo = HashMap::new();

    // Un cable lleva corriente en su mazo si tiene consumo (cargado o deducido).
    let loads_by_segment = segment_loads(data, |w| load.get(&w).is_some_and(|&a| a > 0.0));
    let wires = data
        .wire_instances
        .iter()
        .map(|w| {
            let d = def(w);
            let (capacity, bundle) = wire_capacity(data, d, w, &loads_by_segment);
            let feeds_a_splice =
                matches!(flow.get(&w.id), Some((_, Some(ConnectionPoint::Splice(_)))));
            WireElectrical {
                wire_id: w.id,
                load_a: load.get(&w.id).copied(),
                load_from_splice_id: from_splice.get(&w.id).copied(),
                protection_a: w
                    .protection_current_a
                    .or_else(|| circuit_protection.get(&circuit[&w.id]).copied()),
                protection_from_circuit: w.protection_current_a.is_none()
                    && circuit_protection.contains_key(&circuit[&w.id]),
                max_current_a: capacity.ok(),
                capacity_limit: capacity.err(),
                bundle,
                resistance_mohm_per_m: d.and_then(|d| d.resistance_mohm_per_m),
                drop_v: drop[&w.id],
                circuit_drop_v: circuit_drop_v(w.id, &up, &mut memo),
                ends_at_load: !feeds_a_splice && !is_loose(w),
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
        pin_issues,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calc::test_fixtures::*;
    use crate::model::project::{CavityAssignment, GroundPoint};

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

    /// Marca la vía como fuente (la agrega a X1 si el proyecto de prueba no la tiene).
    fn source(data: &mut ProjectData, cavity_id: i64) {
        let found = data
            .connector_instances
            .iter_mut()
            .flat_map(|c| c.cavities.iter_mut())
            .find(|c| c.id == cavity_id);
        match found {
            Some(c) => c.is_source = true,
            None => data.connector_instances[0].cavities.push(CavityAssignment {
                id: cavity_id,
                cavity_id: format!("S{cavity_id}"),
                external_reference: None,
                is_source: true,
            }),
        }
    }

    fn ground_end(id: i64) -> WireEnd {
        WireEnd {
            kind: "ground".into(),
            ground_point_id: Some(id),
            splice_id: None,
            ..splice_end(0)
        }
    }

    /// Un 12V+ que sale de X1:1 (la fuente; W1, 1 m) a SP1 y de ahí a dos cargas
    /// (W2 y W3, 2 m cada uno; W3 con la punta A del lado de la carga: el sentido
    /// no depende de cuál es la A). El tipo de cable: 22 AWG, 5 A, 53,15 mΩ/m.
    fn feed_and_two_loads() -> (ProjectData, Library) {
        let mut data = one_segment_project(1000.0, None);
        data.wire_instances = vec![
            wire(1, cavity_end(1), splice_end(1), 1000.0),
            wire(2, splice_end(1), cavity_end(2), 2000.0),
            wire(3, cavity_end(3), splice_end(1), 2000.0),
        ];
        source(&mut data, 1);
        let mut library = Library::default();
        library.wire_defs.push(crate::model::library::WireDef {
            free_air_current_a: Some(10.0),
            max_temperature_c: Some(150.0),
            resistance_mohm_per_m: Some(53.15),
            ..wire_def(100, 1.1, None)
        });
        (data, library)
    }

    fn of(report: &ElectricalReport, id: i64) -> &WireElectrical {
        report.wires.iter().find(|w| w.wire_id == id).unwrap()
    }

    fn set_load(data: &mut ProjectData, id: i64, a: f64) {
        let w = data.wire_instances.iter_mut().find(|w| w.id == id).unwrap();
        w.load_current_a = Some(a);
    }

    #[test]
    fn the_wire_feeding_a_splice_takes_the_sum_of_the_loads() {
        let (mut data, library) = feed_and_two_loads();
        set_load(&mut data, 2, 1.2);
        set_load(&mut data, 3, 3.0);
        let report = electrical_report(&data, &library);
        assert_eq!(of(&report, 1).load_a, Some(4.2));
        assert_eq!(of(&report, 1).load_from_splice_id, Some(1));
        assert_eq!(of(&report, 2).load_from_splice_id, None);
        assert!(!of(&report, 1).ends_at_load);
        assert!(of(&report, 2).ends_at_load && of(&report, 3).ends_at_load);
        assert!(report.splice_issues.is_empty());
    }

    #[test]
    fn the_drop_adds_the_wires_from_the_source_to_each_load() {
        let (mut data, library) = feed_and_two_loads();
        set_load(&mut data, 2, 1.2);
        set_load(&mut data, 3, 3.0);
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
            wire(2, splice_end(2), splice_end(1), 1000.0),
            wire(3, splice_end(2), cavity_end(2), 1000.0),
            wire(4, splice_end(1), cavity_end(3), 1000.0),
            wire(5, splice_end(2), cavity_end(4), 1000.0),
        ];
        set_load(&mut data, 3, 0.5);
        set_load(&mut data, 4, 1.0);
        set_load(&mut data, 5, 2.0);
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
        assert!(report.splice_issues.is_empty());
    }

    #[test]
    fn a_load_left_empty_is_reported_and_never_taken_as_the_feed() {
        // W1 sale del PDM con 5 A cargados, W2 consume 2 A y W3, la otra carga,
        // quedó vacía. Antes del 2026-11-18, W3 tomaba 7 A como si alimentara.
        let (mut data, library) = feed_and_two_loads();
        set_load(&mut data, 1, 5.0);
        set_load(&mut data, 2, 2.0);
        let report = electrical_report(&data, &library);
        assert_eq!(of(&report, 3).load_a, None);
        assert_eq!(of(&report, 2).circuit_drop_v, None, "no se adivina");
        assert_eq!(
            report.splice_issues,
            vec![SpliceIssue::MissingLoads {
                splice_id: 1,
                wire_ids: vec![3]
            }]
        );
        set_load(&mut data, 3, 3.0);
        assert!(electrical_report(&data, &library).splice_issues.is_empty());
    }

    #[test]
    fn without_a_source_nothing_is_deduced() {
        let (mut data, library) = feed_and_two_loads();
        data.connector_instances[0].cavities[0].is_source = false;
        // Sin ningún consumo no hay nada que avisar.
        assert!(electrical_report(&data, &library).splice_issues.is_empty());
        set_load(&mut data, 2, 1.2);
        set_load(&mut data, 3, 3.0);
        let report = electrical_report(&data, &library);
        assert_eq!(of(&report, 1).load_a, None);
        assert_eq!(of(&report, 2).circuit_drop_v, None);
        assert!(of(&report, 2).drop_v.is_some(), "la de cada cable sí");
        assert_eq!(
            report.splice_issues,
            vec![SpliceIssue::NoSource { splice_id: 1 }]
        );
    }

    /// SP1 alimentado por dos pines en paralelo (W1 desde X1:1 y el último desde
    /// X1:9, las dos fuentes, 1 m cada uno) que reparte a las cargas `loads`
    /// (W2, W3, …, 2 m cada una). Devuelve también el id del segundo pin.
    fn two_feeds(loads: &[f64]) -> (ProjectData, Library, i64) {
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances.truncate(1);
        for (i, &a) in loads.iter().enumerate() {
            let id = i as i64 + 2;
            let mut w = wire(id, splice_end(1), cavity_end(10 + id), 2000.0);
            w.load_current_a = Some(a);
            data.wire_instances.push(w);
        }
        let other = loads.len() as i64 + 2;
        data.wire_instances
            .push(wire(other, cavity_end(9), splice_end(1), 1000.0));
        source(&mut data, 9);
        (data, library, other)
    }

    #[test]
    fn two_feeds_in_parallel_need_their_share_and_the_missing_one_takes_the_rest() {
        // Cinco bobinas de 2 A por dos pines (W1 y W7).
        let (mut data, library, other) = two_feeds(&[2.0; 5]);
        let report = electrical_report(&data, &library);
        assert_eq!(
            report.splice_issues,
            vec![SpliceIssue::MissingShare {
                splice_id: 1,
                wire_ids: vec![1, other]
            }]
        );
        assert_eq!(of(&report, 2).circuit_drop_v, None);
        // Con la parte de uno, el otro lleva lo que falta (antes: la suma, 15 A).
        set_load(&mut data, 1, 5.0);
        let report = electrical_report(&data, &library);
        assert!(
            report.splice_issues.is_empty(),
            "{:?}",
            report.splice_issues
        );
        assert_eq!(of(&report, other).load_a, Some(5.0));
        assert_eq!(of(&report, other).load_from_splice_id, Some(1));
        assert!(!of(&report, 1).ends_at_load && !of(&report, other).ends_at_load);
        assert!(of(&report, 2).ends_at_load);
        // En cada bobina: la suya más la de un pin (los dos iguales).
        let expected = of(&report, 2).drop_v.unwrap() + of(&report, 1).drop_v.unwrap();
        assert!((of(&report, 2).circuit_drop_v.unwrap() - expected).abs() < 1e-9);
    }

    #[test]
    fn parallel_feeds_from_the_same_wire_both_add_its_drop() {
        // X1:1 -W1 (1 m)- SP1 ={W2 0,1 m | W3 3 m, 2 A c/u}= SP2 -W4, W5 (2 A c/u).
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances = vec![
            wire(1, cavity_end(1), splice_end(1), 1000.0),
            wire(2, splice_end(1), splice_end(2), 100.0),
            wire(3, splice_end(2), splice_end(1), 3000.0),
            wire(4, splice_end(2), cavity_end(2), 1000.0),
            wire(5, splice_end(2), cavity_end(3), 1000.0),
        ];
        for id in 2..=5 {
            set_load(&mut data, id, 2.0);
        }
        let report = electrical_report(&data, &library);
        assert!(
            report.splice_issues.is_empty(),
            "{:?}",
            report.splice_issues
        );
        assert_eq!(of(&report, 1).load_a, Some(4.0));
        let d = |id| of(&report, id).drop_v.unwrap();
        // El peor camino es por W3, y también pasa por W1.
        let worst = d(4) + d(3) + d(1);
        assert!((of(&report, 4).circuit_drop_v.unwrap() - worst).abs() < 1e-9);
    }

    #[test]
    fn current_reaching_a_splice_from_two_sources_is_not_split_by_guess() {
        // X1:1 -W1- SP1 -W2- SP2 -W3- X1:4, con X1:1 y X1:4 fuentes: W2 queda
        // igual de cerca de las dos.
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances = vec![
            wire(1, cavity_end(1), splice_end(1), 1000.0),
            wire(2, splice_end(1), splice_end(2), 1000.0),
            wire(3, cavity_end(4), splice_end(2), 1000.0),
            wire(4, splice_end(1), cavity_end(2), 1000.0),
            wire(5, splice_end(2), cavity_end(3), 1000.0),
        ];
        source(&mut data, 4);
        set_load(&mut data, 4, 1.0);
        set_load(&mut data, 5, 1.0);
        let report = electrical_report(&data, &library);
        assert_eq!(
            report.splice_issues,
            vec![
                SpliceIssue::SeveralWays { splice_id: 1 },
                SpliceIssue::SeveralWays { splice_id: 2 }
            ]
        );
        assert_eq!(of(&report, 4).circuit_drop_v, None);
    }

    #[test]
    fn a_ground_return_takes_the_sum_on_the_wire_to_the_ring() {
        // Las masas de dos bobinas (2 y 3 A) a SP1, y de ahí W1 al ojal G1.
        let (mut data, library) = feed_and_two_loads();
        data.connector_instances[0].cavities[0].is_source = false;
        data.ground_points.push(GroundPoint {
            id: 1,
            short_id: "G1".into(),
            name: "Chassis".into(),
            terminal_library_part_id: None,
            node_id: 1,
        });
        data.wire_instances[0].end_a = ground_end(1);
        set_load(&mut data, 2, 2.0);
        set_load(&mut data, 3, 3.0);
        let report = electrical_report(&data, &library);
        assert!(
            report.splice_issues.is_empty(),
            "{:?}",
            report.splice_issues
        );
        assert_eq!(of(&report, 1).load_a, Some(5.0));
    }

    #[test]
    fn a_splice_joining_two_wires_carries_the_same_current() {
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances.truncate(2);
        set_load(&mut data, 2, 3.0);
        let report = electrical_report(&data, &library);
        assert!(report.splice_issues.is_empty());
        assert_eq!(of(&report, 1).load_a, Some(3.0));
        let total = of(&report, 1).drop_v.unwrap() + of(&report, 2).drop_v.unwrap();
        assert!((of(&report, 2).circuit_drop_v.unwrap() - total).abs() < 1e-9);
    }

    #[test]
    fn loads_that_dont_add_up_at_a_splice_are_reported() {
        let (mut data, library) = feed_and_two_loads();
        set_load(&mut data, 1, 8.0);
        set_load(&mut data, 2, 1.2);
        set_load(&mut data, 3, 3.0);
        let report = electrical_report(&data, &library);
        assert_eq!(
            report.splice_issues,
            vec![SpliceIssue::Unbalanced {
                splice_id: 1,
                in_a: 8.0,
                out_a: 4.2
            }]
        );
        assert_eq!(of(&report, 2).circuit_drop_v, None);
        // Dentro de la tolerancia (0,05 A), no.
        set_load(&mut data, 1, 4.23);
        assert!(electrical_report(&data, &library).splice_issues.is_empty());
        // Un paralelo que ya lleva más de lo que sale: el otro no se deduce negativo.
        let (mut data, library, other) = two_feeds(&[2.0, 2.0]);
        set_load(&mut data, 1, 5.0);
        let report = electrical_report(&data, &library);
        assert_eq!(of(&report, other).load_a, None);
        assert_eq!(
            report.splice_issues,
            vec![SpliceIssue::Unbalanced {
                splice_id: 1,
                in_a: 5.0,
                out_a: 4.0
            }]
        );
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
        set_load(&mut data, 1, 2.0);
        set_load(&mut data, 2, 3.0);
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
        // Sin splice, cada uno lleva lo suyo de punta a punta.
        assert!(report.splice_issues.is_empty());
        assert!(of(&report, 2).circuit_drop_v.is_some());
    }

    #[test]
    fn the_drop_goes_on_through_a_pin_with_several_wires() {
        // X1:1 (fuente) -W1 (2 m)- X2:1 -W2 (2 m)- X1:3: un puente en el contacto de X2.
        let (mut data, library) = feed_and_two_loads();
        data.wire_instances = vec![
            wire(1, cavity_end(1), cavity_end(2), 2000.0),
            wire(2, cavity_end(3), cavity_end(2), 2000.0),
        ];
        set_load(&mut data, 2, 3.0);
        let report = electrical_report(&data, &library);
        // Lo que consume X2 no se sabe: W1 no se deduce y se avisa.
        assert_eq!(of(&report, 1).load_a, None);
        assert_eq!(
            report.pin_issues,
            vec![PinIssue {
                cavity_assignment_id: 2,
                wire_ids: vec![1]
            }]
        );
        assert_eq!(of(&report, 2).circuit_drop_v, None, "no corta en 0 V");
        // X2 consume 1 A: W1 lleva 4 A y la caída en X1:3 suma los dos cables.
        set_load(&mut data, 1, 4.0);
        let report = electrical_report(&data, &library);
        assert!(report.pin_issues.is_empty());
        let total = of(&report, 1).drop_v.unwrap() + of(&report, 2).drop_v.unwrap();
        assert!((of(&report, 2).circuit_drop_v.unwrap() - total).abs() < 1e-9);
        assert!(of(&report, 1).ends_at_load, "X2 también es una carga");
        // Sin fuente marcada, cada cable lleva lo suyo, como antes.
        data.connector_instances[0].cavities[0].is_source = false;
        let report = electrical_report(&data, &library);
        assert!(report.pin_issues.is_empty());
        assert_eq!(of(&report, 2).circuit_drop_v, of(&report, 2).drop_v);
    }

    #[test]
    fn a_loose_spare_wire_out_of_a_splice_carries_nothing() {
        let (mut data, library) = feed_and_two_loads();
        let mut spare = wire(4, splice_end(1), cavity_end(0), 500.0);
        spare.end_b.kind = "loose".into();
        spare.end_b.cavity_assignment_id = None;
        data.wire_instances.push(spare);
        set_load(&mut data, 2, 1.2);
        set_load(&mut data, 3, 3.0);
        let report = electrical_report(&data, &library);
        assert!(
            report.splice_issues.is_empty(),
            "{:?}",
            report.splice_issues
        );
        assert_eq!(of(&report, 1).load_a, Some(4.2));
        assert_eq!(of(&report, 4).load_a, Some(0.0));
        assert!(!of(&report, 4).ends_at_load, "no hay nada en su punta");
    }

    #[test]
    fn a_wire_type_without_resistance_leaves_the_drop_empty() {
        let (mut data, mut library) = feed_and_two_loads();
        library.wire_defs[0].resistance_mohm_per_m = None;
        set_load(&mut data, 2, 1.0);
        let report = electrical_report(&data, &library);
        assert_eq!(of(&report, 2).load_a, Some(1.0));
        assert_eq!(of(&report, 2).drop_v, None);
    }
}
