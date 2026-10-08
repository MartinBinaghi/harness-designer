// Espejo de los structs serde en src-tauri/src/model/library.rs.

export type PartCategory =
  | "connector"
  | "device"
  | "contact"
  | "seal_plug"
  | "wire"
  | "splice"
  | "component"
  | "covering"
  | "accessory";

export interface Part {
  id: number;
  part_number: string;
  manufacturer: string | null;
  description: string | null;
  category: PartCategory;
  purchase_unit: "unit" | "meter";
  qty_per_pack: number;
  price_usd: number | null;
  price_date: string | null;
}

export interface ConnectorDefCavity {
  cavity_id: string;
  contact_size: string;
}

export interface ConnectorDef {
  part_id: number;
  gender: "male" | "female";
  series: string | null;
  shell_size: string | null;
  counterpart_id: number | null;
  /** Parte trasera, por donde pasa el termo con adhesivo: redonda (Ø) o rectangular (ancho × alto). */
  back_shape: "round" | "rectangular" | null;
  back_diameter_mm: number | null;
  back_width_mm: number | null;
  back_height_mm: number | null;
  suggested_termination: "boot" | "adhesive_heatshrink" | "none" | null;
  /** Contacto de las vías con cable y tapón de las vías sin usar: uno por conector. */
  contact_part_id: number | null;
  seal_plug_part_id: number | null;
  /** Largo de la pieza de termo con adhesivo detrás del conector (varía según el conector). */
  adhesive_heatshrink_length_mm: number | null;
  image_side: string | null;
  image_front: string | null;
  image_back: string | null;
  cavities: ConnectorDefCavity[];
}

export interface DeviceDefPin {
  id: number;
  cavity_id: string;
  name: string;
  function: string | null;
}

export interface DeviceDefConnector {
  id: number;
  label: string;
  connector_def_id: number;
  pins: DeviceDefPin[];
}

/** Un nombre repetido en dos vías de un conector (OUT1 en A1 y A10) es una misma salida en dos pines. */
export interface DeviceDef {
  part_id: number;
  connectors: DeviceDefConnector[];
}

export interface ContactDef {
  part_id: number;
  gender: "male" | "female";
  contact_size: string;
  gauge_min: string | null;
  gauge_max: string | null;
}

export interface SealPlugDef {
  part_id: number;
  contact_size: string;
}

export interface WireDefConductor {
  id: number;
  label: string | null;
  gauge: string | null;
  color: string | null;
  is_shield: boolean;
}

export interface WireDef {
  part_id: number;
  gauge: string;
  spec: string | null;
  color: string | null;
  outer_diameter_mm: number;
  default_cut_margin_pct: number | null;
  conductors: WireDefConductor[];
}

export interface SpliceDef {
  part_id: number;
  gauge_min: string | null;
  gauge_max: string | null;
  max_wires: number;
}

export interface ComponentDef {
  part_id: number;
  component_type: string;
  value: string | null;
  package: string | null;
}

export interface CoveringDef {
  part_id: number;
  supplied_diameter_mm: number;
  shrunk_diameter_mm: number;
  shrunk_wall_thickness_mm: number;
  has_adhesive: boolean;
}

export interface AccessoryDefConnectorMatch {
  series: string;
  shell_size: string;
}

export interface AccessoryDef {
  part_id: number;
  orientation: "straight" | "right_angle";
  cable_side_min_diameter_mm: number;
  cable_side_max_diameter_mm: number;
  leg_length_mm: number;
  overlap_mm: number;
  compatible_connectors: AccessoryDefConnectorMatch[];
}

export interface TMoldLeg {
  min_diameter_mm: number;
  max_diameter_mm: number;
  leg_length_mm: number;
}

export interface TMoldDef {
  part_id: number;
  overlap_mm: number;
  legs: TMoldLeg[];
}

export interface SignalType {
  id: number;
  name: string;
  default_color: string;
}

export interface Library {
  parts: Part[];
  connector_defs: ConnectorDef[];
  device_defs: DeviceDef[];
  contact_defs: ContactDef[];
  seal_plug_defs: SealPlugDef[];
  wire_defs: WireDef[];
  splice_defs: SpliceDef[];
  component_defs: ComponentDef[];
  covering_defs: CoveringDef[];
  accessory_defs: AccessoryDef[];
  t_mold_defs: TMoldDef[];
  signal_types: SignalType[];
}

export function emptyLibrary(): Library {
  return {
    parts: [],
    connector_defs: [],
    device_defs: [],
    contact_defs: [],
    seal_plug_defs: [],
    wire_defs: [],
    splice_defs: [],
    component_defs: [],
    covering_defs: [],
    accessory_defs: [],
    t_mold_defs: [],
    signal_types: [],
  };
}

/** Vistas de un conector que se pueden cargar como imagen (plan 4.1). */
export const CONNECTOR_VIEWS = [
  { key: "image_front", label: "Front" },
  { key: "image_side", label: "Side" },
  { key: "image_back", label: "Back" },
] as const;

/**
 * Lo que se puede elegir como parte de un conector del proyecto: una carcasa
 * de la biblioteca, o el conector de un dispositivo ("MOTEC-PDM30 · A"), que
 * trae su carcasa y el nombre de cada pin.
 */
export interface ConnectorChoice {
  key: string;
  label: string;
  partId: number;
  deviceConnectorId: number | null;
}

export const choiceKey = (partId: number, deviceConnectorId: number | null) =>
  deviceConnectorId != null ? `d${deviceConnectorId}` : `c${partId}`;

export function connectorChoices(library: Library): ConnectorChoice[] {
  const devices = library.device_defs.flatMap((dd) =>
    dd.connectors.map((dc) => ({
      key: choiceKey(dc.connector_def_id, dc.id),
      label: `${partLabel(library, dd.part_id)} · ${dc.label}`,
      partId: dc.connector_def_id,
      deviceConnectorId: dc.id,
    })),
  );
  const housings = library.connector_defs.map((cd) => ({
    key: choiceKey(cd.part_id, null),
    label: partLabel(library, cd.part_id),
    partId: cd.part_id,
    deviceConnectorId: null,
  }));
  return [...devices, ...housings];
}

/** Nombre del pin del dispositivo en esa vía ("OUT11"), si el conector es de un dispositivo. */
export function devicePinName(library: Library, deviceConnectorId: number | null, cavityId: string): string | null {
  if (deviceConnectorId == null) return null;
  for (const dd of library.device_defs) {
    const dc = dd.connectors.find((c) => c.id === deviceConnectorId);
    if (dc) return dc.pins.find((p) => p.cavity_id === cavityId)?.name || null;
  }
  return null;
}

/** Número de parte para mostrar en listas y selects ("—" si no hay parte). */
export function partLabel(library: Library, partId: number | null | undefined): string {
  if (partId == null) return "—";
  const part = library.parts.find((p) => p.id === partId);
  return part ? part.part_number || `#${partId}` : `#${partId} (not in library)`;
}
