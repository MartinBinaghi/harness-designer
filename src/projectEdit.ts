/**
 * Ediciones del proyecto que se pueden disparar desde más de una pantalla
 * (tablas y diagrama). Funciones puras: reciben el proyecto y devuelven uno
 * nuevo, o un mensaje si la operación no es válida. Sin React, para poder
 * chequearlas con `node tools/check_project_edit.ts`.
 */
import type { CavityAssignment, ConnectorInstance, Node, ProjectData, Segment, WireEnd, WireInstance } from "./types";
import { devicePinName, gaugeMm2, type Library } from "./libraryTypes.ts";

export function nextId(ids: number[]): number {
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

/** Vías de un conector nuevo, copiadas de su ConnectorDef, con ids únicos en todo el proyecto. */
export function cavitiesFromDef(project: ProjectData, connectorDefId: number, library: Library): CavityAssignment[] {
  const def = library.connector_defs.find((cd) => cd.part_id === connectorDefId);
  if (!def) return [];
  let nextCavityId = nextId(project.connector_instances.flatMap((c) => c.cavities.map((cav) => cav.id)));
  return def.cavities.map((cav) => ({
    id: nextCavityId++,
    cavity_id: cav.cavity_id,
    external_reference: null,
  }));
}

const DEFAULT_SEGMENT_MM = 100;

function newNode(id: number, kind: Node["kind"], x: number | null, y: number | null): Node {
  return { id, kind, termination: null, termination_library_part_id: null, diagram_x: x, diagram_y: y, adhesive_heatshrink_length_mm: null };
}

/** ¿Están `a` y `b` en la misma rama del árbol (unidos por segmentos)? */
function connected(project: ProjectData, a: number, b: number): boolean {
  const seen = new Set([a]);
  const queue = [a];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === b) return true;
    for (const s of project.segments) {
      const other = s.node_a_id === id ? s.node_b_id : s.node_b_id === id ? s.node_a_id : null;
      if (other !== null && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return false;
}

/** Rama nueva: un nodo de conector (sin conector asignado todavía) colgado de `fromNodeId`. */
export function addBranch(project: ProjectData, fromNodeId: number, position: { x: number; y: number }): { project: ProjectData; nodeId: number } {
  const nodeId = nextId(project.nodes.map((n) => n.id));
  const segment: Segment = {
    id: nextId(project.segments.map((s) => s.id)),
    node_a_id: fromNodeId,
    node_b_id: nodeId,
    length_mm: DEFAULT_SEGMENT_MM,
    twist_pitch_mm: null,
    covering_library_part_id: null,
  };
  return {
    project: {
      ...project,
      nodes: [...project.nodes, newNode(nodeId, "connector_end", Math.round(position.x), Math.round(position.y))],
      segments: [...project.segments, segment],
    },
    nodeId,
  };
}

/** Une dos nodos con un segmento nuevo. La topología es un árbol: rechaza lo que cerraría un lazo. */
export function connectNodes(project: ProjectData, a: number, b: number): ProjectData | string {
  if (a === b) return "A segment needs two different nodes.";
  if (connected(project, a, b)) return "Those nodes are already joined through the tree — a new segment would close a loop.";
  const segment: Segment = {
    id: nextId(project.segments.map((s) => s.id)),
    node_a_id: a,
    node_b_id: b,
    length_mm: DEFAULT_SEGMENT_MM,
    twist_pitch_mm: null,
    covering_library_part_id: null,
  };
  return { ...project, segments: [...project.segments, segment] };
}

export function setSegmentLength(project: ProjectData, segmentId: number, lengthMm: number): ProjectData {
  return { ...project, segments: project.segments.map((s) => (s.id === segmentId ? { ...s, length_mm: lengthMm } : s)) };
}

/**
 * Parte un segmento en dos con un breakout en el medio (largos redondeados a
 * mm, la suma no cambia). Los splices/componentes que estaban sobre el
 * segmento quedan en el tramo que les toca, a la misma distancia real del
 * nodo A. El tramo nuevo copia paso de trenzado y cobertura.
 */
export function splitSegment(project: ProjectData, segmentId: number, position: { x: number; y: number } | null): { project: ProjectData; nodeId: number } | string {
  const seg = project.segments.find((s) => s.id === segmentId);
  if (!seg) return "Segment not found.";
  const half = Math.round(seg.length_mm / 2);
  const mid = nextId(project.nodes.map((n) => n.id));
  const second: Segment = { ...seg, id: nextId(project.segments.map((s) => s.id)), node_a_id: mid, length_mm: seg.length_mm - half };
  const first: Segment = { ...seg, node_b_id: mid, length_mm: half };

  // Distancia desde el nodo A -> tramo y distancia nueva.
  const relocate = <T extends { segment_id: number | null; offset_from_end_mm: number | null; offset_from_node_id: number | null }>(x: T): T => {
    if (x.segment_id !== seg.id) return x;
    const off = x.offset_from_end_mm ?? 0;
    const fromA = x.offset_from_node_id === seg.node_b_id ? seg.length_mm - off : off;
    return fromA <= half
      ? { ...x, segment_id: first.id, offset_from_node_id: seg.node_a_id, offset_from_end_mm: fromA }
      : { ...x, segment_id: second.id, offset_from_node_id: mid, offset_from_end_mm: fromA - half };
  };

  const breakout = newNode(mid, "breakout", position ? Math.round(position.x) : null, position ? Math.round(position.y) : null);
  return {
    project: {
      ...project,
      nodes: [...project.nodes, breakout],
      segments: project.segments.flatMap((s) => (s.id === seg.id ? [first, second] : [s])),
      splice_instances: project.splice_instances.map(relocate),
      component_instances: project.component_instances.map(relocate),
    },
    nodeId: mid,
  };
}

export function deleteSegment(project: ProjectData, segmentId: number): ProjectData | string {
  const onIt = [...project.splice_instances, ...project.component_instances].filter((x) => x.segment_id === segmentId);
  if (onIt.length > 0) return `Segment has ${onIt.map((x) => x.short_id).join(", ")} on it — move or delete ${onIt.length === 1 ? "it" : "them"} first.`;
  return { ...project, segments: project.segments.filter((s) => s.id !== segmentId) };
}

/** Borra un nodo vacío (y sus segmentos). Si tiene algo ubicado, no lo borra: se pierde información. */
export function deleteNode(project: ProjectData, nodeId: number): ProjectData | string {
  const there = [
    ...project.connector_instances.filter((c) => c.node_id === nodeId).map((c) => c.short_id),
    ...project.ground_points.filter((g) => g.node_id === nodeId).map((g) => g.short_id),
    ...project.splice_instances.filter((s) => s.node_id === nodeId).map((s) => s.short_id),
    ...project.component_instances.filter((c) => c.node_id === nodeId).map((c) => c.short_id),
  ];
  if (there.length > 0) return `Node has ${there.join(", ")} — delete or move ${there.length === 1 ? "it" : "them"} first (Connectors / Splices).`;
  const segIds = new Set(project.segments.filter((s) => s.node_a_id === nodeId || s.node_b_id === nodeId).map((s) => s.id));
  const blocked = [...project.splice_instances, ...project.component_instances].filter((x) => x.segment_id !== null && segIds.has(x.segment_id));
  if (blocked.length > 0) return `A segment of this node has ${blocked.map((x) => x.short_id).join(", ")} on it — move ${blocked.length === 1 ? "it" : "them"} first.`;
  return {
    ...project,
    nodes: project.nodes.filter((n) => n.id !== nodeId),
    segments: project.segments.filter((s) => !segIds.has(s.id)),
  };
}

const TERMINATION_FROM_SUGGESTED: Record<string, ConnectorInstance["termination"]> = {
  boot: "boot_straight",
  adhesive_heatshrink: "adhesive_heatshrink",
  none: "none",
};

/** Conector nuevo (X{n}) en un nodo, con las vías y la terminación sugerida de su ConnectorDef. Queda pendiente hasta cargar su pinout. */
export function assignConnector(
  project: ProjectData,
  library: Library,
  nodeId: number,
  connectorDefId: number,
  name: string,
  deviceConnectorId: number | null = null,
): { project: ProjectData; connectorId: number } {
  const id = nextId(project.connector_instances.map((c) => c.id));
  const def = library.connector_defs.find((cd) => cd.part_id === connectorDefId);
  const connector: ConnectorInstance = {
    id,
    short_id: `X${id}`,
    name,
    library_part_id: connectorDefId,
    device_connector_id: deviceConnectorId,
    node_id: nodeId,
    termination: def?.suggested_termination ? TERMINATION_FROM_SUGGESTED[def.suggested_termination] ?? null : null,
    termination_library_part_id: null,
    backshell_library_part_id: null,
    status: "pending",
    is_interconnect: false,
    mates_with: null,
    cavities: cavitiesFromDef(project, connectorDefId, library),
  };
  return {
    project: {
      ...project,
      nodes: project.nodes.map((n) => (n.id === nodeId ? { ...n, kind: "connector_end" } : n)),
      connector_instances: [...project.connector_instances, connector],
    },
    connectorId: id,
  };
}

/**
 * Cable nuevo entre dos extremos (pin, splice, masa o componente), p. ej.
 * arrastrando de un pin a otro en la vista pin a pin. El tipo de cable es el
 * más usado en el proyecto (o el primero de la biblioteca); se ajusta después
 * en Wires, igual que un cable creado desde la tabla.
 */
export function addWire(project: ProjectData, library: Library, endA: WireEnd, endB: WireEnd): { project: ProjectData; wireId: number } | string {
  const same = endA.kind === endB.kind && JSON.stringify(endA) === JSON.stringify(endB);
  if (same) return "A wire needs two different ends.";
  const counts = new Map<number, number>();
  for (const w of project.wire_instances) counts.set(w.library_part_id, (counts.get(w.library_part_id) ?? 0) + 1);
  const mostUsed = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  // Que entre en el contacto del pin: el más usado si sirve; si no, el más fino de la biblioteca que sirva.
  const range = contactRange(project, library, endA) ?? contactRange(project, library, endB);
  const fits = (partId: number) => {
    const mm2 = gaugeMm2(library.wire_defs.find((d) => d.part_id === partId)?.gauge);
    return !range || mm2 === null || (mm2 >= range[0] * 0.99 && mm2 <= range[1] * 1.01);
  };
  const byGauge = [...library.wire_defs].sort((a, b) => (gaugeMm2(a.gauge) ?? 0) - (gaugeMm2(b.gauge) ?? 0)).map((d) => d.part_id);
  const partId = [mostUsed, ...byGauge].find((id) => id !== undefined && fits(id)) ?? mostUsed ?? library.wire_defs[0]?.part_id;
  if (partId === undefined) return "Add at least one wire type in Library → Wires first.";
  const id = nextId(project.wire_instances.map((w) => w.id));
  const wire: WireInstance = {
    id,
    short_id: `W${String(id).padStart(3, "0")}`,
    library_part_id: partId,
    color: null,
    signal_type_id: null,
    specific_name: null,
    manual_cut_margin_pct: null,
    manual_length_mm: null,
    label: null,
    end_a: endA,
    end_b: endB,
  };
  return { project: { ...project, wire_instances: [...project.wire_instances, wire] }, wireId: id };
}

/** Rango de sección (mm²) del contacto de la vía de un extremo, si se conoce. */
function contactRange(project: ProjectData, library: Library, end: WireEnd): [number, number] | null {
  if (end.kind !== "cavity" || end.cavity_assignment_id == null) return null;
  const connector = project.connector_instances.find((c) => c.cavities.some((cav) => cav.id === end.cavity_assignment_id));
  if (!connector) return null;
  const contactId = library.connector_defs?.find((d) => d.part_id === connector.library_part_id)?.contact_part_id;
  const contact = library.contact_defs?.find((c) => c.part_id === contactId);
  const a = gaugeMm2(contact?.gauge_min);
  const b = gaugeMm2(contact?.gauge_max);
  return a !== null && b !== null ? [Math.min(a, b), Math.max(a, b)] : null;
}

type ListKey = "nodes" | "segments" | "connector_instances" | "ground_points" | "splice_instances" | "component_instances" | "wire_instances";

/** Cambia campos de un elemento (por id) de cualquiera de las listas del proyecto. Lo usan tablas e Inspector. */
export function patchItem<K extends ListKey>(project: ProjectData, key: K, id: number, patch: Partial<ProjectData[K][number]>): ProjectData {
  const list = project[key] as Array<{ id: number }>;
  return { ...project, [key]: list.map((item) => (item.id === id ? { ...item, ...patch } : item)) };
}

/**
 * Cambia la parte (ConnectorDef) de un conector. Las vías se arman desde la
 * ficha nueva, pero las que ya existían con el mismo nombre ("1", "A"…)
 * conservan su id — y con él sus cables, contacto, tapón y referencia
 * externa. Antes se regeneraban todas y los cables quedaban sueltos. Las vías
 * que la parte nueva no tiene se descartan (Checks marca sus cables sin extremo).
 */
export function changeConnectorPart(
  project: ProjectData,
  library: Library,
  connectorId: number,
  connectorDefId: number,
  deviceConnectorId: number | null = null,
): ProjectData {
  const connector = project.connector_instances.find((c) => c.id === connectorId);
  const previous = new Map((connector?.cavities ?? []).map((cav) => [cav.cavity_id, cav]));
  const fresh = cavitiesFromDef(project, connectorDefId, library);
  const cavities = fresh.map((cav) => previous.get(cav.cavity_id) ?? cav);
  // Las vías que la nueva parte no tiene desaparecen: sus cables quedan con ese extremo vacío.
  const kept = new Set(cavities.map((cav) => cav.id));
  const gone = (end: WireEnd) => end.kind === "cavity" && end.cavity_assignment_id != null && !kept.has(end.cavity_assignment_id) && previous.has(cavityIdOf(connector, end.cavity_assignment_id));
  const loose = (end: WireEnd) => (gone(end) ? BLANK_END : end);
  const patched = patchItem(project, "connector_instances", connectorId, {
    library_part_id: connectorDefId,
    device_connector_id: deviceConnectorId,
    cavities,
  });
  return { ...patched, wire_instances: patched.wire_instances.map((w) => ({ ...w, end_a: loose(w.end_a), end_b: loose(w.end_b) })) };
}

/** El identificador de vía ("A6") de una CavityAssignment de un conector, o "" si no es suya. */
function cavityIdOf(connector: ConnectorInstance | undefined, cavityAssignmentId: number): string {
  return connector?.cavities.find((c) => c.id === cavityAssignmentId)?.cavity_id ?? "";
}

/**
 * Elegir la categoría de un cable sugiere su color (Library → Color code).
 * Solo pisa el color si estaba vacío o era el sugerido por la categoría
 * anterior: un color elegido a mano se respeta.
 */
export function wireCategoryPatch(library: Library, wire: WireInstance, signalTypeId: number | null): Partial<WireInstance> {
  const colorOf = (id: number | null) => library.signal_types.find((st) => st.id === id)?.default_color ?? null;
  const previousSuggestion = colorOf(wire.signal_type_id);
  const keepManualColor = wire.color != null && wire.color !== "" && wire.color !== previousSuggestion;
  const suggested = colorOf(signalTypeId);
  return { signal_type_id: signalTypeId, ...(keepManualColor || !suggested ? {} : { color: suggested }) };
}

// Etiquetas de los extremos de un cable ("X4:2", "SP1", "G1", "R1"): tablas, diagrama y hojas impresas.
export function cavityOptions(project: ProjectData): { value: number; label: string }[] {
  return project.connector_instances.flatMap((c) => c.cavities.map((cav) => ({ value: cav.id, label: `${c.short_id}:${cav.cavity_id}` })));
}
export function spliceOptions(project: ProjectData): { value: number; label: string }[] {
  return project.splice_instances.map((s) => ({ value: s.id, label: s.short_id }));
}
export function groundOptions(project: ProjectData): { value: number; label: string }[] {
  return project.ground_points.map((g) => ({ value: g.id, label: g.short_id }));
}
export function componentOptions(project: ProjectData): { value: number; label: string }[] {
  return project.component_instances.map((c) => ({ value: c.id, label: c.short_id }));
}

/** Human-readable label for one wire end, for both display and search. */
export function endLabel(project: ProjectData, end: WireEnd): string {
  switch (end.kind) {
    case "cavity": {
      const found = cavityOptions(project).find((o) => o.value === end.cavity_assignment_id);
      return found?.label ?? "—";
    }
    case "splice": {
      const found = spliceOptions(project).find((o) => o.value === end.splice_id);
      return found?.label ?? "—";
    }
    case "ground": {
      const found = groundOptions(project).find((o) => o.value === end.ground_point_id);
      return found?.label ?? "—";
    }
    case "component": {
      const found = componentOptions(project).find((o) => o.value === end.component_instance_id);
      return found?.label ?? "—";
    }
    default:
      return "—";
  }
}

// --- Pinout por conector (pantalla Conectores) ---------------------------------

/** Extremo sin destino todavía: el cable queda incompleto hasta que se completa (plan 7.1). */
export const BLANK_END: WireEnd = { kind: "cavity", cavity_assignment_id: null, splice_id: null, ground_point_id: null, component_instance_id: null };

const cavityEnd = (id: number): WireEnd => ({ ...BLANK_END, cavity_assignment_id: id });

/**
 * Destinos que se pueden escribir en "Goes to", con su extremo: "X4:2" por cada
 * vía, el nombre del pin en conectores de dispositivo ("PDM30 OUT11"), splices,
 * masas y componentes. Sirve para el autocompletado y para interpretar el texto.
 */
export function endChoices(project: ProjectData, library: Library): { label: string; end: WireEnd }[] {
  const out: { label: string; end: WireEnd }[] = [];
  for (const c of project.connector_instances) {
    const pins = c.cavities.map((cav) => devicePinName(library, c.device_connector_id, cav.cavity_id));
    c.cavities.forEach((cav, i) => {
      out.push({ label: `${c.short_id}:${cav.cavity_id}`, end: cavityEnd(cav.id) });
      const pin = pins[i];
      // Un nombre en dos vías (pines en paralelo) lleva la vía: "PDM30 OUT1 (A10)".
      const repeated = pins.filter((p) => p === pin).length > 1;
      if (pin) out.push({ label: `${c.name || c.short_id} ${pin}${repeated ? ` (${cav.cavity_id})` : ""}`, end: cavityEnd(cav.id) });
    });
  }
  for (const s of project.splice_instances) out.push({ label: s.short_id, end: { ...BLANK_END, kind: "splice", cavity_assignment_id: null, splice_id: s.id } });
  for (const g of project.ground_points) out.push({ label: g.short_id, end: { ...BLANK_END, kind: "ground", cavity_assignment_id: null, ground_point_id: g.id } });
  for (const k of project.component_instances) out.push({ label: k.short_id, end: { ...BLANK_END, kind: "component", cavity_assignment_id: null, component_instance_id: k.id } });
  return out;
}

/**
 * El extremo que corresponde a un texto de "Goes to", o null si no existe. El
 * conector, splice o nombre de pin no distinguen mayúsculas; la vía sí ("N" y
 * "n" son pines distintos en un Amphenol).
 */
export function parseEnd(project: ProjectData, library: Library, text: string): WireEnd | null {
  const t = text.trim();
  if (!t) return null;
  const choices = endChoices(project, library);
  const exact = choices.find((c) => c.label === t);
  if (exact) return exact.end;
  const [head, ...rest] = t.split(":");
  const tail = rest.join(":");
  const loose = choices.find((c) => {
    if (!c.label.includes(":") || rest.length === 0) return c.label.toLowerCase() === t.toLowerCase();
    const [ch, ...cr] = c.label.split(":");
    return ch.toLowerCase() === head.toLowerCase() && cr.join(":") === tail;
  });
  return loose?.end ?? null;
}

const isCavityEnd = (end: WireEnd, cavityId: number) => end.kind === "cavity" && end.cavity_assignment_id === cavityId;

/** Cables que salen de una vía, en el orden del proyecto. */
export function wiresAtCavity(project: ProjectData, cavityId: number): WireInstance[] {
  return project.wire_instances.filter((w) => isCavityEnd(w.end_a, cavityId) || isCavityEnd(w.end_b, cavityId));
}

/** El otro extremo de un cable, visto desde la vía `cavityId`. */
export function otherEnd(wire: WireInstance, cavityId: number): WireEnd {
  return isCavityEnd(wire.end_a, cavityId) ? wire.end_b : wire.end_a;
}

/** Un cable nuevo que sale de la vía, todavía sin destino (se completa en "Goes to"). */
export function addWireAtCavity(project: ProjectData, library: Library, cavityId: number): { project: ProjectData; wireId: number } | string {
  return addWire(project, library, cavityEnd(cavityId), BLANK_END);
}

/** Cambia el destino de un cable visto desde la vía `cavityId` (el extremo que no es esa vía). */
export function setOtherEnd(project: ProjectData, wireId: number, cavityId: number, end: WireEnd): ProjectData | string {
  const wire = project.wire_instances.find((w) => w.id === wireId);
  if (!wire) return "That wire no longer exists.";
  if (isCavityEnd(end, cavityId)) return "A wire can't go back to its own pin.";
  return patchItem(project, "wire_instances", wireId, isCavityEnd(wire.end_a, cavityId) ? { end_b: end } : { end_a: end });
}

/** Borra un cable (y lo saca de su grupo de trenzado). */
/** Splices, masas y componentes: donde terminan o se unen cables fuera de un conector. */
export type JunctionKind = "splice" | "ground" | "component";
const JUNCTION_LIST = { splice: "splice_instances", ground: "ground_points", component: "component_instances" } as const;
const JUNCTION_END = { splice: "splice_id", ground: "ground_point_id", component: "component_instance_id" } as const;

/** Cables que llegan a un splice, masa o componente. */
export function wiresAtJunction(project: ProjectData, kind: JunctionKind, id: number): WireInstance[] {
  const at = (end: WireEnd) => end.kind === kind && end[JUNCTION_END[kind]] === id;
  return project.wire_instances.filter((w) => at(w.end_a) || at(w.end_b));
}

/**
 * Splice, masa o componente nuevo, con el próximo ID (SP3, G2, R1 / D1 según
 * el tipo) y la primera parte de la biblioteca que le corresponde. Se ubica en
 * el primer nodo de su clase (punto de splice / de masa), o en el primero; se
 * corrige después en el Inspector.
 */
export function addJunction(project: ProjectData, library: Library, kind: JunctionKind): { project: ProjectData; id: number } | string {
  const wantedNode = kind === "ground" ? "ground_point" : "splice_point";
  const nodeId = (project.nodes.find((n) => n.kind === wantedNode) ?? project.nodes[0])?.id;
  if (nodeId === undefined) return "Draw the topology first: it needs at least one node.";
  const list = JUNCTION_LIST[kind];
  const id = nextId(project[list].map((x) => x.id));
  if (kind === "ground") {
    const ground = { id, short_id: `G${id}`, name: "", terminal_library_part_id: null, node_id: nodeId };
    return { project: { ...project, ground_points: [...project.ground_points, ground] }, id };
  }
  const place = { node_id: nodeId, segment_id: null, offset_from_end_mm: null, offset_from_node_id: null };
  if (kind === "splice") {
    const part = library.splice_defs[0]?.part_id;
    if (part === undefined) return "Add a splice type in Library → Splices first.";
    const splice = { id, short_id: `SP${id}`, name: "", library_part_id: part, ...place };
    return { project: { ...project, splice_instances: [...project.splice_instances, splice] }, id };
  }
  const def = library.component_defs[0];
  if (!def) return "Add a component type in Library → Components first.";
  const prefix = /diod/i.test(def.component_type) ? "D" : "R";
  const component = { id, short_id: `${prefix}${id}`, name: "", library_part_id: def.part_id, ...place };
  return { project: { ...project, component_instances: [...project.component_instances, component] }, id };
}

/** Borra un splice, masa o componente; los cables que llegaban ahí quedan con ese extremo vacío. */
export function deleteJunction(project: ProjectData, kind: JunctionKind, id: number): ProjectData {
  const loose = (end: WireEnd) => (end.kind === kind && end[JUNCTION_END[kind]] === id ? BLANK_END : end);
  const list = JUNCTION_LIST[kind];
  return {
    ...project,
    [list]: (project[list] as { id: number }[]).filter((x) => x.id !== id),
    wire_instances: project.wire_instances.map((w) => ({ ...w, end_a: loose(w.end_a), end_b: loose(w.end_b) })),
  };
}

export function deleteWire(project: ProjectData, wireId: number): ProjectData {
  return {
    ...project,
    wire_instances: project.wire_instances.filter((w) => w.id !== wireId),
    twist_groups: project.twist_groups.map((g) => ({ ...g, wire_instance_ids: g.wire_instance_ids.filter((id) => id !== wireId) })),
  };
}

