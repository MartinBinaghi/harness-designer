/**
 * Ediciones del proyecto que se pueden disparar desde más de una pantalla
 * (tablas y diagrama). Funciones puras: reciben el proyecto y devuelven uno
 * nuevo, o un mensaje si la operación no es válida. Sin React, para poder
 * chequearlas con tests/projectEdit.test.ts.
 */
import type { CableInstance, CavityAssignment, ConnectorInstance, Node, ProjectData, Segment, WireEnd, WireInstance } from "../model/project";
import { devicePinName, type Library } from "../model/library.ts";
import type { GaugeFacts } from "../model/calc";
import { nodeLabel } from "./nodeLabels.ts";
import { BLOCK_SIZE, POINT_SIZE, ROW_HEIGHT, isBlock, rootNodeId } from "./diagramLayout.ts";

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

/** Nodo nuevo, sin terminación. Todo nodo nuevo sale de acá (diagrama, Topology, conectores). */
export function newNode(id: number, kind: Node["kind"], x: number | null, y: number | null): Node {
  return { id, kind, termination: null, termination_library_part_id: null, termination_segment_ids: [], diagram_x: x, diagram_y: y, adhesive_heatshrink_length_mm: null };
}

/** Segmento nuevo entre dos nodos, sin paso ni cobertura propios, hacia adelante. */
export function newSegment(id: number, a: number, b: number, lengthMm = DEFAULT_SEGMENT_MM): Segment {
  return { id, node_a_id: a, node_b_id: b, length_mm: lengthMm, twist_pitch_mm: null, covering_library_part_id: null, leaves_backward: false };
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
  const segment = newSegment(nextId(project.segments.map((s) => s.id)), fromNodeId, nodeId);
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
  return { ...project, segments: [...project.segments, newSegment(nextId(project.segments.map((s) => s.id)), a, b)] };
}

export function setSegmentLength(project: ProjectData, segmentId: number, lengthMm: number): ProjectData {
  return { ...project, segments: project.segments.map((s) => (s.id === segmentId ? { ...s, length_mm: lengthMm } : s)) };
}

/**
 * Parte un segmento en dos con un breakout en el medio (largos redondeados a
 * mm, la suma no cambia). Los splices/componentes que estaban sobre el
 * segmento quedan en el tramo que les toca, a la misma distancia real del
 * nodo A. El tramo nuevo copia paso de trenzado y cobertura, y sale del
 * breakout nuevo hacia adelante. Un boot de breakout que iba sobre la mitad B
 * pasa a ir sobre el tramo nuevo.
 */
export function splitSegment(project: ProjectData, segmentId: number, position: { x: number; y: number } | null): { project: ProjectData; nodeId: number } | string {
  const seg = project.segments.find((s) => s.id === segmentId);
  if (!seg) return "Segment not found.";
  const half = Math.round(seg.length_mm / 2);
  const mid = nextId(project.nodes.map((n) => n.id));
  const second: Segment = { ...seg, id: nextId(project.segments.map((s) => s.id)), node_a_id: mid, length_mm: seg.length_mm - half, leaves_backward: false };
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
      // Del lado de node_b el tramo pasa a ser `second`: un boot de ese nodo que lo apretaba lo sigue apretando.
      nodes: [...project.nodes.map((n) => (n.id === seg.node_b_id ? { ...n, termination_segment_ids: n.termination_segment_ids.map((id) => (id === seg.id ? second.id : id)) } : n)), breakout],
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
  return {
    ...project,
    nodes: project.nodes.map((n) => ({ ...n, termination_segment_ids: n.termination_segment_ids.filter((id) => id !== segmentId) })),
    segments: project.segments.filter((s) => s.id !== segmentId),
  };
}

/**
 * Un tramo sale de su breakout hacia atrás (hacia el conector principal, al
 * lado del tramo que llega) o hacia adelante. Si el diagrama ya está acomodado
 * a mano, la rama que cuelga del tramo se refleja respecto del tramo que llega
 * al breakout (lo que iba hacia adelante va hacia atrás, y al revés), sin
 * cambiar sus largos. Si así quedaría encima del tramo que llega, se corre una
 * fila hacia su lado (abajo si estaba alineada): las salidas hacia atrás van
 * arriba y abajo de ese tramo, como en la hoja de armado.
 */
