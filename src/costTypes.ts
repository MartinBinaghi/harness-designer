// Espejo de los structs serde en src-tauri/src/calc.rs.

export interface WireCutLength {
  wire_id: number;
  length_with_twist_mm: number;
  margin_pct: number;
  twist_min_margin_pct: number;
  cut_length_mm: number;
}

export interface BomRow {
  library_part_id: number;
  category: string;
  part_number: string;
  quantity_needed: number;
  unit: string;
  quantity_to_buy: number;
  unit_price_usd: number | null;
  subtotal_usd: number | null;
  price_date: string | null;
}

export interface CostSummary {
  materials_usd: number;
  labor_usd: number;
  markup_usd: number;
  total_usd: number;
}

export interface CoveringFit {
  library_part_id: number;
  supplied_diameter_mm: number;
  shrunk_diameter_mm: number;
  fits: boolean;
}

export interface SegmentDiameterInfo {
  segment_id: number;
  bundle_diameter_mm: number;
  final_diameter_mm: number;
  covering_options: CoveringFit[];
}

export interface BootFit {
  library_part_id: number;
  connector_compatible: boolean;
  cable_side_ok: boolean;
  fits: boolean;
}

export interface ConnectorTerminationInfo {
  connector_instance_id: number;
  boot_options: BootFit[];
}

export interface TMoldLegFit {
  segment_id: number;
  diameter_mm: number;
  fits: boolean;
}

export interface TMoldFit {
  library_part_id: number;
  leg_fits: TMoldLegFit[];
  fits: boolean;
}

export interface BreakoutTerminationInfo {
  node_id: number;
  t_mold_options: TMoldFit[];
}

export interface CostReport {
  cut_list: WireCutLength[];
  bom: BomRow[];
  cost_summary: CostSummary;
  segment_diameters: SegmentDiameterInfo[];
  connector_terminations: ConnectorTerminationInfo[];
  breakout_terminations: BreakoutTerminationInfo[];
}
