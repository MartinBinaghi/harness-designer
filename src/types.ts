// Espejo de los structs serde en src-tauri/src/model/project.rs.

export interface Project {
  name: string;
  harness_code: string;
  client: string | null;
  revision: string | null;
  format_version: number;
  main_connector_instance_id: number | null;
  markup_pct: number;
  default_cut_margin_pct: number;
  default_twist_pitch_factor: number;
  fill_factor: number;
  labor_hours: number;
  labor_rate_usd: number;
}

export interface Node {
  id: number;
  kind: "connector_end" | "breakout" | "splice_point" | "ground_point";
  termination: "t_mold" | "adhesive_heatshrink" | "none" | null;
  /** Solo tiene sentido con termination = "adhesive_heatshrink" (un CoveringDef). */
  termination_library_part_id: number | null;
  /** Posición en el diagrama de armado; null hasta acomodarlo (a mano o con el layout automático). */
  diagram_x: number | null;
  diagram_y: number | null;
}

export interface Segment {
  id: number;
  node_a_id: number;
  node_b_id: number;
  length_mm: number;
  twist_pitch_mm: number | null;
  covering_library_part_id: number | null;
}

/** Una vía del conector. El contacto y el tapón no se cargan acá: salen del ConnectorDef (contacts.rs). */
export interface CavityAssignment {
  id: number;
  cavity_id: string;
  external_reference: string | null;
}

export interface ConnectorInstance {
  id: number;
  short_id: string;
  name: string;
  library_part_id: number;
  /**
   * Si es el conector de un dispositivo (ej. "MOTEC-PDM30 · A"): el
   * DeviceDefConnector de la biblioteca, que da el nombre de cada pin (OUT11,
   * AV3). `library_part_id` sigue siendo la carcasa.
   */
  device_connector_id: number | null;
  node_id: number;
  termination: string | null;
  /** AccessoryDef si termination es boot_straight/boot_90, CoveringDef si es adhesive_heatshrink. */
  termination_library_part_id: number | null;
  backshell_library_part_id: number | null;
  status: "complete" | "pending";
  is_interconnect: boolean;
  mates_with: string | null;
  cavities: CavityAssignment[];
}

export interface GroundPoint {
  id: number;
  short_id: string;
  name: string;
  terminal_library_part_id: number | null;
  node_id: number;
}

export interface SpliceInstance {
  id: number;
  short_id: string;
  library_part_id: number;
  node_id: number | null;
  segment_id: number | null;
  offset_from_end_mm: number | null;
  offset_from_node_id: number | null;
}

export interface ComponentInstance {
  id: number;
  short_id: string;
  name: string;
  library_part_id: number;
  node_id: number | null;
  segment_id: number | null;
  offset_from_end_mm: number | null;
  offset_from_node_id: number | null;
}

export interface WireEnd {
  kind: "cavity" | "splice" | "ground" | "component";
  cavity_assignment_id: number | null;
  splice_id: number | null;
  ground_point_id: number | null;
  component_instance_id: number | null;
}

export interface WireInstance {
  id: number;
  short_id: string;
  library_part_id: number;
  color: string | null;
  signal_type_id: number | null;
  specific_name: string | null;
  manual_cut_margin_pct: number | null;
  /** Largo de corte puesto a mano (mm): manda sobre el calculado por el recorrido. */
  manual_length_mm: number | null;
  label: string | null;
  end_a: WireEnd;
  end_b: WireEnd;
}

export interface TwistGroup {
  id: number;
  name: string;
  shielded: boolean;
  drain: boolean;
  wire_instance_ids: number[];
}

/** Espejo de state::HistoryStatus / state::ProjectStatus (src-tauri). El
 * historial de undo/redo vive en el backend; esto es lo que el frontend
 * consulta para habilitar/deshabilitar los botones de Undo/Redo. */
export interface HistoryStatus {
  can_undo: boolean;
  can_redo: boolean;
}

export interface ProjectStatus extends HistoryStatus {
  loaded: boolean;
}

/** Elemento seleccionado, compartido entre el árbol, el inspector y las tablas de cada pantalla. */
export type Selection =
  | { kind: "node"; id: number }
  | { kind: "segment"; id: number }
  | { kind: "connector"; id: number }
  | { kind: "ground"; id: number }
  | { kind: "splice"; id: number }
  | { kind: "wire"; id: number }
  | null;

/** Espejo de checks::Finding (src-tauri). Clickear uno con `target` selecciona
 * ese elemento, igual que clickear su fila en cualquier otra pantalla. */
export interface Finding {
  severity: "error" | "warning";
  message: string;
  target: NonNullable<Selection> | null;
}

export interface ProjectData {
  project: Project;
  nodes: Node[];
  segments: Segment[];
  connector_instances: ConnectorInstance[];
  ground_points: GroundPoint[];
  splice_instances: SpliceInstance[];
  component_instances: ComponentInstance[];
  wire_instances: WireInstance[];
  twist_groups: TwistGroup[];
}