export function setLeavesBackward(project: ProjectData, segmentId: number, backward: boolean): ProjectData {
  const seg = project.segments.find((s) => s.id === segmentId);
  if (!seg || seg.leaves_backward === backward) return project;
  const segments = project.segments.map((s) => (s.id === segmentId ? { ...s, leaves_backward: backward } : s));
  const { parent, child } = segmentEnds(project, seg);
  const placed = (id: number | undefined) => {
    const n = project.nodes.find((x) => x.id === id);
    return n && n.diagram_x !== null && n.diagram_y !== null ? n : undefined;
  };
  const pivot = placed(parent);
  if (!pivot) return { ...project, segments };
  const size = (id: number) => (isBlock(project, id) ? BLOCK_SIZE : POINT_SIZE);
  const center = (n: Node) => ({ x: n.diagram_x! + size(n.id).width / 2, y: n.diagram_y! + size(n.id).height / 2 });
  const p = center(pivot);
  // Eje del tramo que llega al breakout (u, en el sentido de avance) y su perpendicular (v, "abajo" si u va a la derecha).
  const incoming = project.segments.find((s) => s.id !== segmentId && (s.node_a_id === parent || s.node_b_id === parent) && segmentEnds(project, s).child === parent);
  const from = incoming && placed(segmentEnds(project, incoming).parent);
  const g = from ? center(from) : { x: p.x - 1, y: p.y };
  const len = Math.hypot(p.x - g.x, p.y - g.y) || 1;
  const u = { x: (p.x - g.x) / len, y: (p.y - g.y) / len };
  const v = { x: -u.y, y: u.x };
  const local = (n: Node) => {
    const c = center(n);
    return { a: (c.x - p.x) * u.x + (c.y - p.y) * u.y, b: (c.x - p.x) * v.x + (c.y - p.y) * v.y };
  };
  const first = placed(child);
  const side = first ? local(first).b : 0;
  const shift = Math.abs(side) < ROW_HEIGHT ? (side < 0 ? -ROW_HEIGHT : ROW_HEIGHT) - side : 0;
  const branch = subtree(project, child, parent);
  const nodes = project.nodes.map((n) => {
    if (!branch.has(n.id) || n.diagram_x === null || n.diagram_y === null) return n;
    const { a, b } = local(n);
    const s = size(n.id);
    return {
      ...n,
      diagram_x: Math.round(p.x - a * u.x + (b + shift) * v.x - s.width / 2),
      diagram_y: Math.round(p.y - a * u.y + (b + shift) * v.y - s.height / 2),
    };
  });
  return { ...project, segments, nodes };
}

/** Las puntas de un tramo vistas desde el conector principal: de cuál cuelga (`parent`) y cuál sigue (`child`). */
export function segmentEnds(project: ProjectData, seg: Segment): { parent: number; child: number } {
  const root = rootNodeId(project);
  if (root === undefined) return { parent: seg.node_a_id, child: seg.node_b_id };
  // Si el subárbol de B (sin pasar por el tramo) tiene a la raíz, B es el de arriba.
  return subtree(project, seg.node_b_id, seg.node_a_id).has(root)
    ? { parent: seg.node_b_id, child: seg.node_a_id }
    : { parent: seg.node_a_id, child: seg.node_b_id };
}

