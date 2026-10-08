/**
 * Contenido de las hojas que se imprimen o exportan (etapa 6): lista de corte,
 * hoja de pinout por conector y lista de etiquetas. Funciones puras sobre el
 * proyecto, la biblioteca y los largos de corte ya calculados (`compute_costs`),
 * sin React, para chequearlas con `node tools/check_sheets.ts`.
 */
import type { CoveringCut, SegmentDiameterInfo, WireCutLength } from "./costTypes";
import { devicePinName, type Library } from "./libraryTypes.ts";
import { endLabel } from "./projectEdit.ts";
import type { ProjectData, WireEnd, WireInstance } from "./types";

export type CutSort = "pin" | "type" | "length";

export interface CutRow {
  wireId: number;
  id: string;
  fn: string;
  wireType: string;
  color: string;
  from: string;
  to: string;
  withTwistMm: number;
  marginPct: number;
  cutMm: number;
  /** Largo de corte puesto a mano (sin margen). */
  manual: boolean;
  twist: string | null;
  /** Conector bajo el que va el cable en la lista de corte (ver `cutGroupConnector`). */
  connectorId: number | null;
  /** Vía del cable en ese conector ("" si no tiene), para ordenar por pin. */
  pin: string;
}

export interface CutGroup {
  connectorId: number | null;
  title: string;
  rows: CutRow[];
}

export interface WireTotal {
  wireType: string;
  count: number;
  meters: number;
}

