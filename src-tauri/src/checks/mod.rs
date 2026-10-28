//! Chequeos automáticos (DRC) sobre un proyecto. Ver ../../../CLAUDE.md sección 12.
//! Primer subconjunto: lo que se puede validar con el modelo actual, sin
//! calibres numéricos ni cálculos de la etapa 3/4 todavía.

mod connectors;
mod coverings;
mod loops;
mod splices;
#[cfg(test)]
mod test_fixtures;
mod wires;

use connectors::{
    check_adhesive_heatshrink_connector_without_back_diameter, check_gauge_within_contact_range,
    check_pending_connectors, check_unused_cavities_without_seal_plug,
    check_used_cavities_without_contact,
};
use coverings::{
    check_boot_assigned_does_not_fit, check_covering_fit, check_t_mold_assigned_does_not_fit,
};
use loops::check_topology_has_no_loops;
use splices::{check_gauge_within_splice_range, check_splices_within_capacity};
use wires::{
    check_cut_margin_below_twist_minimum, check_same_net_different_function,
    check_wires_have_valid_endpoints,
};

use crate::model::library::Library;
use crate::model::project::ProjectData;
use serde::{Deserialize, Serialize};

/// Mismo shape que `Selection` en el frontend (src/model/project.ts): clickear un hallazgo
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
    /// De qué verificación sale ("Pending connectors"…): la pestaña Checks los
    /// agrupa, para que lo importante no se pierda entre 30 avisos iguales.
    #[serde(default)]
    pub group: String,
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
        group: String::new(),
    }
}

fn warning(message: impl Into<String>) -> Finding {
    Finding {
        severity: "warning".into(),
        message: message.into(),
        target: None,
        group: String::new(),
    }
}

pub fn run_checks(data: &ProjectData, library: &Library) -> Vec<Finding> {
    use crate::model::project::DanglingItem;
    // Los extremos de cable rotos ya los informa check_wires_have_valid_endpoints.
    let broken: Vec<Finding> = crate::model::project::dangling_references(data)
        .into_iter()
        .filter(|d| !matches!(d.item, DanglingItem::Wire(_)))
        .map(|d| {
            let finding = error(format!(
                "{}: the project can't be saved until it's fixed",
                d.message
            ));
            match d.item {
                DanglingItem::Segment(id) => finding.at(FindingTarget::Segment { id }),
                DanglingItem::Connector(id) => finding.at(FindingTarget::Connector { id }),
                DanglingItem::Ground(id) => finding.at(FindingTarget::Ground { id }),
                DanglingItem::Splice(id) => finding.at(FindingTarget::Splice { id }),
                _ => finding,
            }
        })
        .collect();
    let groups: Vec<(&str, Vec<Finding>)> = vec![
        ("Broken references", broken),
        ("Topology loops", check_topology_has_no_loops(data)),
        ("Wire ends", check_wires_have_valid_endpoints(data)),
        (
            "Splice capacity",
            check_splices_within_capacity(data, library),
        ),
        (
            "Splice gauge range",
            check_gauge_within_splice_range(data, library),
        ),
        ("Pending connectors", check_pending_connectors(data)),
        (
            "Unused cavities without seal plug",
            check_unused_cavities_without_seal_plug(data, library),
        ),
        (
            "Wired cavities without contact",
            check_used_cavities_without_contact(data, library),
        ),
        (
            "Same net, different names",
            check_same_net_different_function(data),
        ),
        (
            "Cut margin below twist minimum",
            check_cut_margin_below_twist_minimum(data, library),
        ),
        ("Heat-shrink fit", check_covering_fit(data, library)),
        (
            "Back diameter missing",
            check_adhesive_heatshrink_connector_without_back_diameter(data, library),
        ),
        ("Boot fit", check_boot_assigned_does_not_fit(data, library)),
        (
            "T-mold fit",
            check_t_mold_assigned_does_not_fit(data, library),
        ),
        (
            "Wire gauge vs contact",
            check_gauge_within_contact_range(data, library),
        ),
    ];
    groups
        .into_iter()
        .flat_map(|(group, list)| {
            list.into_iter().map(move |f| Finding {
                group: group.to_string(),
                ..f
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::checks::test_fixtures::*;

    #[test]
    fn run_checks_combines_every_check() {
        let data = empty_project();
        let library = empty_library();
        assert!(run_checks(&data, &library).is_empty());
    }
}
