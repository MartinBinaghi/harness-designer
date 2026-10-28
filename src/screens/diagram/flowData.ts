import type { ConnectorInstance, Finding, Node, ProjectData, Segment, Selection } from "../../model/project";
import type { Library } from "../../model/library";
import type { CostReport } from "../../model/calc";
import { infoFor } from "../../logic/nodeLabels";

/** Qué muestra cada nodo y cada segmento del diagrama, armado desde el proyecto (sin React). */

export type Issue = "error" | "warning";

const TERMINATION_SHORT: Record<string, string> = {
  t_mold: "T-mold",
  adhesive_heatshrink: "Adhesive HS",
};

/** El peor hallazgo de cada elemento del diagrama (un error gana sobre un warning). */
export function issuesByElement(project: ProjectData, findings: Finding[]) {
  const nodes = new Map<number, Issue>();
  const segments = new Map<number, Issue>();
  const mark = (map: Map<number, Issue>, id: number | null | undefined, severity: Issue) => {
    if (id == null || map.get(id) === "error") return;
    map.set(id, severity);
  };
  for (const f of findings) {
    const t = f.target;
    if (!t) continue;
    if (t.kind === "node") mark(nodes, t.id, f.severity);
    else if (t.kind === "segment") mark(segments, t.id, f.severity);
    else if (t.kind === "connector") mark(nodes, project.connector_instances.find((c) => c.id === t.id)?.node_id, f.severity);
    else if (t.kind === "ground") mark(nodes, project.ground_points.find((g) => g.id === t.id)?.node_id, f.severity);
    else if (t.kind === "splice") {
      const s = project.splice_instances.find((x) => x.id === t.id);
      if (s?.node_id != null) mark(nodes, s.node_id, f.severity);
      else mark(segments, s?.segment_id, f.severity);
    }
  }
  return { nodes, segments };
}

export type Issues = ReturnType<typeof issuesByElement>;

export function sameSelection(a: Selection, b: Selection): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

export interface HarnessNodeData extends Record<string, unknown> {
  variant: "connector" | "ground" | "point";
  title: string;
  subtitle: string;
  /** "M"/"F" según el ConnectorDef; "?" si la biblioteca no tiene la ficha. */
  gender: string | null;
  pending: boolean;
  /** Nodo de conector/masa sin el conector o la masa asignados todavía. */
  missing: string | null;
  isMain: boolean;
  /** Terminación del breakout y splices/componentes ubicados en el nodo. */
  notes: string[];
  distanceLabel: string | null;
  selected: boolean;
  issue: Issue | null;
}

/** Lo que se muestra de un segmento; las acciones las agrega la pantalla (`SegmentEdgeData`). */
export interface SegmentInfo {
  label: string;
  diameter: string | null;
  /** Splices/componentes sobre el segmento: posición 0..1 desde el nodo A. */
  markers: { label: string; t: number }[];
  lengthMm: number;
  highlight: "none" | "net" | "wire";
  selected: boolean;
  issue: Issue | null;
}

export interface SegmentEdgeData extends SegmentInfo, Record<string, unknown> {
  onSelect: () => void;
  onLengthChange: (mm: number) => void;
  onSplit: () => void;
}

/** Lo que depende de la vista y no del proyecto: selección, hallazgos, distancias. */
export interface DiagramView {
  selection: Selection;
  issues: Issues;
  distances: Record<string, number> | null;
  mainConnector: ConnectorInstance | undefined;
}

/** Datos de un nodo: bloque de conector o masa (aunque no tenga nada asignado), o punto. */
export function nodeData(project: ProjectData, library: Library, n: Node, view: DiagramView): HarnessNodeData {
  const { selection, issues, distances, mainConnector } = view;
  const genderOf = (partId: number) => {
    const def = library.connector_defs.find((cd) => cd.part_id === partId);
    return def ? (def.gender === "male" ? "M" : "F") : "?";
  };
  const connectors = project.connector_instances.filter((c) => c.node_id === n.id);
  const ground = project.ground_points.find((g) => g.node_id === n.id);
  const info = infoFor(project, n.id);
  const atNode = [
    ...project.splice_instances.filter((s) => s.node_id === n.id).map((s) => s.short_id),
    ...project.component_instances.filter((c) => c.node_id === n.id).map((c) => c.short_id),
  ];
  const termination = n.termination ? TERMINATION_SHORT[n.termination] : undefined;
  const distance = distances?.[String(n.id)];
  const base = {
    notes: termination ? [termination, ...atNode] : atNode,
    selected: sameSelection(selection, info.select) || sameSelection(selection, { kind: "node", id: n.id }),
    issue: issues.nodes.get(n.id) ?? null,
    // Distancia desde el conector principal a cualquier nodo (breakout, conector, masa), salvo el propio.
    distanceLabel:
      distance !== undefined && mainConnector && n.id !== mainConnector.node_id
        ? `${Math.round(distance)} mm from ${mainConnector.short_id}`
        : null,
    pending: false,
    missing: null as string | null,
    isMain: false,
    gender: null as string | null,
  };
  if (connectors.length > 0) {
    return {
      ...base,
      variant: "connector",
      title: connectors.map((x) => x.short_id).join(" / "),
      subtitle: connectors.map((x) => x.name).filter(Boolean).join(" / "),
      gender: connectors.map((x) => genderOf(x.library_part_id)).join("/"),
      pending: connectors.some((x) => x.status === "pending"),
      isMain: connectors.some((x) => x.id === mainConnector?.id),
      selected: base.selected || connectors.some((x) => sameSelection(selection, { kind: "connector", id: x.id })),
    };
  }
  if (ground) return { ...base, variant: "ground", title: ground.short_id, subtitle: ground.name };
  if (n.kind === "connector_end" || n.kind === "ground_point") {
    const isGround = n.kind === "ground_point";
    return {
      ...base,
      variant: isGround ? "ground" : "connector",
      title: `Node ${n.id}`,
      subtitle: "",
      missing: isGround ? "no ground point assigned" : "no connector assigned",
    };
  }
  return { ...base, variant: "point", title: "", subtitle: "" };
}

/** Datos de un segmento: largo, diámetro, splices encima, resaltado. */
export function segmentData(
  project: ProjectData,
  s: Segment,
  report: CostReport | null,
  highlight: { wire: Set<number>; net: Set<number> },
  view: Pick<DiagramView, "selection" | "issues">,
): SegmentInfo {
  const diameter = report?.segment_diameters.find((x) => x.segment_id === s.id)?.final_diameter_mm;
  const onSegment = [
    ...project.splice_instances.filter((x) => x.segment_id === s.id),
    ...project.component_instances.filter((x) => x.segment_id === s.id),
  ];
  const markers = onSegment.map((x) => {
    const fromA = s.length_mm > 0 ? (x.offset_from_end_mm ?? 0) / s.length_mm : 0;
    const t = x.offset_from_node_id === s.node_b_id ? 1 - fromA : fromA;
    return { label: `${x.short_id} · ${x.offset_from_end_mm ?? 0}mm`, t: Math.min(1, Math.max(0, t)) };
  });
  return {
    label: `${s.length_mm} mm`,
    lengthMm: s.length_mm,
    diameter: diameter && diameter > 0 ? diameter.toFixed(1) : null,
    markers,
    highlight: highlight.wire.has(s.id) ? "wire" : highlight.net.has(s.id) ? "net" : "none",
    selected: sameSelection(view.selection, { kind: "segment", id: s.id }),
    issue: view.issues.segments.get(s.id) ?? null,
  };
}
