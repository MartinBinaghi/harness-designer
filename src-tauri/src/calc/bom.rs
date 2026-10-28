//! Lista de materiales y costo (plan 8.2 y 8.3).

use super::{covering_cut_list, cut_list};
use crate::model::library::Library;
use crate::model::project::{Project, ProjectData};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BomRow {
    pub library_part_id: i64,
    pub category: String,
    pub part_number: String,
    /// Cantidad usada: unidades, o metros para partes de tipo "wire".
    pub quantity_needed: f64,
    /// Repuesto (% de la categoría, en unidades enteras si la parte va por unidad).
    pub spare: f64,
    pub unit: String,
    /// Usado + repuesto, redondeado hacia arriba al múltiplo de `qty_per_pack`.
    pub quantity_to_buy: f64,
    pub unit_price_usd: Option<f64>,
    /// Sobre lo usado (`(necesario + repuesto) × precio`) o, si el proyecto lo
    /// pide, sobre lo comprado (`a comprar × precio`).
    pub subtotal_usd: Option<f64>,
    pub price_date: Option<String>,
}

fn round_up_to_pack(quantity_needed: f64, qty_per_pack: f64) -> f64 {
    if qty_per_pack <= 0.0 {
        return quantity_needed;
    }
    (quantity_needed / qty_per_pack).ceil() * qty_per_pack
}

fn bom_row(
    project: &Project,
    library: &Library,
    part_id: i64,
    quantity_needed: f64,
) -> Option<BomRow> {
    let part = library.parts.iter().find(|p| p.id == part_id)?;
    let spare_pct = project
        .spare_pcts
        .get(&part.category)
        .copied()
        .unwrap_or(0.0);
    let spare = quantity_needed * spare_pct / 100.0;
    let spare = if part.purchase_unit == "meter" {
        spare
    } else {
        spare.ceil()
    };
    let quantity_to_buy = round_up_to_pack(quantity_needed + spare, part.qty_per_pack);
    let billed = if project.cost_on_purchased {
        quantity_to_buy
    } else {
        quantity_needed + spare
    };
    Some(BomRow {
        library_part_id: part_id,
        category: part.category.clone(),
        part_number: part.part_number.clone(),
        quantity_needed,
        spare,
        unit: part.purchase_unit.clone(),
        quantity_to_buy,
        unit_price_usd: part.price_usd,
        subtotal_usd: part.price_usd.map(|price| price * billed),
        price_date: part.price_date.clone(),
    })
}