/** Nodos a los que se llega desde `start` sin pasar por `blocked`. */
function subtree(project: ProjectData, start: number, blocked: number): Set<number> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const s of project.segments) {
      const other = s.node_a_id === id ? s.node_b_id : s.node_b_id === id ? s.node_a_id : null;
      if (other !== null && other !== blocked && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen;
}

/** Borra un nodo vacío (y sus segmentos). Si tiene algo ubicado, no lo borra: se pierde información. */
export function deleteNode(project: ProjectData, nodeId: number): ProjectData | string {
  const there = [
    ...project.connector_instances.filter((c) => c.node_id === nodeId).map((c) => c.short_id),
    ...project.ground_points.filter((g) => g.node_id === nodeId).map((g) => g.short_id),
    ...project.splice_instances.filter((s) => s.node_id === nodeId).map((s) => s.short_id),
    ...project.component_instances.filter((c) => c.node_id === nodeId).map((c) => c.short_id),
    ...project.wire_instances.filter((w) => [w.end_a, w.end_b].some((e) => e.kind === "loose" && e.node_id === nodeId)).map((w) => `${w.short_id} (loose end)`),
  ];
  if (there.length > 0) return `Node has ${there.join(", ")} — delete or move ${there.length === 1 ? "it" : "them"} first (Connectors / Splices).`;
  const segIds = new Set(project.segments.filter((s) => s.node_a_id === nodeId || s.node_b_id === nodeId).map((s) => s.id));
  const blocked = [...project.splice_instances, ...project.component_instances].filter((x) => x.segment_id !== null && segIds.has(x.segment_id));
  if (blocked.length > 0) return `A segment of this node has ${blocked.map((x) => x.short_id).join(", ")} on it — move ${blocked.length === 1 ? "it" : "them"} first.`;
  return {
    ...project,
    nodes: project.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => ({ ...n, termination_segment_ids: n.termination_segment_ids.filter((id) => !segIds.has(id)) })),
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
export function addWire(project: ProjectData, library: Library, gauges: GaugeFacts | null, endA: WireEnd, endB: WireEnd): { project: ProjectData; wireId: number } | string {
  const same = endA.kind === endB.kind && JSON.stringify(endA) === JSON.stringify(endB);
  if (same) return "A wire needs two different ends.";
  const counts = new Map<number, number>();
  for (const w of project.wire_instances) counts.set(w.library_part_id, (counts.get(w.library_part_id) ?? 0) + 1);
  const mostUsed = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  // Que entre en algún contacto que pueda llevar el pin (mismo criterio que el
  // núcleo: `usable_contacts` y `takes` en contacts.rs): el más usado si sirve;
  // si no, el más fino de la biblioteca que sirva. Sin los datos del núcleo
  // todavía (`gauges`), no se descarta ninguno.
  const ranges = contactRanges(project, library, gauges, endA) ?? contactRanges(project, library, gauges, endB);
  const mm2 = (partId: number) => gauges?.wire_mm2[String(partId)] ?? null;
  const fits = (partId: number) => {
    const m = mm2(partId);
    return !ranges || ranges.length === 0 || m === null || ranges.some((r) => r === null || (m >= r[0] && m <= r[1]));
  };
  const byGauge = [...library.wire_defs].sort((a, b) => (mm2(a.part_id) ?? 0) - (mm2(b.part_id) ?? 0)).map((d) => d.part_id);
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
    cable_instance_id: null,
    end_a: endA,
    end_b: endB,
  };
  return { project: { ...project, wire_instances: [...project.wire_instances, wire] }, wireId: id };
}

/** Rangos (mm²) de los contactos que puede llevar la vía de un extremo, según el núcleo; null si no aplica. */
function contactRanges(project: ProjectData, library: Library, gauges: GaugeFacts | null, end: WireEnd): ([number, number] | null)[] | null {
  if (!gauges || end.kind !== "cavity" || end.cavity_assignment_id == null) return null;
  const connector = project.connector_instances.find((c) => c.cavities.some((cav) => cav.id === end.cavity_assignment_id));
  const cavity = connector?.cavities.find((cav) => cav.id === end.cavity_assignment_id);
  const def = library.connector_defs?.find((d) => d.part_id === connector?.library_part_id);
  const size = def?.cavities.find((c) => c.cavity_id === cavity?.cavity_id)?.contact_size;
  if (!def || size === undefined) return null;
  return gauges.contact_ranges[String(def.part_id)]?.[size] ?? null;
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
    case "loose": {
      const node = project.nodes.find((n) => n.id === end.node_id);
      return node ? looseLabel(project, node) : "—";
    }
    default:
      return "—";
  }
}

/** "loose · node 7 · Connector end · X3 PEDAL 2": un cable que queda suelto en ese nodo. */
function looseLabel(project: ProjectData, node: Node): string {
  return `loose · ${nodeLabel(project, node)}`;
}

// --- Pinout por conector (pantalla Conectores) ---------------------------------

/** Extremo sin destino todavía: el cable queda incompleto hasta que se completa (plan 7.1). */
export const BLANK_END: WireEnd = { kind: "cavity", cavity_assignment_id: null, splice_id: null, ground_point_id: null, component_instance_id: null, node_id: null };

const cavityEnd = (id: number): WireEnd => ({ ...BLANK_END, cavity_assignment_id: id });

/**
 * Destinos que se pueden escribir en "Goes to", con su extremo: "X4:2" por cada
 * vía, el nombre del pin en conectores de dispositivo ("PDM30 OUT11"), splices,
 * masas y componentes. Sirve para el autocompletado y para interpretar el texto.
 */
export type EndChoice = { label: string; end: WireEnd; hidden?: boolean };

