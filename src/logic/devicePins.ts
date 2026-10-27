/**
 * Pinout de un conector de dispositivo (Library → Devices): una fila por vía de
 * la carcasa del arnés, edición de nombre/función y pegado de la tabla que
 * manda el cliente. Funciones puras, sin React: `node tools/check_device_pins.ts`.
 *
 * Un nombre repetido en dos vías (OUT1 en A1 y A10) es una misma salida
 * repartida en dos pines ("pines en paralelo"): no hay otra cosa que cargar.
 */
import type { ConnectorDef, DeviceDefConnector, Library } from "./libraryTypes.ts";

export interface DevicePinRow {
  cavityId: string;
  name: string;
  fn: string;
  /** false: el pin está cargado en una vía que la carcasa elegida no tiene. */
  inHousing: boolean;
  /** Otras vías del conector con el mismo nombre (pines en paralelo). */
  alsoOn: string[];
}

/** Una fila por vía de la carcasa, en su orden, y al final los pines en vías que la carcasa no tiene. */
export function devicePinRows(connector: DeviceDefConnector, housing: ConnectorDef | undefined): DevicePinRow[] {
  const cavities = housing?.cavities.map((c) => c.cavity_id) ?? [];
  const extra = connector.pins.map((p) => p.cavity_id).filter((id) => !cavities.includes(id));
  return [...cavities, ...extra].map((cavityId) => {
    const pin = connector.pins.find((p) => p.cavity_id === cavityId);
    const name = pin?.name ?? "";
    return {
      cavityId,
      name,
      fn: pin?.function ?? "",
      inHousing: cavities.includes(cavityId),
      alsoOn: name ? connector.pins.filter((p) => p.name === name && p.cavity_id !== cavityId).map((p) => p.cavity_id) : [],
    };
  });
}

/** Próximo id libre para pines o conectores de dispositivo: son únicos en toda la biblioteca. */
export function nextDeviceId(library: Library, what: "pins" | "connectors"): number {
  const ids = library.device_defs.flatMap((d) => (what === "connectors" ? d.connectors.map((c) => c.id) : d.connectors.flatMap((c) => c.pins.map((p) => p.id))));
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

/** Nombre y/o función de una vía; si los dos quedan vacíos, el pin se borra. */
export function setDevicePin(connector: DeviceDefConnector, cavityId: string, patch: { name?: string; fn?: string }, newId: number): DeviceDefConnector {
  const current = connector.pins.find((p) => p.cavity_id === cavityId);
  const name = patch.name ?? current?.name ?? "";
  const fn = patch.fn ?? current?.function ?? "";
  const others = connector.pins.filter((p) => p.cavity_id !== cavityId);
  if (!name && !fn) return { ...connector, pins: others };
  const pin = { id: current?.id ?? newId, cavity_id: cavityId, name, function: fn || null };
  return { ...connector, pins: current ? connector.pins.map((p) => (p === current ? pin : p)) : [...others, pin] };
}

/**
 * Texto pegado de un Excel o de un PDF → filas de celdas. Las columnas se
 * separan por tabulación (Excel); si no hay, por ";" o por dos o más espacios
 * (texto copiado de un PDF).
 */
export function parsePinout(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines.some((l) => l.includes("\t")) ? /\t/ : lines.some((l) => l.includes(";")) ? /;/ : / {2,}/;
  return lines.map((l) => l.split(sep).map((c) => c.trim()));
}

export type ColumnRole = "cavity" | "name" | "function" | "ignore";

/** Rol inicial de cada columna: vía, nombre, función y el resto se ignora. */
export function guessRoles(columns: number): ColumnRole[] {
  return Array.from({ length: columns }, (_, i): ColumnRole => (["cavity", "name", "function"] as const)[i] ?? "ignore");
}

export interface PasteRow {
  cavity: string;
  name: string;
  fn: string;
  /** La vía de la carcasa a la que corresponde, o null (no existe: encabezado, otra carcasa…). */
  match: string | null;
}

/**
 * Cada fila pegada con la vía de la carcasa que le corresponde: igual, o sin
 * distinguir mayúsculas si así es única (en un Amphenol "N" y "n" son vías
 * distintas, y ahí tiene que coincidir exacto). Con la letra del conector
 * adelante ("A6" en el conector A, como escribe MoTeC) también es la vía 6.
 */
export function previewPaste(rows: string[][], roles: ColumnRole[], cavityIds: string[], label = ""): PasteRow[] {
  const cell = (row: string[], role: ColumnRole) => {
    const i = roles.indexOf(role);
    return i >= 0 ? (row[i] ?? "") : "";
  };
  return rows.map((row) => {
    const cavity = cell(row, "cavity");
    const find = (text: string) => {
      const loose = cavityIds.filter((id) => id.toLowerCase() === text.toLowerCase());
      return cavityIds.includes(text) ? text : loose.length === 1 ? loose[0] : null;
    };
    const prefixed = label && cavity.toLowerCase().startsWith(label.toLowerCase()) ? find(cavity.slice(label.length)) : null;
    return { cavity, name: cell(row, "name"), fn: cell(row, "function"), match: find(cavity) ?? prefixed };
  });
}

/** Aplica las filas que corresponden a una vía. Sin `replace`, no pisa lo que ya estaba escrito. */
export function applyPaste(connector: DeviceDefConnector, rows: PasteRow[], replace: boolean, firstNewId: number): DeviceDefConnector {
  let next = connector;
  let id = firstNewId;
  for (const r of rows) {
    if (!r.match) continue;
    const current = next.pins.find((p) => p.cavity_id === r.match);
    const patch = {
      name: replace || !current?.name ? r.name : current.name,
      fn: replace || !current?.function ? r.fn : current.function,
    };
    next = setDevicePin(next, r.match, patch, id);
    if (!current) id += 1;
  }
  return next;
}
