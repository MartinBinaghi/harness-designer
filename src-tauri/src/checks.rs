//! Chequeos automáticos (DRC) sobre un proyecto. Ver ../../CLAUDE.md sección 12.
//! Primer subconjunto: lo que se puede validar con el modelo actual, sin
//! calibres numéricos ni cálculos de la etapa 3/4 todavía.

use crate::model::library::Library;
use crate::model::project::{ProjectData, WireEnd};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Mismo shape que `Selection` en el frontend (types.ts): clickear un hallazgo
/// selecciona el elemento al que se refiere, igual que clickear su fila en
/// cualquier otra pantalla (plan sección 7.3, "click lleva al elemento").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FindingTarget {
    Node { id: i64 },
    Segment { id: i64 },
    Connector { id: i64 },
    Ground { id: i64 },
    Splice { id: i64 },
    Wire { id: i64 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub severity: String, // "error" | "warning"
    pub message: String,
    pub target: Option<FindingTarget>,
}

impl Finding {
    /// Encadenable: `error(msg).at(FindingTarget::Connector { id })`.
    fn at(mut self, target: FindingTarget) -> Self {
        self.target = Some(target);
        self
    }
}

fn error(message: impl Into<String>) -> Finding {
    Finding {
        severity: "error".into(),
        message: message.into(),
        target: None,
    }
}
fn warning(message: impl Into<String>) -> Finding {
    Finding {
        severity: "warning".into(),
        message: message.into(),
        target: None,
    }
}

/// Une componentes conectados; si dos nodos ya están unidos antes de agregar
/// un segmento, ese segmento cierra un lazo.
struct DisjointSet {
    parent: Vec<usize>,
}
impl DisjointSet {
    fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
        }
    }
    fn find(&mut self, x: usize) -> usize {
        if self.parent[x] != x {
            self.parent[x] = self.find(self.parent[x]);
        }
        self.parent[x]
    }
    /// Devuelve `false` si `a` y `b` ya estaban en el mismo componente (lazo).
    fn union(&mut self, a: usize, b: usize) -> bool {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra == rb {
            return false;
        }
        self.parent[ra] = rb;
        true
    }
}

fn check_topology_has_no_loops(data: &ProjectData) -> Vec<Finding> {
    let index: HashMap<i64, usize> = data
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id, i))
        .collect();
    let mut dsu = DisjointSet::new(data.nodes.len());
    let mut findings = Vec::new();
    for seg in &data.segments {
        let (Some(&a), Some(&b)) = (index.get(&seg.node_a_id), index.get(&seg.node_b_id)) else {
            continue;
        };
        if !dsu.union(a, b) {
            findings.push(error(format!(
                "Segment S{} closes a loop in the topology (node {} and node {} were already connected)",
                seg.id, seg.node_a_id, seg.node_b_id
            )).at(FindingTarget::Segment { id: seg.id }));
        }
    }
    findings
}

fn end_target_exists(data: &ProjectData, end: &WireEnd) -> bool {
    match end.kind.as_str() {
        "cavity" => end.cavity_assignment_id.is_some_and(|id| {
            data.connector_instances
                .iter()
                .any(|c| c.cavities.iter().any(|cav| cav.id == id))
        }),
        "splice" => end
            .splice_id
            .is_some_and(|id| data.splice_instances.iter().any(|s| s.id == id)),
        "ground" => end
            .ground_point_id
            .is_some_and(|id| data.ground_points.iter().any(|g| g.id == id)),
        "component" => end
            .component_instance_id
            .is_some_and(|id| data.component_instances.iter().any(|c| c.id == id)),
        _ => false,
    }
}

fn check_wires_have_valid_endpoints(data: &ProjectData) -> Vec<Finding> {
    let mut findings = Vec::new();
    for wire in &data.wire_instances {
        if !end_target_exists(data, &wire.end_a) {
            findings.push(
                error(format!(
                    "Wire {} has no valid starting endpoint",
                    wire.short_id
                ))
                .at(FindingTarget::Wire { id: wire.id }),
            );
        }
        if !end_target_exists(data, &wire.end_b) {
            findings.push(
                error(format!(
                    "Wire {} has no valid ending endpoint",
                    wire.short_id
                ))
                .at(FindingTarget::Wire { id: wire.id }),
            );
        }
    }
    findings
}