/**
 * Lo que se puede escribir en "Goes to". Con nombre, la lista ofrece "X1 · ECU:7"
 * y "G1 · GND" (se busca por el nombre); "X1:7", "ECU:7" y "G1" se aceptan igual
 * pero no se repiten en la lista (`hidden`).
 */
export function endChoices(project: ProjectData, library: Library): EndChoice[] {
  const out: EndChoice[] = [];
  for (const c of project.connector_instances) {
    const pins = c.cavities.map((cav) => devicePinName(library, c.device_connector_id, cav.cavity_id));
    c.cavities.forEach((cav, i) => {
      out.push({ label: `${c.short_id}:${cav.cavity_id}`, end: cavityEnd(cav.id), hidden: !!c.name });
      if (c.name) out.push({ label: `${c.short_id} · ${c.name}:${cav.cavity_id}`, end: cavityEnd(cav.id) }, { label: `${c.name}:${cav.cavity_id}`, end: cavityEnd(cav.id), hidden: true });
      const pin = pins[i];
      // Un nombre en dos vías (pines en paralelo) lleva la vía: "PDM30 OUT1 (A10)".
      const repeated = pins.filter((p) => p === pin).length > 1;
      if (pin) out.push({ label: `${c.name || c.short_id} ${pin}${repeated ? ` (${cav.cavity_id})` : ""}`, end: cavityEnd(cav.id) });
    });
  }
  // Splices y masas también con su nombre: con muchos, nadie se acuerda cuál es SP7.
  for (const s of project.splice_instances) {
    const end: WireEnd = { ...BLANK_END, kind: "splice", cavity_assignment_id: null, splice_id: s.id };
    out.push({ label: s.short_id, end, hidden: !!s.name });
    if (s.name) out.push({ label: `${s.short_id} · ${s.name}`, end });
  }
  for (const g of project.ground_points) {
    const end: WireEnd = { ...BLANK_END, kind: "ground", cavity_assignment_id: null, ground_point_id: g.id };
    out.push({ label: g.short_id, end, hidden: !!g.name });
    if (g.name) out.push({ label: `${g.short_id} · ${g.name}`, end });
  }
  for (const k of project.component_instances) out.push({ label: k.short_id, end: { ...BLANK_END, kind: "component", cavity_assignment_id: null, component_instance_id: k.id } });
  // Suelto en un nodo (el cable llega hasta ahí y no se conecta): se busca escribiendo "loose".
  for (const n of project.nodes) out.push({ label: looseLabel(project, n), end: { ...BLANK_END, kind: "loose", cavity_assignment_id: null, node_id: n.id } });
  return out;
}

/**
 * La lista de "Goes to" para un texto: las opciones que lo contienen en
 * cualquier parte, sin importar mayúsculas, en su texto o en otra forma de
 * escribir el mismo destino ("X3:r" o "motor:r" encuentran "X3 · MOTOR:r").
 * Primero las que coinciden también en mayúsculas (la vía "r" no es la "R").
 * La de WebView2 (`<datalist>`) filtraba con reglas propias y no las encontraba.
 */