export interface PinRow {
  pin: string;
  fn: string;
  goesTo: string;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Función del cable: el nombre específico, o el tipo de señal si no tiene. */
export function wireFunction(library: Library, wire: WireInstance): string {
  return wire.specific_name || library.signal_types.find((t) => t.id === wire.signal_type_id)?.name || "—";
}

function wireType(library: Library, wire: WireInstance): string {
  const def = library.wire_defs.find((d) => d.part_id === wire.library_part_id);
  if (!def) return library.parts.find((p) => p.id === wire.library_part_id)?.part_number ?? "—";
  return def.spec ? `${def.gauge} ${def.spec}` : def.gauge;
}

const connectorOf = (project: ProjectData, end: WireEnd) =>
  end.kind === "cavity" ? (project.connector_instances.find((c) => c.cavities.some((cav) => cav.id === end.cavity_assignment_id))?.id ?? null) : null;

/**
 * Conector bajo el que va un cable en la lista de corte: el del extremo que no
 * es el conector principal (el cable X1:1 → X2:1 va con X2), o el del extremo A
 * si ninguno es el principal. Cada cable aparece una sola vez, para no cortarlo
 * dos veces. Sin conector en ningún extremo (splice a masa, por ejemplo): null.
 */
export function cutGroupConnector(project: ProjectData, wire: WireInstance): number | null {
  const ends = [connectorOf(project, wire.end_a), connectorOf(project, wire.end_b)].filter((id): id is number => id !== null);
  const main = project.project.main_connector_instance_id;
  return ends.find((id) => id !== main) ?? ends[0] ?? null;
}

/** La vía del cable en el conector de su bloque. */
function groupPin(project: ProjectData, wire: WireInstance): string {
  const connectorId = cutGroupConnector(project, wire);
  const connector = project.connector_instances.find((c) => c.id === connectorId);
  for (const end of [wire.end_a, wire.end_b]) {
    const cav = connector?.cavities.find((c) => end.kind === "cavity" && c.id === end.cavity_assignment_id);
    if (cav) return cav.cavity_id;
  }
  return "";
}

/**
 * Lista de corte (plan 8.1): un renglón por cable, ordenada por pin del
 * conector de su bloque, por tipo de cable (para cortar de corrido del mismo
 * rollo) o por largo. Los cables de un grupo
 * de trenzado quedan juntos, donde aparece el primero.
 */
export function cutListRows(project: ProjectData, library: Library, cuts: WireCutLength[], sort: CutSort): CutRow[] {
  const twistOf = new Map(project.twist_groups.flatMap((g) => g.wire_instance_ids.map((id) => [id, g.name] as const)));
  const rows = cuts.flatMap((cut): CutRow[] => {
    const wire = project.wire_instances.find((w) => w.id === cut.wire_id);
    if (!wire) return [];
    return [{
      wireId: wire.id,
      id: wire.short_id,
      fn: wireFunction(library, wire),
      wireType: wireType(library, wire),
      color: colorWord(wire.color || library.wire_defs.find((d) => d.part_id === wire.library_part_id)?.color || null),
      from: cutEndLabel(project, library, wire.end_a),
      to: cutEndLabel(project, library, wire.end_b),
      withTwistMm: cut.length_with_twist_mm,
      marginPct: cut.margin_pct,
      cutMm: cut.cut_length_mm,
      manual: cut.manual,
      twist: twistOf.get(wire.id) ?? null,
      connectorId: cutGroupConnector(project, wire),
      pin: groupPin(project, wire),
    }];
  });
  const byLength = (a: CutRow, b: CutRow) => b.cutMm - a.cutMm;
  rows.sort(
    sort === "pin"
      ? (a, b) => natural(a.pin, b.pin)
      : sort === "type"
        ? (a, b) => natural(a.wireType, b.wireType) || byLength(a, b)
        : byLength,
  );
  // Trenzados juntos: cuando aparece el primer cable de un grupo, entran todos sus cables.
  const out: CutRow[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    if (row.twist === null) out.push(row);
    else if (!placed.has(row.twist)) {
      placed.add(row.twist);
      out.push(...rows.filter((r) => r.twist === row.twist));
    }
  }
  return out;
}

/** "X9:A6 OUT11": el extremo, con el nombre del pin si es el conector de un dispositivo. */
function cutEndLabel(project: ProjectData, library: Library, end: WireEnd): string {
  const label = endLabel(project, end);
  if (end.kind !== "cavity") return label;
  const connector = project.connector_instances.find((c) => c.cavities.some((cav) => cav.id === end.cavity_assignment_id));
  const cav = connector?.cavities.find((c) => c.id === end.cavity_assignment_id);
  const pinName = connector && cav ? devicePinName(library, connector.device_connector_id, cav.cavity_id) : null;
  return pinName ? `${label} ${pinName}` : label;
}

/** Cómo se llama un nodo en las hojas: su conector, masa o splice; si no, "Breakout N" / "Node N". */
export function nodeName(project: ProjectData, nodeId: number): string {
  const holder =
    project.connector_instances.find((c) => c.node_id === nodeId) ??
    project.ground_points.find((g) => g.node_id === nodeId) ??
    project.splice_instances.find((s) => s.node_id === nodeId);
  if (holder) return holder.short_id;
  return `${project.nodes.find((n) => n.id === nodeId)?.kind === "breakout" ? "Breakout" : "Node"} ${nodeId}`;
}

export interface CoveringRow {
  segmentId: number;
  between: string;
  /** Medida nominal (3/16") o "none in library fits". */
  size: string;
  part: string;
  suggested: boolean;
  segmentMm: number;
  legsMm: number;
  overlapMm: number;
  cutMm: number;
}

/** Lista de corte de coberturas (plan 8.1): un tramo de termo por segmento con cables. */
export function coveringRows(project: ProjectData, library: Library, cuts: CoveringCut[]): CoveringRow[] {
  return cuts.flatMap((cut) => {
    const seg = project.segments.find((s) => s.id === cut.segment_id);
    if (!seg) return [];
    const def = library.covering_defs.find((c) => c.part_id === cut.library_part_id);
    return [{
      segmentId: seg.id,
      between: `${nodeName(project, seg.node_a_id)} – ${nodeName(project, seg.node_b_id)}`,
      size: def ? heatShrinkSize(def.supplied_diameter_mm) : "none in library fits",
      part: def ? (library.parts.find((p) => p.id === def.part_id)?.part_number ?? "") : "",
      suggested: cut.suggested,
      segmentMm: cut.segment_length_mm,
      legsMm: cut.legs_mm,
      overlapMm: cut.overlap_mm,
      cutMm: cut.cut_length_mm,
    }];
  });
}

/**
 * Lo que va en las puntas: boots de los conectores, moldes en T de los
 * breakouts y las piezas de termo con adhesivo (conector o breakout).
 */
export function terminationRows(project: ProjectData, library: Library): [where: string, what: string, part: string][] {
  const part = (id: number | null) => (id == null ? "not chosen" : (library.parts.find((p) => p.id === id)?.part_number ?? `#${id}`));
  const adhesive = (id: number | null, lengthMm: number | null = null) => {
    const def = library.covering_defs.find((c) => c.part_id === id);
    const what = def ? `${heatShrinkSize(def.supplied_diameter_mm)} · ${part(id)}` : part(id);
    return lengthMm != null ? `${what} · cut ${lengthMm} mm` : what;
  };
  const rows: [string, string, string][] = [];
  for (const c of project.connector_instances) {
    const where = c.name ? `${c.short_id} · ${c.name}` : c.short_id;
    if (c.termination === "boot_straight") rows.push([where, "Straight boot", part(c.termination_library_part_id)]);
    if (c.termination === "boot_90") rows.push([where, "90° boot", part(c.termination_library_part_id)]);
    const pieceMm = library.connector_defs.find((d) => d.part_id === c.library_part_id)?.adhesive_heatshrink_length_mm ?? null;
    if (c.termination === "adhesive_heatshrink") rows.push([where, "Adhesive heat-shrink", adhesive(c.termination_library_part_id, pieceMm)]);
  }
  for (const n of project.nodes) {
    if (n.termination === "t_mold") rows.push([nodeName(project, n.id), "T-mold", part(n.termination_library_part_id)]);
    if (n.termination === "adhesive_heatshrink") rows.push([nodeName(project, n.id), "Adhesive heat-shrink", adhesive(n.termination_library_part_id)]);
  }
  return rows;
}

/**
 * La lista de corte dividida por conector (en el orden de los conectores del
 * proyecto; "Other" al final), manteniendo el orden de `rows` dentro de cada
 * bloque. Un trenzado va entero al bloque de su primer cable.
 */
export function cutListGroups(project: ProjectData, rows: CutRow[]): CutGroup[] {
  const groupOfTwist = new Map<string, number | null>();
  const byConnector = new Map<number | null, CutRow[]>();
  for (const row of rows) {
    if (row.twist !== null && !groupOfTwist.has(row.twist)) groupOfTwist.set(row.twist, row.connectorId);
    const key = row.twist !== null ? groupOfTwist.get(row.twist)! : row.connectorId;
    byConnector.set(key, [...(byConnector.get(key) ?? []), row]);
  }
  const groups: CutGroup[] = project.connector_instances
    .filter((c) => byConnector.has(c.id))
    .map((c) => ({ connectorId: c.id, title: c.name ? `${c.short_id} · ${c.name}` : c.short_id, rows: byConnector.get(c.id)! }));
  if (byConnector.has(null)) groups.push({ connectorId: null, title: "Other (splices, grounds, components)", rows: byConnector.get(null)! });
  return groups;
}

/**
 * El color en palabras, para que se lea en una hoja impresa en blanco y negro:
 * el texto tal cual (así se carga normalmente: "violet", "red/white"), y si es
 * un código hexadecimal, el nombre del color más parecido.
 */
export function colorWord(color: string | null): string {
  const c = color?.trim();
  if (!c) return "—";
  const hex = /^#?([0-9a-f]{6})$/i.exec(c)?.[1];
  if (!hex) return c;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return COLOR_NAMES.reduce((best, named) =>
    (named[1] - r) ** 2 + (named[2] - g) ** 2 + (named[3] - b) ** 2 < (best[1] - r) ** 2 + (best[2] - g) ** 2 + (best[3] - b) ** 2 ? named : best,
  )[0];
}

const COLOR_NAMES: [string, number, number, number][] = [
  ["black", 0, 0, 0], ["white", 255, 255, 255], ["grey", 128, 128, 128], ["red", 220, 0, 0], ["orange", 255, 140, 0],
  ["yellow", 255, 220, 0], ["green", 0, 150, 0], ["blue", 0, 60, 220], ["violet", 130, 0, 220], ["brown", 130, 70, 20],
  ["pink", 255, 150, 190],
];

/** Medidas nominales de termocontraíble (pulgadas, diámetro suministrado). */
const HEAT_SHRINK_INCHES: [number, string][] = [
  [1 / 16, "1/16"], [3 / 32, "3/32"], [1 / 8, "1/8"], [3 / 16, "3/16"], [1 / 4, "1/4"], [3 / 8, "3/8"],
  [1 / 2, "1/2"], [3 / 4, "3/4"], [1, "1"], [1.5, "1-1/2"], [2, "2"],
];

/** "3/16\"" si el diámetro suministrado es una medida nominal en pulgadas; si no, en mm. */
export function heatShrinkSize(suppliedMm: number): string {
  const nominal = HEAT_SHRINK_INCHES.find(([inches]) => Math.abs(inches * 25.4 - suppliedMm) < 0.25);
  return nominal ? `${nominal[1]}"` : `${suppliedMm.toFixed(1)} mm`;
}

/**
 * Termocontraíble del tramo que llega a un conector (lista de corte, título de
 * cada bloque): el asignado al segmento o, si no tiene, el más chico de la
 * biblioteca que sirve para su diámetro (sugerido por `compute_costs`). Sin
 * ninguno que sirva, el diámetro del mazo para saber qué comprar.
 */
export function connectorHeatShrink(project: ProjectData, library: Library, connectorId: number, diameters: SegmentDiameterInfo[]): string[] {
  const connector = project.connector_instances.find((c) => c.id === connectorId);
  if (!connector) return [];
  const notes = project.segments
    .filter((seg) => seg.node_a_id === connector.node_id || seg.node_b_id === connector.node_id)
    .map((seg) => {
      const supplied = (partId: number | null) => library.covering_defs.find((c) => c.part_id === partId)?.supplied_diameter_mm;
      const info = diameters.find((d) => d.segment_id === seg.id);
      const assigned = supplied(seg.covering_library_part_id);
      if (assigned !== undefined) return heatShrinkSize(assigned);
      const suggested = info?.covering_options.find((o) => o.fits);
      if (suggested) return `${heatShrinkSize(suggested.supplied_diameter_mm)} (suggested)`;
      return info ? `none in library fits · bundle Ø ${info.final_diameter_mm.toFixed(1)} mm` : null;
    });
  return [...new Set(notes.filter((n): n is string => n !== null))];
}

/** Metros a cortar de cada tipo de cable (plan 8.1, totales por WireDef). */
export function wireTotals(rows: CutRow[]): WireTotal[] {
  const totals = new Map<string, WireTotal>();
  for (const row of rows) {
    const t = totals.get(row.wireType) ?? { wireType: row.wireType, count: 0, meters: 0 };
    t.count += 1;
    t.meters += row.cutMm / 1000;
    totals.set(row.wireType, t);
  }
  return [...totals.values()].sort((a, b) => natural(a.wireType, b.wireType));
}

const isCavity = (end: WireEnd, cavityId: number) => end.kind === "cavity" && end.cavity_assignment_id === cavityId;

/**
 * "Termina en" de un pin (plan 4.3): los otros extremos de su net que no son
 * uniones — pines de conector, masas, componentes —, y por qué splices pasa.
 * `netOf` devuelve los cables de la net de un cable (comando `wire_net`).
 */
export function terminatesAt(project: ProjectData, library: Library, cavityId: number, netOf: (wireId: number) => number[]): string {
  const here = project.wire_instances.filter((w) => isCavity(w.end_a, cavityId) || isCavity(w.end_b, cavityId));
  const netIds = new Set(here.flatMap((w) => [w.id, ...netOf(w.id)]));
  const dests: string[] = [];
  const via: string[] = [];
  for (const wire of project.wire_instances.filter((w) => netIds.has(w.id))) {
    for (const end of [wire.end_a, wire.end_b]) {
      if (isCavity(end, cavityId)) continue;
      const label =
        end.kind === "cavity"
          ? cavityLabel(project, library, end.cavity_assignment_id)
          : end.kind === "ground"
            ? groundLabel(project, end.ground_point_id)
            : endLabel(project, end);
      const list = end.kind === "splice" ? via : dests;
      if (label !== "—" && !list.includes(label)) list.push(label);
    }
  }
  if (dests.length === 0 && via.length === 0) return "—";
  return `${dests.join(", ") || "—"}${via.length ? ` (via ${via.join(", ")})` : ""}`;
}

/** "G1 · Chassis": la masa con su nombre. */
function groundLabel(project: ProjectData, groundId: number | null): string {
  const g = project.ground_points.find((x) => x.id === groundId);
  if (!g) return "—";
  return g.name ? `${g.short_id} · ${g.name}` : g.short_id;
}

/**
 * "X9:28 · PDM30": el pin y el nombre de su conector; si es el conector de un
 * dispositivo, primero el nombre del pin, como en las planillas del taller:
 * "PDM30 · OUT11 (X9:A6)".
 */
function cavityLabel(project: ProjectData, library: Library, cavityId: number | null): string {
  const connector = project.connector_instances.find((c) => c.cavities.some((cav) => cav.id === cavityId));
  const cav = connector?.cavities.find((c) => c.id === cavityId);
  if (!connector || !cav) return "—";
  const pin = `${connector.short_id}:${cav.cavity_id}`;
  const pinName = devicePinName(library, connector.device_connector_id, cav.cavity_id);
  if (pinName) return `${connector.name || connector.short_id} · ${pinName} (${pin})`;
  return connector.name ? `${pin} · ${connector.name}` : pin;
}

/**
 * Hoja de pinout de un conector, con el formato de las hojas del taller:
 * un renglón por vía — Pin · Función · Termina en. Si una vía tiene varios
 * cables, sus funciones van juntas; sin cable, "n/c" y su referencia externa
 * (qué hay del otro lado) si la tiene.
 */
export function pinoutRows(project: ProjectData, library: Library, connectorId: number, netOf: (wireId: number) => number[]): PinRow[] {
  const connector = project.connector_instances.find((c) => c.id === connectorId);
  if (!connector) return [];
  return connector.cavities.map((cav) => {
    // En el conector de un dispositivo, la función es el nombre del pin (OUT11), como en la planilla del PDM.
    const pinName = devicePinName(library, connector.device_connector_id, cav.cavity_id);
    const wires = project.wire_instances.filter((w) => isCavity(w.end_a, cav.id) || isCavity(w.end_b, cav.id));
    if (wires.length === 0) return { pin: cav.cavity_id, fn: pinName ?? "n/c", goesTo: cav.external_reference ?? "" };
    const goesTo = terminatesAt(project, library, cav.id, netOf);
    return {
      pin: cav.cavity_id,
      fn: pinName ?? [...new Set(wires.map((w) => wireFunction(library, w)))].join(" / "),
      goesTo: goesTo === "—" ? (cav.external_reference ?? "—") : goesTo,
    };
  });
}

/**
 * Lista de etiquetas (plan 7.4): el arnés (nombre + código, va en el conector
 * principal), cada conector (su nombre descriptivo) y los cables con etiqueta.
 */
export function labelRows(project: ProjectData): [kind: string, id: string, text: string][] {
  const p = project.project;
  const main = project.connector_instances.find((c) => c.id === p.main_connector_instance_id);
  return [
    ["Harness", main?.short_id ?? "", [p.name, p.harness_code].filter(Boolean).join(" · ")],
    ...project.connector_instances.map((c): [string, string, string] => ["Connector", c.short_id, c.name]),
    ...project.wire_instances.filter((w) => w.label).map((w): [string, string, string] => ["Wire", w.short_id, w.label!]),
  ];
}

/** CSV con encabezado; comillas solo donde hacen falta. */
export function toCsv(header: string[], rows: string[][]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