fn check_splices_within_capacity(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let mut counts: HashMap<i64, i64> = HashMap::new();
    for wire in &data.wire_instances {
        if let Some(id) = wire.end_a.splice_id {
            *counts.entry(id).or_default() += 1;
        }
        if let Some(id) = wire.end_b.splice_id {
            *counts.entry(id).or_default() += 1;
        }
    }
    let mut findings = Vec::new();
    for splice in &data.splice_instances {
        let Some(def) = library
            .splice_defs
            .iter()
            .find(|d| d.part_id == splice.library_part_id)
        else {
            continue;
        };
        let count = counts.get(&splice.id).copied().unwrap_or(0);
        if count > def.max_wires {
            findings.push(
                error(format!(
                    "Splice {} has {count} wires, more than its part allows ({})",
                    splice.short_id, def.max_wires
                ))
                .at(FindingTarget::Splice { id: splice.id }),
            );
        }
    }
    findings
}

/// Calibre total fuera del rango del splice (plan sección 12: "splice con...
/// calibre fuera de lo que admite su SpliceDef"), mismo patrón que el chequeo
/// de calibre vs. contacto: suma la sección de todos los cables que llegan al
/// splice y la compara contra su rango.
fn check_gauge_within_splice_range(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let mut findings = Vec::new();
    for splice in &data.splice_instances {
        let Some(def) = library
            .splice_defs
            .iter()
            .find(|d| d.part_id == splice.library_part_id)
        else {
            continue;
        };
        let Some((range_min, range_max)) =
            crate::contacts::gauge_range_mm2(def.gauge_min.as_deref(), def.gauge_max.as_deref())
        else {
            continue;
        };

        let wires: Vec<&crate::model::project::WireInstance> = data
            .wire_instances
            .iter()
            .filter(|w| {
                w.end_a.splice_id == Some(splice.id) || w.end_b.splice_id == Some(splice.id)
            })
            .collect();
        if wires.is_empty() {
            continue;
        }
        let Some(total_mm2) = wires
            .iter()
            .map(|w| {
                library
                    .wire_defs
                    .iter()
                    .find(|wd| wd.part_id == w.library_part_id)
                    .and_then(|wd| crate::gauge::gauge_to_mm2(&wd.gauge))
            })
            .sum::<Option<f64>>()
        else {
            continue; // algún calibre involucrado no se pudo interpretar
        };

        if total_mm2 < range_min || total_mm2 > range_max {
            findings.push(
                error(format!(
                    "Splice {}'s wire gauge ({total_mm2:.2}mm² total) is outside its part's range",
                    splice.short_id
                ))
                .at(FindingTarget::Splice { id: splice.id }),
            );
        }
    }
    findings
}

fn check_pending_connectors(data: &ProjectData) -> Vec<Finding> {
    data.connector_instances
        .iter()
        .filter(|c| c.status == "pending")
        .map(|c| {
            warning(format!("Connector {} is marked pending", c.short_id))
                .at(FindingTarget::Connector { id: c.id })
        })
        .collect()
}

/// Vías sin cable a las que la biblioteca no les da tapón (el del conector, o
/// uno del mismo tamaño): un aviso por conector, no uno por vía.
fn check_unused_cavities_without_seal_plug(data: &ProjectData, library: &Library) -> Vec<Finding> {
    data.connector_instances
        .iter()
        .filter_map(|connector| {
            let missing = connector
                .cavities
                .iter()
                .filter(|cav| {
                    crate::contacts::wires_in_cavity(data, cav).is_empty()
                        && crate::contacts::cavity_seal_plug(data, library, connector, cav).is_none()
                })
                .count();
            (missing > 0).then(|| {
                warning(format!(
                    "{}: {missing} unused cavit{} without seal plug (set the seal plug of its part in the library)",
                    connector.short_id,
                    if missing == 1 { "y" } else { "ies" }
                ))
                .at(FindingTarget::Connector { id: connector.id })
            })
        })
        .collect()
}

