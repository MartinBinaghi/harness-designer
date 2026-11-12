//! Datos de cables que parecen errores de carga (pedido de Martin del 2026-11-12,
//! al ver "13V+ WG" y "14V+ WG" entre los "12V+ WG" de su arnés): nombres mal
//! copiados, cables sin nombre y cables sin tipo de señal cuando se puede sugerir.

use super::{warning, Finding, FindingTarget};
use crate::model::library::Library;
use crate::model::project::{ProjectData, WireInstance};
use std::collections::{HashMap, HashSet};

fn name(w: &WireInstance) -> Option<&str> {
    w.specific_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
}

/// El nombre sin sus números (y sin mayúsculas): "12V+ WG" y "13V+ WG" dan lo mismo.
fn shape(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_digit() {
            if !out.ends_with('#') {
                out.push('#');
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// En un mismo circuito, nombres iguales salvo por un número: el que menos se
/// repite parece mal copiado (con empate, el que no es del primer cable). Antes,
/// "↓ next" subía el número del nombre al copiar una fila.
pub(super) fn check_mistyped_names(data: &ProjectData) -> Vec<Finding> {
    let nets = crate::topology::all_nets(data);
    let by_id: HashMap<i64, &WireInstance> =
        data.wire_instances.iter().map(|w| (w.id, w)).collect();
    let mut seen = HashSet::new();
    let mut findings = Vec::new();
    for wire in &data.wire_instances {
        let net = &nets[&wire.id];
        if !seen.insert(net[0]) {
            continue;
        }
        // Los cables del circuito en el orden del proyecto, para que el empate sea estable.
        let mut members: Vec<&WireInstance> =
            net.iter().filter_map(|id| by_id.get(id).copied()).collect();
        members.sort_by_key(|w| data.wire_instances.iter().position(|x| x.id == w.id));
        let mut by_shape: HashMap<String, Vec<&WireInstance>> = HashMap::new();
        for w in &members {
            if let Some(n) = name(w) {
                by_shape.entry(shape(n)).or_default().push(w);
            }
        }
        for group in by_shape.values() {
            let count = |n: &str| group.iter().filter(|w| name(w) == Some(n)).count();
            let reference = group
                .iter()
                .max_by_key(|w| {
                    (
                        count(name(w).unwrap()),
                        std::cmp::Reverse(members.iter().position(|m| m.id == w.id)),
                    )
                })
                .unwrap();
            let ref_name = name(reference).unwrap();
            for w in group.iter().filter(|w| name(w) != Some(ref_name)) {
                findings.push(
                    warning(format!(
                        "Wire {} is named \"{}\", but {} in the same circuit is \"{}\": typo?",
                        w.short_id,
                        name(w).unwrap(),
                        reference.short_id,
                        ref_name
                    ))
                    .at(FindingTarget::Wire { id: w.id }),
                );
            }
        }
    }
    findings
}

/// Sin nombre, la hoja de pinout muestra solo la categoría (o "—").
pub(super) fn check_wires_without_name(data: &ProjectData) -> Vec<Finding> {
    data.wire_instances
        .iter()
        .filter(|w| name(w).is_none())
        .map(|w| {
            warning(format!("Wire {} has no name", w.short_id)).at(FindingTarget::Wire { id: w.id })
        })
        .collect()
}

/// Un cable sin tipo de señal, cuando se puede sugerir uno: el de los cables con
/// el mismo nombre, si no el del resto de su circuito, si no el que aparece en su
/// nombre ("GND WG MOTOR CMD"). Solo si la sugerencia es una sola; los que no se
/// pueden adivinar no se avisan (serían decenas de avisos iguales).
pub(super) fn check_missing_signal_types(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let nets = crate::topology::all_nets(data);
    let type_name: HashMap<i64, &str> = library
        .signal_types
        .iter()
        .map(|t| (t.id, t.name.as_str()))
        .collect();
    let single = |types: HashSet<i64>| (types.len() == 1).then(|| *types.iter().next().unwrap());
    let in_name = |n: &str| {
        let words: Vec<String> = n
            .to_lowercase()
            .split(|c: char| c.is_whitespace() || c == '-' || c == '_' || c == '/')
            .map(str::to_string)
            .collect();
        let found: HashSet<i64> = library
            .signal_types
            .iter()
            .filter(|t| words.iter().any(|w| *w == t.name.to_lowercase()))
            .map(|t| t.id)
            .collect();
        single(found)
    };
    let mut findings = Vec::new();
    for w in data
        .wire_instances
        .iter()
        .filter(|w| w.signal_type_id.is_none())
    {
        let typed = |keep: &dyn Fn(&WireInstance) -> bool| -> HashSet<i64> {
            data.wire_instances
                .iter()
                .filter(|o| o.id != w.id && keep(o))
                .filter_map(|o| o.signal_type_id)
                .collect()
        };
        let lower = name(w).map(str::to_lowercase);
        let same_name = lower.as_ref().and_then(|n| {
            single(typed(&|o| {
                name(o).map(str::to_lowercase).as_ref() == Some(n)
            }))
        });
        let net: HashSet<i64> = nets[&w.id].iter().copied().collect();
        let (suggestion, why) = if let Some(t) = same_name {
            (t, format!("like the other \"{}\" wires", name(w).unwrap()))
        } else if let Some(t) = single(typed(&|o| net.contains(&o.id))) {
            (t, "like the rest of its circuit".to_string())
        } else if let Some(t) = name(w).and_then(in_name) {
            (t, "from its name".to_string())
        } else {
            continue;
        };
        let Some(t) = type_name.get(&suggestion) else {
            continue;
        };
        findings.push(
            warning(format!(
                "Wire {} has no signal type: {t}? ({why})",
                w.short_id
            ))
            .at(FindingTarget::Wire { id: w.id }),
        );
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checks::test_fixtures::*;
    use crate::model::library::SignalType;
    use crate::model::project::SpliceInstance;

    fn wire(
        id: i64,
        name: Option<&str>,
        signal: Option<i64>,
        a: crate::model::project::WireEnd,
        b: crate::model::project::WireEnd,
    ) -> WireInstance {
        WireInstance {
            id,
            short_id: format!("W{id:03}"),
            library_part_id: 1,
            color: None,
            signal_type_id: signal,
            specific_name: name.map(str::to_string),
            manual_cut_margin_pct: None,
            manual_length_mm: None,
            label: None,
            cable_instance_id: None,
            end_a: a,
            end_b: b,
        }
    }

    fn splice(id: i64) -> crate::model::project::WireEnd {
        end("splice", None, Some(id), None, None)
    }

    fn pin(id: i64) -> crate::model::project::WireEnd {
        end("cavity", Some(id), None, None, None)
    }

    /// Lo de Martin: cuatro cables al splice del 12V+ WG, dos con el número subido; otros dos en otro splice.
    fn harness() -> ProjectData {
        let mut data = empty_project();
        data.splice_instances = [5, 6]
            .map(|id| SpliceInstance {
                id,
                short_id: format!("SP{id}"),
                name: String::new(),
                library_part_id: 1,
                node_id: Some(1),
                segment_id: None,
                offset_from_end_mm: None,
                offset_from_node_id: None,
            })
            .to_vec();
        data.wire_instances = vec![
            wire(126, Some("12V+ WG"), Some(5), pin(1), splice(5)),
            wire(127, Some("13V+ WG"), Some(5), pin(2), splice(5)),
            wire(128, Some("14V+ WG"), Some(5), pin(3), splice(5)),
            wire(129, Some("12V+ Supply"), None, pin(4), splice(5)),
            wire(62, None, Some(5), pin(5), pin(6)),
            wire(112, Some("GND WG MOTOR CMD"), None, pin(7), splice(6)),
            wire(113, Some("INY Cil 1"), None, pin(8), pin(9)),
            wire(114, Some("INY Cil 1"), Some(4), pin(10), pin(11)),
        ];
        data
    }

    fn library() -> Library {
        let mut library = empty_library();
        library.signal_types = [(2, "GND"), (4, "signal"), (5, "12V+")]
            .map(|(id, name)| SignalType {
                id,
                name: name.into(),
                default_color: "black".into(),
            })
            .to_vec();
        library
    }

    #[test]
    fn a_name_that_differs_only_by_a_number_in_its_circuit_is_flagged() {
        let messages: Vec<String> = check_mistyped_names(&harness())
            .into_iter()
            .map(|f| f.message)
            .collect();
        assert_eq!(
            messages,
            [
                "Wire W127 is named \"13V+ WG\", but W126 in the same circuit is \"12V+ WG\": typo?",
                "Wire W128 is named \"14V+ WG\", but W126 in the same circuit is \"12V+ WG\": typo?",
            ]
        );
    }

    #[test]
    fn the_name_most_repeated_wins_over_the_first_one() {
        let mut data = harness();
        data.wire_instances[2].specific_name = Some("13V+ WG".into());
        let findings = check_mistyped_names(&data);
        assert_eq!(findings.len(), 1);
        assert!(findings[0]
            .message
            .starts_with("Wire W126 is named \"12V+ WG\", but W127"));
    }

    #[test]
    fn wires_without_a_name_are_flagged() {
        let findings = check_wires_without_name(&harness());
        assert_eq!(
            findings
                .iter()
                .map(|f| f.message.as_str())
                .collect::<Vec<_>>(),
            ["Wire W062 has no name"]
        );
    }

    #[test]
    fn a_missing_signal_type_is_suggested_from_same_name_circuit_or_name() {
        let messages: Vec<String> = check_missing_signal_types(&harness(), &library())
            .into_iter()
            .map(|f| f.message)
            .collect();
        assert_eq!(
            messages,
            [
                "Wire W129 has no signal type: 12V+? (like the rest of its circuit)",
                "Wire W112 has no signal type: GND? (from its name)",
                "Wire W113 has no signal type: signal? (like the other \"INY Cil 1\" wires)",
            ]
        );
    }
}
