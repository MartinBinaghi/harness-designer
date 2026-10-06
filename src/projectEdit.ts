/**
 * Ediciones del proyecto que se pueden disparar desde más de una pantalla
 * (tablas y diagrama). Funciones puras: reciben el proyecto y devuelven uno
 * nuevo, o un mensaje si la operación no es válida. Sin React, para poder
 * chequearlas con `node tools/check_project_edit.ts`.
 */
import type { CavityAssignment, ConnectorInstance, Node, ProjectData, Segment, WireEnd, WireInstance } from "./types";
import type { Library } from "./libraryTypes";

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
    contact_library_part_id: null,
    seal_plug_library_part_id: null,
    external_reference: null,
  }));
}

const DEFAULT_SEGMENT_MM = 100;

function newNode(id: number, kind: Node["kind"], x: number | null, y: number | null): Node {
  return { id, kind, termination: null, termination_library_part_id: null, diagram_x: x, diagram_y: y };
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
export function assignConnector(project: ProjectData, library: Library, nodeId: number, connectorDefId: number, name: string): { project: ProjectData; connectorId: number } {
  const id = nextId(project.connector_instances.map((c) => c.id));
  const def = library.connector_defs.find((cd) => cd.part_id === connectorDefId);
  const connector: ConnectorInstance = {
    id,
    short_id: `X${id}`,
    name,
    library_part_id: connectorDefId,
    device_instance_id: null,
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
  const partId = mostUsed ?? library.wire_defs[0]?.part_id;
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
    label: null,
    end_a: endA,
    end_b: endB,
  };
  return { project: { ...project, wire_instances: [...project.wire_instances, wire] }, wireId: id };
}