/// BOM agrupado por parte de biblioteca (plan 8.2), con el repuesto por
/// categoría del proyecto (plan 5.4).
pub fn bill_of_materials(data: &ProjectData, library: &Library) -> Vec<BomRow> {
    let mut quantities: HashMap<i64, f64> = HashMap::new();

    for connector in &data.connector_instances {
        *quantities.entry(connector.library_part_id).or_default() += 1.0;
        if let Some(id) = connector.backshell_library_part_id {
            *quantities.entry(id).or_default() += 1.0;
        }
        // Contacto en cada vía con cable, tapón en cada vía sin usar (del ConnectorDef).
        for cavity in &connector.cavities {
            let part = crate::contacts::cavity_contact(data, library, connector, cavity)
                .or_else(|| crate::contacts::cavity_seal_plug(data, library, connector, cavity));
            if let Some(id) = part {
                *quantities.entry(id).or_default() += 1.0;
            }
        }
    }
    for ground in &data.ground_points {
        if let Some(id) = ground.terminal_library_part_id {
            *quantities.entry(id).or_default() += 1.0;
        }
    }
    for splice in &data.splice_instances {
        *quantities.entry(splice.library_part_id).or_default() += 1.0;
    }
    // Boots y moldes en T elegidos, y la pieza de termo con adhesivo de cada
    // conector (largo de su ConnectorDef) y de cada breakout (largo del nodo).
    for connector in &data.connector_instances {
        let Some(id) = connector.termination_library_part_id else {
            continue;
        };
        match connector.termination.as_deref() {
            Some("boot_straight") | Some("boot_90") => *quantities.entry(id).or_default() += 1.0,
            Some("adhesive_heatshrink") => {
                let length = library
                    .connector_defs
                    .iter()
                    .find(|d| d.part_id == connector.library_part_id)
                    .and_then(|d| d.adhesive_heatshrink_length_mm);
                if let Some(mm) = length {
                    *quantities.entry(id).or_default() += mm / 1000.0;
                }
            }
            _ => {}
        }
    }
    for node in &data.nodes {
        let Some(id) = node.termination_library_part_id else {
            continue;
        };
        match node.termination.as_deref() {
            Some("t_mold") => *quantities.entry(id).or_default() += 1.0,
            Some("adhesive_heatshrink") => {
                if let Some(mm) = node.adhesive_heatshrink_length_mm {
                    *quantities.entry(id).or_default() += mm / 1000.0;
                }
            }
            _ => {}
        }
    }
    for cut in covering_cut_list(data, library) {
        if let Some(id) = cut.library_part_id {
            *quantities.entry(id).or_default() += cut.cut_length_mm / 1000.0;
        }
    }
    for component in &data.component_instances {
        *quantities.entry(component.library_part_id).or_default() += 1.0;
    }
    for cut in cut_list(data, library) {
        let Some(wire) = data.wire_instances.iter().find(|w| w.id == cut.wire_id) else {
            continue;
        };
        *quantities.entry(wire.library_part_id).or_default() += cut.cut_length_mm / 1000.0;
    }

    let mut rows: Vec<BomRow> = quantities
        .into_iter()
        .filter_map(|(part_id, qty)| bom_row(&data.project, library, part_id, qty))
        .collect();
    rows.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then(a.part_number.cmp(&b.part_number))
    });
    rows
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostSummary {
    pub materials_usd: f64,
    pub labor_usd: f64,
    pub markup_usd: f64,
    pub total_usd: f64,
}