/// Vías con cable a las que la biblioteca no les da contacto: sin él no entran
/// en la lista de materiales ni se chequea el calibre. Un aviso por conector.
fn check_used_cavities_without_contact(data: &ProjectData, library: &Library) -> Vec<Finding> {
    data.connector_instances
        .iter()
        .filter_map(|connector| {
            let missing = connector
                .cavities
                .iter()
                .filter(|cav| {
                    !crate::contacts::wires_in_cavity(data, cav).is_empty()
                        && crate::contacts::cavity_contact(data, library, connector, cav).is_none()
                })
                .count();
            (missing > 0).then(|| {
                warning(format!(
                    "{}: no contact for {missing} wired cavit{} (set the contact of its part in the library)",
                    connector.short_id,
                    if missing == 1 { "y" } else { "ies" }
                ))
                .at(FindingTarget::Connector { id: connector.id })
            })
        })
        .collect()
}

fn check_same_net_different_function(data: &ProjectData) -> Vec<Finding> {
    let mut seen = HashSet::new();
    let mut findings = Vec::new();
    for wire in &data.wire_instances {
        if !seen.insert(wire.id) {
            continue;
        }
        let net = crate::topology::net_of_wire(data, wire.id);
        for &id in &net {
            seen.insert(id);
        }
        let net_wires: Vec<&crate::model::project::WireInstance> = net
            .iter()
            .filter_map(|id| data.wire_instances.iter().find(|w| w.id == *id))
            .collect();
        let names: HashSet<&str> = net_wires
            .iter()
            .filter_map(|w| w.specific_name.as_deref())
            .collect();
        if names.len() > 1 {
            let short_ids: Vec<&str> = net_wires.iter().map(|w| w.short_id.as_str()).collect();
            findings.push(warning(format!(
                "Wires {} share a net but have different names",
                short_ids.join(", ")
            )));
        }
    }
    findings
}

fn check_covering_fit(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let mut findings = Vec::new();
    for segment in &data.segments {
        if crate::calc::bundle_diameter_mm(data, library, segment.id) <= 0.0 {
            continue;
        }
        let fits = crate::calc::coverings_for_segment(data, library, segment.id);
        match segment.covering_library_part_id {
            Some(assigned_id) => {
                if let Some(fit) = fits.iter().find(|f| f.library_part_id == assigned_id) {
                    if !fit.fits {
                        findings.push(
                            warning(format!(
                                "Segment S{} has a covering assigned that doesn't fit this bundle",
                                segment.id
                            ))
                            .at(FindingTarget::Segment { id: segment.id }),
                        );
                    }
                }
            }
            None if !fits.iter().any(|f| f.fits) => {
                findings.push(
                    warning(format!(
                        "No covering in the library fits segment S{}'s bundle",
                        segment.id
                    ))
                    .at(FindingTarget::Segment { id: segment.id }),
                );
            }
            None => {}
        }
    }
    findings
}

fn check_adhesive_heatshrink_connector_without_back_diameter(
    data: &ProjectData,
    library: &Library,
) -> Vec<Finding> {
    data.connector_instances
        .iter()
        .filter(|c| c.termination.as_deref() == Some("adhesive_heatshrink"))
        .filter(|c| {
            let def = library
                .connector_defs
                .iter()
                .find(|d| d.part_id == c.library_part_id);
            !def.is_some_and(|d| d.back_clearance_mm().is_some())
        })
        .map(|c| {
            warning(format!(
                "Connector {} uses adhesive heat-shrink but its part has no back diameter loaded",
                c.short_id
            ))
            .at(FindingTarget::Connector { id: c.id })
        })
        .collect()
}

fn check_boot_assigned_does_not_fit(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let mut findings = Vec::new();
    for connector in &data.connector_instances {
        if !matches!(
            connector.termination.as_deref(),
            Some("boot_straight") | Some("boot_90")
        ) {
            continue;
        }
        let Some(assigned_id) = connector.termination_library_part_id else {
            continue;
        };
        let fits = crate::calc::boots_for_connector(data, library, connector.id);
        if let Some(fit) = fits.iter().find(|f| f.library_part_id == assigned_id) {
            if !fit.fits {
                findings.push(warning(format!("Connector {}'s assigned boot doesn't fit (series/shell or cable-side diameter)", connector.short_id)).at(FindingTarget::Connector { id: connector.id }));
            }
        }
    }
    findings
}