export function searchEnds(choices: EndChoice[], text: string, limit = 50): string[] {
  const q = text.trim();
  if (!q) return [];
  const key = (e: WireEnd) => `${e.kind}:${e.cavity_assignment_id ?? e.splice_id ?? e.ground_point_id ?? e.component_instance_id ?? e.node_id}`;
  const hidden = new Map<string, string[]>();
  for (const c of choices) if (c.hidden) hidden.set(key(c.end), [...(hidden.get(key(c.end)) ?? []), c.label]);
  const found = choices
    .filter((c) => !c.hidden)
    .flatMap((c) => {
      const texts = [c.label, ...(hidden.get(key(c.end)) ?? [])];
      return texts.some((t) => t.toLowerCase().includes(q.toLowerCase())) ? [{ label: c.label, sameCase: texts.some((t) => t.includes(q)) }] : [];
    });
  return [...found.filter((f) => f.sameCase), ...found.filter((f) => !f.sameCase)].slice(0, limit).map((f) => f.label);
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
export function addWireAtCavity(project: ProjectData, library: Library, gauges: GaugeFacts | null, cavityId: number): { project: ProjectData; wireId: number } | string {
  return addWire(project, library, gauges, cavityEnd(cavityId), BLANK_END);
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
  const wires = project.wire_instances.filter((w) => w.id !== wireId);
  return {
    ...project,
    wire_instances: wires,
    cable_instances: withoutEmptyCables(project.cable_instances, wires),
    twist_groups: project.twist_groups.map((g) => ({ ...g, wire_instance_ids: g.wire_instance_ids.filter((id) => id !== wireId) })),
  };
}

/** Un cable comprado sin conductores no existe: se va con el último. */
function withoutEmptyCables(cables: CableInstance[], wires: WireInstance[]): CableInstance[] {
  return cables.filter((c) => wires.some((w) => w.cable_instance_id === c.id));
}

/** WC1, WC2…: el próximo número libre. */
export function nextCableShortId(cables: CableInstance[]): string {
  const numbers = cables.map((c) => Number(/^WC(\d+)$/.exec(c.short_id)?.[1] ?? 0)).filter((n) => n > 0);
  return `WC${nextId(numbers)}`;
}

/**
 * Tipo de cable de un cable del arnés. Si es conductor de un cable comprado,
 * cambia el del cable y el de todos sus conductores, que llevan el mismo.
 */
export function setWireType(project: ProjectData, wireId: number, partId: number): ProjectData {
  const cableId = project.wire_instances.find((w) => w.id === wireId)?.cable_instance_id ?? null;
  const touched = (w: WireInstance) => (cableId === null ? w.id === wireId : w.cable_instance_id === cableId);
  return {
    ...project,
    cable_instances: project.cable_instances.map((c) => (c.id === cableId ? { ...c, library_part_id: partId } : c)),
    wire_instances: project.wire_instances.map((w) => (touched(w) ? { ...w, library_part_id: partId } : w)),
  };
}

/**
 * Hace a un cable conductor de un cable comprado: uno existente (toma su tipo
 * de cable) o uno nuevo ("new", WCn, del tipo que ya tiene el cable); null lo
 * saca. Un cable comprado que se queda sin conductores se borra.
 */
export function setWireCable(project: ProjectData, wireId: number, cable: number | "new" | null): ProjectData {
  const wire = project.wire_instances.find((w) => w.id === wireId);
  if (!wire) return project;
  let cables = project.cable_instances;
  let patch: Partial<WireInstance> = { cable_instance_id: null };
  if (cable === "new") {
    const id = nextId(cables.map((c) => c.id));
    cables = [...cables, { id, short_id: nextCableShortId(cables), library_part_id: wire.library_part_id }];
    patch = { cable_instance_id: id };
  } else if (cable !== null) {
    const target = cables.find((c) => c.id === cable);
    if (!target) return project;
    patch = { cable_instance_id: target.id, library_part_id: target.library_part_id };
  }
  const wires = project.wire_instances.map((w) => (w.id === wireId ? { ...w, ...patch } : w));
  return { ...project, wire_instances: wires, cable_instances: withoutEmptyCables(cables, wires) };
}

/**
 * Un extremo de conector libre de la topología o, si no hay, uno nuevo suelto
 * (se conecta después en Topology o en el diagrama).
 */
export function freeConnectorNode(project: ProjectData): { nodes: Node[]; nodeId: number } {
  const free = project.nodes.find((n) => n.kind === "connector_end" && !project.connector_instances.some((c) => c.node_id === n.id));
  if (free) return { nodes: project.nodes, nodeId: free.id };
  const nodeId = nextId(project.nodes.map((n) => n.id));
  return { nodes: [...project.nodes, newNode(nodeId, "connector_end", null, null)], nodeId };
}

/**
 * Copia de un conector con su pinout (Martin: 5 bobinas o 5 inyectores iguales
 * se cargan una vez). Cada cable del original se copia con su función, tipo y
 * color; los que van a un splice, masa o componente siguen yendo ahí (son los
 * compartidos: alimentación, masa), y los que van a un pin de otro conector
 * quedan sin destino, porque ese pin es de cada uno (la señal de cada bobina
 * va a otro pin del motor). Va en un extremo de conector libre, como uno nuevo.
 */
export function duplicateConnector(project: ProjectData, connectorId: number): { project: ProjectData; id: number } | null {
  const source = project.connector_instances.find((c) => c.id === connectorId);
  if (!source) return null;
  const id = nextId(project.connector_instances.map((c) => c.id));
  let nextCavity = nextId(project.connector_instances.flatMap((c) => c.cavities.map((cav) => cav.id)));
  const cavities = source.cavities.map((cav) => ({ ...cav, id: nextCavity++ }));
  const newCavity = new Map(source.cavities.map((cav, i) => [cav.id, cavities[i].id]));
  const { nodes, nodeId } = freeConnectorNode(project);
  const copy: ConnectorInstance = { ...source, id, short_id: `X${id}`, name: source.name ? `${source.name} (copy)` : "", node_id: nodeId, cavities };

  const remap = (end: WireEnd): WireEnd => {
    if (end.kind !== "cavity" || end.cavity_assignment_id == null) return end;
    const mine = newCavity.get(end.cavity_assignment_id);
    return mine !== undefined ? { ...end, cavity_assignment_id: mine } : BLANK_END;
  };
  // Un cable comprado del original se copia como otro cable comprado (el
  // termopar de la copia es otro par, no el mismo).
  const cables = [...project.cable_instances];
  const cableCopy = new Map<number, number>();
  const copiedCable = (sourceId: number | null): number | null => {
    if (sourceId === null) return null;
    const known = cableCopy.get(sourceId);
    if (known !== undefined) return known;
    const source = cables.find((c) => c.id === sourceId);
    if (!source) return null;
    const cable = { id: nextId(cables.map((c) => c.id)), short_id: nextCableShortId(cables), library_part_id: source.library_part_id };
    cables.push(cable);
    cableCopy.set(sourceId, cable.id);
    return cable.id;
  };
  let wireId = nextId(project.wire_instances.map((w) => w.id));
  const wires = project.wire_instances
    .filter((w) => [w.end_a, w.end_b].some((e) => e.kind === "cavity" && e.cavity_assignment_id != null && newCavity.has(e.cavity_assignment_id)))
    .map((w): WireInstance => {
      const wid = wireId++;
      return {
        ...w,
        id: wid,
        short_id: `W${String(wid).padStart(3, "0")}`,
        end_a: remap(w.end_a),
        end_b: remap(w.end_b),
        manual_length_mm: null,
        label: null,
        cable_instance_id: copiedCable(w.cable_instance_id),
      };
    });
  return {
    project: {
      ...project,
      nodes,
      connector_instances: [...project.connector_instances, copy],
      wire_instances: [...project.wire_instances, ...wires],
      cable_instances: cables,
    },
    id,
  };
}

/**
 * Copia un cable a la próxima vía libre del mismo conector (Martin: INY Cil 1…4,
 * todos iguales salvo un detalle de la función). La fila va tal cual (función,
 * categoría, tipo, color, margen) y se corrige a mano: subir el número de la
 * función adivinaba mal ("12V+" → "13V+"). El destino también, salvo que sea
 * una vía: dos cables a la misma vía casi nunca es lo buscado.
 */
export function duplicateWireToNextPin(project: ProjectData, wireId: number, cavityId: number): { project: ProjectData; wireId: number } | string {
  const wire = project.wire_instances.find((w) => w.id === wireId);
  const connector = project.connector_instances.find((c) => c.cavities.some((cav) => cav.id === cavityId));
  if (!wire || !connector) return "That wire no longer exists.";
  const from = connector.cavities.findIndex((cav) => cav.id === cavityId);
  const used = new Set(project.wire_instances.flatMap((w) => [w.end_a, w.end_b]).filter((e) => e.kind === "cavity").map((e) => e.cavity_assignment_id));
  const next = connector.cavities.slice(from + 1).find((cav) => !used.has(cav.id));
  if (!next) return `No free pin after ${connector.cavities[from].cavity_id} in ${connector.short_id}.`;
  const id = nextId(project.wire_instances.map((w) => w.id));
  const copy: WireInstance = {
    ...wire,
    id,
    short_id: `W${String(id).padStart(3, "0")}`,
    manual_length_mm: null,
    label: null,
    cable_instance_id: null,
    end_a: cavityEnd(next.id),
    end_b: (() => {
      const dest = otherEnd(wire, cavityId);
      return dest.kind === "cavity" ? BLANK_END : dest;
    })(),
  };
  return { project: { ...project, wire_instances: [...project.wire_instances, copy] }, wireId: id };
}

/** Vías del conector que tienen al menos un cable. */
export function usedCavities(project: ProjectData, connector: ConnectorInstance): Set<string> {
  const ends = new Set(project.wire_instances.flatMap((w) => [w.end_a.cavity_assignment_id, w.end_b.cavity_assignment_id]));
  return new Set(connector.cavities.filter((cav) => ends.has(cav.id)).map((cav) => cav.cavity_id));
}