/// Costos totales (plan 8.3): materiales sobre lo usado + mano de obra +
/// markup opcional (0% por defecto), todo en USD.
pub fn cost_summary(project: &Project, bom: &[BomRow]) -> CostSummary {
    let materials_usd: f64 = bom.iter().filter_map(|r| r.subtotal_usd).sum();
    let labor_usd = project.labor_hours * project.labor_rate_usd;
    let markup_usd = (materials_usd + labor_usd) * project.markup_pct / 100.0;
    CostSummary {
        materials_usd,
        labor_usd,
        markup_usd,
        total_usd: materials_usd + labor_usd + markup_usd,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::calc::test_fixtures::*;

    #[test]
    fn bom_counts_connectors_contacts_and_wire_meterage() {
        let data = one_segment_project(1000.0, Some(1_000_000.0));

        let mut library = Library::default();
        // El contacto sale del conector de la biblioteca, uno por vía con cable.
        library
            .connector_defs
            .push(crate::model::library::ConnectorDef {
                contact_part_id: Some(200),
                ..connector_def_with_series(10, "AMP", "CE")
            });
        library
            .contact_defs
            .push(crate::model::library::ContactDef {
                part_id: 200,
                gender: "female".into(),
                contact_size: "20".into(),
                gauge_min: None,
                gauge_max: None,
            });
        library.parts = vec![
            part(10, "connector", 1.0, Some(5.0)),
            part(100, "wire", 100.0, Some(0.5)),
            part(200, "contact", 50.0, Some(0.2)),
        ];
        library.wire_defs.push(wire_def(100, 2.0, None));

        let bom = bill_of_materials(&data, &library);

        let connector_row = bom.iter().find(|r| r.library_part_id == 10).unwrap();
        assert_eq!(connector_row.quantity_needed, 2.0); // X1 y X2 usan la misma parte
        assert_eq!(connector_row.quantity_to_buy, 2.0);

        let contact_row = bom.iter().find(|r| r.library_part_id == 200).unwrap();
        assert_eq!(contact_row.quantity_needed, 2.0); // el cable va de X1 a X2: un contacto en cada punta
        assert_eq!(contact_row.quantity_to_buy, 50.0); // redondeado al pack

        let wire_row = bom.iter().find(|r| r.library_part_id == 100).unwrap();
        assert!(wire_row.quantity_needed > 1.0); // 1000mm + 10% margen, en metros
        assert!(wire_row.subtotal_usd.unwrap() > 0.0);
    }

    #[test]
    fn bom_adds_spare_by_category_and_can_bill_what_is_bought() {
        let mut data = one_segment_project(1000.0, Some(1_000_000.0));
        data.project.spare_pcts = [("connector".to_string(), 10.0)].into();
        let library = Library {
            parts: vec![part(10, "connector", 5.0, Some(2.0))],
            ..Default::default()
        };

        let row = bill_of_materials(&data, &library).remove(0);
        assert_eq!(row.quantity_needed, 2.0);
        assert_eq!(row.spare, 1.0); // 10% de 2 conectores, redondeado a uno entero
        assert_eq!(row.quantity_to_buy, 5.0); // 3 redondeado al pack de 5
        assert_eq!(row.subtotal_usd, Some(6.0)); // sobre lo usado: 3 × 2

        data.project.cost_on_purchased = true;
        let row = bill_of_materials(&data, &library).remove(0);
        assert_eq!(row.subtotal_usd, Some(10.0)); // sobre lo comprado: 5 × 2
    }

    #[test]
    fn bom_adds_the_adhesive_heatshrink_piece_of_each_connector() {
        let mut data = one_segment_project(1000.0, Some(1_000_000.0));
        data.connector_instances[0].termination = Some("adhesive_heatshrink".into());
        data.connector_instances[0].termination_library_part_id = Some(7);
        let mut library = Library {
            parts: vec![part(7, "covering", 1.0, None)],
            ..Default::default()
        };
        library
            .connector_defs
            .push(crate::model::library::ConnectorDef {
                adhesive_heatshrink_length_mm: Some(40.0),
                ..connector_def_with_series(10, "AMP", "CE")
            });
        let row = bill_of_materials(&data, &library)
            .into_iter()
            .find(|r| r.library_part_id == 7)
            .unwrap();
        assert_eq!(row.quantity_needed, 0.04); // una pieza de 40 mm (solo X1 tiene termo con adhesivo)
    }

    #[test]
    fn bom_adds_the_adhesive_heatshrink_piece_of_a_breakout() {
        let mut data = one_segment_project(1000.0, Some(1_000_000.0));
        data.nodes[1].termination = Some("adhesive_heatshrink".into());
        data.nodes[1].termination_library_part_id = Some(7);
        data.nodes[1].adhesive_heatshrink_length_mm = Some(60.0);
        let library = Library {
            parts: vec![part(7, "covering", 1.0, None)],
            ..Default::default()
        };
        let row = bill_of_materials(&data, &library)
            .into_iter()
            .find(|r| r.library_part_id == 7)
            .unwrap();
        assert_eq!(row.quantity_needed, 0.06);
    }

    #[test]
    fn cost_summary_adds_labor_and_optional_markup() {
        let project = Project {
            name: "T".into(),
            harness_code: "T-01".into(),
            client: None,
            revision: None,
            main_connector_instance_id: None,
            markup_pct: 20.0,
            default_cut_margin_pct: 10.0,
            default_twist_pitch_factor: 8.0,
            fill_factor: 0.75,
            labor_hours: 2.0,
            labor_rate_usd: 25.0,
            cost_on_purchased: false,
            spare_pcts: Default::default(),
            cut_round_mm: None,
        };
        let bom = vec![BomRow {
            library_part_id: 1,
            category: "wire".into(),
            part_number: "P1".into(),
            quantity_needed: 10.0,
            spare: 0.0,
            unit: "meter".into(),
            quantity_to_buy: 10.0,
            unit_price_usd: Some(1.0),
            subtotal_usd: Some(10.0),
            price_date: None,
        }];

        let summary = cost_summary(&project, &bom);
        assert_eq!(summary.materials_usd, 10.0);
        assert_eq!(summary.labor_usd, 50.0);
        assert_eq!(summary.markup_usd, 12.0); // 20% de (10 + 50)
        assert_eq!(summary.total_usd, 72.0);
    }
}