fn check_t_mold_assigned_does_not_fit(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let mut findings = Vec::new();
    for node in &data.nodes {
        if node.termination.as_deref() != Some("t_mold") {
            continue;
        }
        let Some(assigned_id) = node.termination_library_part_id else {
            continue;
        };
        let fits = crate::calc::t_mold_fits_for_node(data, library, node.id);
        if let Some(fit) = fits.iter().find(|f| f.library_part_id == assigned_id) {
            if !fit.fits {
                findings.push(
                    warning(format!(
                        "Breakout at node {} has a T-mold assigned that doesn't fit its segments",
                        node.id
                    ))
                    .at(FindingTarget::Node { id: node.id }),
                );
            }
        }
    }
    findings
}

/// Calibre fuera del rango del contacto, incluyendo la sección total cuando
/// hay varios cables en la misma cavidad (plan sección 12 y 4.2).
fn check_gauge_within_contact_range(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let mut findings = Vec::new();
    for connector in &data.connector_instances {
        for cav in &connector.cavities {
            let Some(contact_id) = crate::contacts::cavity_contact(data, library, connector, cav)
            else {
                continue;
            };
            let Some(contact) = library
                .contact_defs
                .iter()
                .find(|c| c.part_id == contact_id)
            else {
                continue;
            };
            let Some((range_min, range_max)) = crate::contacts::gauge_range_mm2(
                contact.gauge_min.as_deref(),
                contact.gauge_max.as_deref(),
            ) else {
                continue;
            };

            let wires: Vec<&crate::model::project::WireInstance> = data
                .wire_instances
                .iter()
                .filter(|w| {
                    w.end_a.cavity_assignment_id == Some(cav.id)
                        || w.end_b.cavity_assignment_id == Some(cav.id)
                })
                .collect();
            if wires.is_empty() {
                continue;
            }
            let Some(total_mm2) = wires
                .iter()
                .map(|w| {
                    library
                        .wire_defs
                        .iter()
                        .find(|wd| wd.part_id == w.library_part_id)
                        .and_then(|wd| crate::gauge::gauge_to_mm2(&wd.gauge))
                })
                .sum::<Option<f64>>()
            else {
                continue; // algún calibre involucrado no se pudo interpretar
            };

            if total_mm2 < range_min || total_mm2 > range_max {
                findings.push(error(format!(
                    "{}: cavity {}'s wire gauge ({total_mm2:.2}mm² total) is outside its contact's range",
                    connector.short_id, cav.cavity_id
                )).at(FindingTarget::Connector { id: connector.id }));
            }
        }
    }
    findings
}

fn check_cut_margin_below_twist_minimum(data: &ProjectData, library: &Library) -> Vec<Finding> {
    crate::calc::cut_list(data, library)
        .into_iter()
        .filter(|cut| cut.margin_pct < cut.twist_min_margin_pct)
        .filter_map(|cut| {
            let wire = data.wire_instances.iter().find(|w| w.id == cut.wire_id)?;
            Some(
                warning(format!(
                    "Wire {} has a {:.1}% cut margin, below the {:.1}% minimum its twist needs",
                    wire.short_id, cut.margin_pct, cut.twist_min_margin_pct
                ))
                .at(FindingTarget::Wire { id: wire.id }),
            )
        })
        .collect()
}

