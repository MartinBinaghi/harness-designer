// Espejo de los structs serde en src-tauri/src/calc.rs.

export interface WireCutLength {
  wire_id: number;
  length_with_twist_mm: number;
  margin_pct: number;
  twist_min_margin_pct: number;
  cut_length_mm: number;
  /** El largo de corte se puso a mano. */
  manual: boolean;
}

export interface BomRow {
  library_part_id: number;
  category: string;
  part_number: string;
  quantity_needed: number;
  /** Repuesto por categoría (% del proyecto). */
  spare: number;
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

export interface SpliceOutputGaugeFit {
  wire_def_part_id: number;
  gauge: string;
  fits: boolean;
}

export interface SpliceOutputGaugeInfo {
  splice_instance_id: number;
  combined_mm2: number;
  options: SpliceOutputGaugeFit[];
}

/** Tramo de termo de un segmento: largo − patas de boots/moldes + solape. */
export interface CoveringCut {
  segment_id: number;
  /** El asignado al segmento o, si no tiene, el sugerido; null si ninguno sirve. */
  library_part_id: number | null;
  suggested: boolean;
  segment_length_mm: number;
  legs_mm: number;
  overlap_mm: number;
  cut_length_mm: number;
}

export interface CostReport {
  cut_list: WireCutLength[];
  bom: BomRow[];
  cost_summary: CostSummary;
  segment_diameters: SegmentDiameterInfo[];
  connector_terminations: ConnectorTerminationInfo[];
  breakout_terminations: BreakoutTerminationInfo[];
  splice_output_gauges: SpliceOutputGaugeInfo[];
  covering_cuts: CoveringCut[];
}