pub fn run_checks(data: &ProjectData, library: &Library) -> Vec<Finding> {
    let mut findings = Vec::new();
    findings.extend(check_topology_has_no_loops(data));
    findings.extend(check_wires_have_valid_endpoints(data));
    findings.extend(check_splices_within_capacity(data, library));
    findings.extend(check_gauge_within_splice_range(data, library));
    findings.extend(check_pending_connectors(data));
    findings.extend(check_unused_cavities_without_seal_plug(data, library));
    findings.extend(check_used_cavities_without_contact(data, library));
    findings.extend(check_same_net_different_function(data));
    findings.extend(check_cut_margin_below_twist_minimum(data, library));
    findings.extend(check_covering_fit(data, library));
    findings.extend(check_adhesive_heatshrink_connector_without_back_diameter(
        data, library,
    ));
    findings.extend(check_boot_assigned_does_not_fit(data, library));
    findings.extend(check_t_mold_assigned_does_not_fit(data, library));
    findings.extend(check_gauge_within_contact_range(data, library));
    findings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::library::{Library, Part, SpliceDef};
    use crate::model::project::{
        CavityAssignment, ConnectorInstance, GroundPoint, Node, Project, ProjectData, Segment,
        SpliceInstance, WireInstance,
    };

    fn end(
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

    fn empty_project() -> ProjectData {
        ProjectData {
            project: Project {
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
            },
            nodes: vec![],
            segments: vec![],
            connector_instances: vec![],
            ground_points: vec![],
            splice_instances: vec![],
            component_instances: vec![],
            wire_instances: vec![],
            twist_groups: vec![],
        }
    }

    fn empty_library() -> Library {
        Library::default()
    }

    #[test]
    fn flags_a_loop_in_the_topology() {
        let mut data = empty_project();
        data.nodes = vec![
            Node {
                id: 1,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
            },
            Node {
                id: 2,
                kind: "breakout".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
            },
            Node {
                id: 3,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
            },
        ];
        data.segments = vec![
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
                length_mm: 100.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            },
            Segment {
                id: 3,
                node_a_id: 3,
                node_b_id: 1,
                length_mm: 100.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            }, // closes the loop
        ];
        let findings = check_topology_has_no_loops(&data);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, "error");
    }

    #[test]
    fn a_tree_has_no_loop_findings() {
        let mut data = empty_project();
        data.nodes = vec![
            Node {
                id: 1,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
            },
            Node {
                id: 2,
                kind: "breakout".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
            },
            Node {
                id: 3,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
            },
        ];
        data.segments = vec![
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
                length_mm: 100.0,
                twist_pitch_mm: None,
                covering_library_part_id: None,
            },
        ];
        assert!(check_topology_has_no_loops(&data).is_empty());
    }

    #[test]
    fn flags_a_wire_end_pointing_at_nothing() {
        let mut data = empty_project();
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
            end_a: end("cavity", None, None, None, None), // never picked in the UI
            end_b: end("ground", None, None, Some(1), None),
        }];
        data.ground_points = vec![GroundPoint {
            id: 1,
            short_id: "G1".into(),
            name: "Chassis".into(),
            terminal_library_part_id: None,
            node_id: 1,
        }];
        let findings = check_wires_have_valid_endpoints(&data);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("starting endpoint"));
    }

    #[test]
    fn flags_a_splice_over_its_wire_capacity() {
        let mut data = empty_project();
        data.splice_instances = vec![SpliceInstance {
            id: 1,
            short_id: "SP1".into(),
            library_part_id: 1,
            node_id: Some(1),
            segment_id: None,
            offset_from_end_mm: None,
            offset_from_node_id: None,
        }];
        data.wire_instances = (1..=3)
            .map(|i| WireInstance {
                id: i,
                short_id: format!("W00{i}"),
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("splice", None, Some(1), None, None),
            })
            .collect();

        let mut library = empty_library();
        library.parts = vec![Part {
            id: 1,
            part_number: "SPLICE-2".into(),
            manufacturer: None,
            description: None,
            category: "splice".into(),
            purchase_unit: "unit".into(),
            qty_per_pack: 1.0,
            price_usd: None,
            price_date: None,
        }];
        library.splice_defs = vec![SpliceDef {
            part_id: 1,
            gauge_min: None,
            gauge_max: None,
            max_wires: 2,
        }];

        let findings = check_splices_within_capacity(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("more than its part allows"));
    }

    /// Un splice con 3 cables de 22 AWG (≈0.326mm² cada uno, ≈0.98mm² total) y
    /// su biblioteca de cables (`WireDef` 100, reusa `library_with_wire_def`).
    fn splice_with_three_22awg_wires() -> (ProjectData, Library) {
        let mut data = empty_project();
        data.splice_instances = vec![SpliceInstance {
            id: 1,
            short_id: "SP1".into(),
            library_part_id: 1,
            node_id: Some(1),
            segment_id: None,
            offset_from_end_mm: None,
            offset_from_node_id: None,
        }];
        data.wire_instances = (1..=3)
            .map(|i| WireInstance {
                id: i,
                short_id: format!("W00{i}"),
                library_part_id: 100,
                color: None,
                signal_type_id: None,
                specific_name: None,
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("splice", None, Some(1), None, None),
            })
            .collect();
        let mut library = library_with_wire_def(6.0);
        library.parts = vec![Part {
            id: 1,
            part_number: "SPLICE-1".into(),
            manufacturer: None,
            description: None,
            category: "splice".into(),
            purchase_unit: "unit".into(),
            qty_per_pack: 1.0,
            price_usd: None,
            price_date: None,
        }];
        (data, library)
    }

    #[test]
    fn no_gauge_finding_when_the_splice_fits_the_combined_wire_gauge() {
        let (data, mut library) = splice_with_three_22awg_wires();
        library.splice_defs = vec![SpliceDef {
            part_id: 1,
            gauge_min: Some("20 AWG".into()),
            gauge_max: Some("16 AWG".into()),
            max_wires: 5,
        }];
        assert!(check_gauge_within_splice_range(&data, &library).is_empty());
    }

    #[test]
    fn flags_a_splice_gauge_outside_its_combined_wire_range() {
        let (data, mut library) = splice_with_three_22awg_wires();
        // Rango pensado para calibres mucho más finos que la suma real (~0.98mm²).
        library.splice_defs = vec![SpliceDef {
            part_id: 1,
            gauge_min: Some("24 AWG".into()),
            gauge_max: Some("22 AWG".into()),
            max_wires: 5,
        }];
        let findings = check_gauge_within_splice_range(&data, &library);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, "error");
        assert!(findings[0].message.contains("SP1"));
    }

    #[test]
    fn flags_a_pending_connector() {
        let mut data = empty_project();
        data.nodes = vec![Node {
            id: 1,
            kind: "connector_end".into(),
            termination: None,
            termination_library_part_id: None,
            diagram_x: None,
            diagram_y: None,
        }];
        data.connector_instances = vec![ConnectorInstance {
            id: 1,
            short_id: "X1".into(),
            name: "TBD".into(),
            library_part_id: 1,
            device_connector_id: None,
            node_id: 1,
            termination: None,
            termination_library_part_id: None,
            backshell_library_part_id: None,
            status: "pending".into(),
            is_interconnect: false,
            mates_with: None,
            cavities: vec![CavityAssignment {
                id: 1,
                cavity_id: "1".into(),
                external_reference: None,
            }],
        }];
        let pending = check_pending_connectors(&data);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].target, Some(FindingTarget::Connector { id: 1 }));

        let unused = check_unused_cavities_without_seal_plug(&data, &empty_library());
        assert_eq!(unused.len(), 1);
        assert_eq!(unused[0].target, Some(FindingTarget::Connector { id: 1 }));
    }

    #[test]
    fn flags_same_net_wires_with_different_names() {
        let mut data = empty_project();
        data.splice_instances = vec![SpliceInstance {
            id: 1,
            short_id: "SP1".into(),
            library_part_id: 1,
            node_id: Some(1),
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
                specific_name: Some("Damper FL".into()),
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("splice", None, Some(1), None, None),
            },
            WireInstance {
                id: 2,
                short_id: "W002".into(),
                library_part_id: 1,
                color: None,
                signal_type_id: None,
                specific_name: Some("Damper FR".into()),
                manual_cut_margin_pct: None,
                manual_length_mm: None,
                label: None,
                end_a: end("splice", None, Some(1), None, None),
                end_b: end("splice", None, Some(1), None, None),
            },
        ];
        let findings = check_same_net_different_function(&data);
        assert_eq!(findings.len(), 1);
    }

    #[test]
    fn run_checks_combines_every_check() {
        let data = empty_project();
        let library = empty_library();
        assert!(run_checks(&data, &library).is_empty());
    }

    /// Dos nodos, un segmento de 500mm, un conector en cada extremo (X1/X2, misma
    /// library_part_id 10) y un cable de X1:1 a X2:1 (WireDef 100, 6mm de diámetro).
    fn segment_with_one_wire() -> ProjectData {
        let mut data = empty_project();
        data.nodes = vec![
            Node {
                id: 1,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
            },
            Node {
                id: 2,
                kind: "connector_end".into(),
                termination: None,
                termination_library_part_id: None,
                diagram_x: None,
                diagram_y: None,
            },
        ];
        data.segments = vec![Segment {
            id: 1,
            node_a_id: 1,
            node_b_id: 2,
            length_mm: 500.0,
            twist_pitch_mm: Some(1_000_000.0),
            covering_library_part_id: None,
        }];
        data.connector_instances = vec![
            ConnectorInstance {
                id: 1,
                short_id: "X1".into(),
                name: "A".into(),
                library_part_id: 10,
                device_connector_id: None,
                node_id: 1,
                termination: None,
                termination_library_part_id: None,
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![CavityAssignment {
                    id: 1,
                    cavity_id: "1".into(),
                    external_reference: None,
                }],
            },
            ConnectorInstance {
                id: 2,
                short_id: "X2".into(),
                name: "B".into(),
                library_part_id: 10,
                device_connector_id: None,
                node_id: 2,
                termination: None,
                termination_library_part_id: None,
                backshell_library_part_id: None,
                status: "complete".into(),
                is_interconnect: false,
                mates_with: None,
                cavities: vec![CavityAssignment {
                    id: 2,
                    cavity_id: "1".into(),
                    external_reference: None,
                }],
            },
        ];
        data.wire_instances = vec![WireInstance {
            id: 1,
            short_id: "W001".into(),
            library_part_id: 100,
            color: None,
            signal_type_id: None,
            specific_name: None,
            manual_cut_margin_pct: None,
            manual_length_mm: None,
            label: None,
            end_a: end("cavity", Some(1), None, None, None),
            end_b: end("cavity", Some(2), None, None, None),
        }];
        data
    }

    /// ConnectorDef mínimo cuyo contacto por defecto es `contact_part_id`.
    fn connector_def_with_contact(
        part_id: i64,
        contact_part_id: i64,
    ) -> crate::model::library::ConnectorDef {
        crate::model::library::ConnectorDef {
            part_id,
            gender: "female".into(),
            series: None,
            shell_size: None,
            counterpart_id: None,
            back_shape: None,
            back_diameter_mm: None,
            back_width_mm: None,
            back_height_mm: None,
            suggested_termination: None,
            contact_part_id: Some(contact_part_id),
            seal_plug_part_id: None,
            image_side: None,
            image_front: None,
            image_back: None,
            cavities: vec![],
        }
    }

    fn library_with_wire_def(outer_diameter_mm: f64) -> Library {
        let mut library = empty_library();
        library.wire_defs = vec![crate::model::library::WireDef {
            part_id: 100,
            gauge: "22 AWG".into(),
            spec: None,
            color: None,
            outer_diameter_mm,
            default_cut_margin_pct: None,
            conductors: vec![],
        }];
        library
    }

    #[test]
    fn flags_when_no_covering_in_the_library_fits_the_segment() {
        let data = segment_with_one_wire();
        let library = library_with_wire_def(6.0);
        let findings = check_covering_fit(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("No covering"));
    }

    #[test]
    fn flags_an_assigned_covering_that_does_not_fit() {
        let mut data = segment_with_one_wire();
        data.segments[0].covering_library_part_id = Some(200);
        let mut library = library_with_wire_def(6.0);
        // Demasiado angosto: no aprieta contra el bundle real.
        library.covering_defs = vec![crate::model::library::CoveringDef {
            part_id: 200,
            supplied_diameter_mm: 1.0,
            shrunk_diameter_mm: 0.5,
            shrunk_wall_thickness_mm: 0.2,
            has_adhesive: true,
        }];
        let findings = check_covering_fit(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("doesn't fit"));
    }

    #[test]
    fn no_covering_finding_when_a_fitting_one_is_assigned() {
        let mut data = segment_with_one_wire();
        data.segments[0].covering_library_part_id = Some(200);
        let mut library = library_with_wire_def(6.0);
        let d_bundle = crate::calc::bundle_diameter_mm(&data, &library, 1);
        library.covering_defs = vec![crate::model::library::CoveringDef {
            part_id: 200,
            supplied_diameter_mm: d_bundle * 1.2,
            shrunk_diameter_mm: d_bundle * 0.9,
            shrunk_wall_thickness_mm: 0.2,
            has_adhesive: true,
        }];
        assert!(check_covering_fit(&data, &library).is_empty());
    }

    #[test]
    fn flags_adhesive_heatshrink_connector_without_a_back_diameter() {
        let mut data = segment_with_one_wire();
        data.connector_instances[0].termination = Some("adhesive_heatshrink".into());
        let library = library_with_wire_def(6.0); // sin connector_defs -> sin medida trasera
        let findings = check_adhesive_heatshrink_connector_without_back_diameter(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("X1"));
    }

    #[test]
    fn flags_a_boot_assigned_to_a_connector_it_is_not_compatible_with() {
        let mut data = segment_with_one_wire();
        data.connector_instances[0].termination = Some("boot_straight".into());
        data.connector_instances[0].termination_library_part_id = Some(300);
        let mut library = library_with_wire_def(6.0);
        library.connector_defs = vec![crate::model::library::ConnectorDef {
            part_id: 10,
            gender: "female".into(),
            series: Some("AMP".into()),
            shell_size: Some("CE".into()),
            counterpart_id: None,
            back_shape: None,
            back_diameter_mm: None,
            back_width_mm: None,
            back_height_mm: None,
            suggested_termination: None,
            contact_part_id: None,
            seal_plug_part_id: None,
            image_side: None,
            image_front: None,
            image_back: None,
            cavities: vec![],
        }];
        library.accessory_defs = vec![crate::model::library::AccessoryDef {
            part_id: 300,
            orientation: "straight".into(),
            cable_side_min_diameter_mm: 1.0,
            cable_side_max_diameter_mm: 2.0,
            leg_length_mm: 30.0,
            overlap_mm: 15.0,
            compatible_connectors: vec![crate::model::library::AccessoryDefConnectorMatch {
                series: "DT".into(),
                shell_size: "06".into(),
            }],
        }];
        let findings = check_boot_assigned_does_not_fit(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("X1"));
    }

    #[test]
    fn flags_a_t_mold_assigned_to_a_breakout_it_does_not_fit() {
        let mut data = segment_with_one_wire();
        data.nodes[0].termination = Some("t_mold".into());
        data.nodes[0].termination_library_part_id = Some(400);
        let mut library = library_with_wire_def(6.0);
        // El molde tiene 3 patas, pero el nodo 1 solo tiene un segmento: no calza.
        library.t_mold_defs = vec![crate::model::library::TMoldDef {
            part_id: 400,
            overlap_mm: 20.0,
            legs: vec![
                crate::model::library::TMoldLeg {
                    min_diameter_mm: 0.0,
                    max_diameter_mm: 100.0,
                    leg_length_mm: 30.0,
                },
                crate::model::library::TMoldLeg {
                    min_diameter_mm: 0.0,
                    max_diameter_mm: 100.0,
                    leg_length_mm: 30.0,
                },
                crate::model::library::TMoldLeg {
                    min_diameter_mm: 0.0,
                    max_diameter_mm: 100.0,
                    leg_length_mm: 30.0,
                },
            ],
        }];
        let findings = check_t_mold_assigned_does_not_fit(&data, &library);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("node 1"));
    }

    #[test]
    fn no_gauge_finding_when_the_wire_fits_the_contact_range() {
        let data = segment_with_one_wire();
        let mut library = library_with_wire_def(6.0); // WireDef 100 = "22 AWG" ≈ 0.326mm²
        library.connector_defs = vec![connector_def_with_contact(
            data.connector_instances[0].library_part_id,
            500,
        )];
        library.contact_defs = vec![crate::model::library::ContactDef {
            part_id: 500,
            gender: "female".into(),
            contact_size: "20".into(),
            gauge_min: Some("24 AWG".into()),
            gauge_max: Some("20 AWG".into()),
        }];
        assert!(check_gauge_within_contact_range(&data, &library).is_empty());
    }

    #[test]
    fn flags_a_wire_gauge_outside_its_contacts_range() {
        let data = segment_with_one_wire();
        let mut library = library_with_wire_def(6.0); // WireDef 100 = "22 AWG" ≈ 0.326mm²
        library.connector_defs = vec![connector_def_with_contact(
            data.connector_instances[0].library_part_id,
            500,
        )];
        library.contact_defs = vec![crate::model::library::ContactDef {
            part_id: 500,
            gender: "female".into(),
            contact_size: "12".into(),
            gauge_min: Some("14 AWG".into()), // mucho más grueso que el cable real
            gauge_max: Some("10 AWG".into()),
        }];
        let findings = check_gauge_within_contact_range(&data, &library);
        // El cable llega a X1 y a X2, los dos con ese contacto: un error en cada punta.
        assert_eq!(findings.len(), 2);
        assert!(findings.iter().all(|f| f.severity == "error"));
        assert!(findings[0].message.contains("X1"));
    }
}
