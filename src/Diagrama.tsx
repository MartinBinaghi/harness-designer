import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  applyNodeChanges,
  type Node as FlowNode,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type NodeChange,
  type ReactFlowInstance,
  type FinalConnectionState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { infoFor } from "./TreePanel";
import { constrainDrag, pxPerMm, rootedTree, scaledCenters } from "./diagramScale";
import { addBranch, assignConnector, connectNodes, deleteNode, deleteSegment, setSegmentLength, splitSegment } from "./projectEdit";
import { endLabel } from "./Cables";
import { ConnectorViews, usedCavities } from "./Inspector";
import type { Finding, ProjectData, Selection } from "./types";
import type { Library } from "./libraryTypes";
import type { CostReport } from "./costTypes";

/**
 * Diagrama de armado (plan 10.2): no escalado, con medidas. Es otra vista de
 * los mismos datos — mover un nodo guarda su posición en el proyecto (un paso
 * de undo), y la selección es la misma que usan el árbol, las tablas y el
 * inspector. También edita (plan 10.4): ramas nuevas arrastrando desde el "+"
 * de un nodo, largo con doble click en la etiqueta, breakout en un segmento,
 * Supr para borrar, doble click en un conector para asignarlo o ver su pinout.
 */

type XY = { x: number; y: number };
type Issue = "error" | "warning";

/** Tamaño aproximado de cada tipo de nodo, para centrar puntos y bloques en el layout automático. */
const BLOCK_SIZE = { width: 170, height: 48 };
const POINT_SIZE = { width: 14, height: 14 };
/** Grilla del layout automático: una columna por nivel del árbol, una fila por rama final. */
const COLUMN_WIDTH = 300;
const ROW_HEIGHT = 80;

const TERMINATION_SHORT: Record<string, string> = {
  t_mold: "T-mold",
  adhesive_heatshrink: "Adhesive HS",
};

function rootNodeId(project: ProjectData): number | undefined {
  const main = project.connector_instances.find((c) => c.id === project.project.main_connector_instance_id);
  return main?.node_id ?? project.nodes[0]?.id;
}

/** Extremos de conector y puntos de masa se dibujan como bloque (aunque todavía no tengan nada asignado). */
function isBlock(project: ProjectData, nodeId: number): boolean {
  const kind = project.nodes.find((n) => n.id === nodeId)?.kind;
  return (
    kind === "connector_end" ||
    kind === "ground_point" ||
    project.connector_instances.some((c) => c.node_id === nodeId) ||
    project.ground_points.some((g) => g.node_id === nodeId)
  );
}

/**
 * Layout automático de árbol, de izquierda a derecha: el conector principal en
 * la primera columna, cada nivel en la columna siguiente; cada rama final ocupa
 * una fila y cada nodo queda centrado entre sus ramas. Así las ramas de un
 * breakout quedan juntas y no se cruzan con las de otro.
 */
function autoLayout(project: ProjectData): Map<number, XY> {
  const neighbors = new Map<number, number[]>();
  for (const s of project.segments) {
    neighbors.set(s.node_a_id, [...(neighbors.get(s.node_a_id) ?? []), s.node_b_id]);
    neighbors.set(s.node_b_id, [...(neighbors.get(s.node_b_id) ?? []), s.node_a_id]);
  }
  const positions = new Map<number, XY>();
  let nextRow = 0;
  // Devuelve la fila (centro) del nodo; las hojas toman filas consecutivas.
  function place(id: number, depth: number, parent: number | null): number {
    positions.set(id, { x: 0, y: 0 });
    const children = (neighbors.get(id) ?? []).filter((n) => n !== parent && !positions.has(n));
    const rows = children.map((child) => place(child, depth + 1, id));
    const row = rows.length > 0 ? (rows[0] + rows[rows.length - 1]) / 2 : nextRow++;
    const size = isBlock(project, id) ? BLOCK_SIZE : POINT_SIZE;
    positions.set(id, {
      x: depth * COLUMN_WIDTH + (BLOCK_SIZE.width - size.width) / 2,
      y: row * ROW_HEIGHT + (BLOCK_SIZE.height - size.height) / 2,
    });
    return row;
  }
  const root = rootNodeId(project);
  // Ramas desconectadas (mientras se carga el árbol) van debajo, cada una con su raíz.
  for (const id of [root, ...project.nodes.map((n) => n.id)]) {
    if (id !== undefined && !positions.has(id)) {
      place(id, 0, null);
      nextRow++;
    }
  }
  return positions;
}

/** El peor hallazgo de cada elemento del diagrama (un error gana sobre un warning). */
function issuesByElement(project: ProjectData, findings: Finding[]) {
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

function sameSelection(a: Selection, b: Selection): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

// ---------------------------------------------------------------------------
// Nodos y segmentos del dibujo

interface HarnessNodeData extends Record<string, unknown> {
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

/**
 * Handles invisibles en el centro (los segmentos van de centro a centro y el
 * bloque tapa el tramo interior) + un "+" que aparece al pasar el mouse:
 * arrastrarlo crea una rama nueva (ver onConnectEnd).
 */
function CenterHandles() {
  // Tamaño cero: React Flow engancha la línea en el borde superior del handle
  // (Position.Top), así que con el tamaño por defecto (6 px) todas las líneas
  // terminaban 3 px por encima del centro del nodo.
  const style = {
    top: "50%",
    left: "50%",
    width: 0,
    height: 0,
    minWidth: 0,
    minHeight: 0,
    border: 0,
    opacity: 0,
    pointerEvents: "none" as const,
  };
  return (
    <>
      <Handle id="c-t" type="target" position={Position.Top} style={style} isConnectable={false} />
      <Handle id="c-s" type="source" position={Position.Top} style={style} isConnectable={false} />
      <Handle id="branch" type="source" position={Position.Right} className="dg-branch-handle" title="Drag to add a branch" />
    </>
  );
}

function IssueDot({ issue }: { issue: Issue | null }) {
  if (!issue) return null;
  return <span className={`status-dot status-dot-${issue}`} title={issue === "error" ? "Has errors (see Checks)" : "Has warnings (see Checks)"} />;
}

function HarnessNode({ data }: NodeProps<FlowNode<HarnessNodeData>>) {
  const d = data;
  if (d.variant === "point") {
    return (
      <div className={`dg-point${d.selected ? " dg-selected" : ""}`}>
        <CenterHandles />
        <div className="dg-point-labels">
          {d.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
          {d.distanceLabel && <div className="dg-distance">{d.distanceLabel}</div>}
          {d.issue && (
            <div>
              <IssueDot issue={d.issue} />
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`dg-block${d.variant === "ground" ? " dg-ground" : ""}${d.pending ? " dg-pending" : ""}${d.missing ? " dg-missing" : ""}${d.selected ? " dg-selected" : ""}`}
    >
      <CenterHandles />
      <div className="dg-block-head">
        {d.variant === "ground" && <GroundSymbol />}
        <span className="dg-id">{d.title}</span>
        {d.gender && (
          <span className={`dg-gender dg-gender-${d.gender}`} title={d.gender === "M" ? "Male" : d.gender === "F" ? "Female" : "Gender unknown (no ConnectorDef in library)"}>
            {d.gender}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <IssueDot issue={d.issue} />
      </div>
      {d.subtitle && <div className="dg-name">{d.subtitle}</div>}
      {d.distanceLabel && <div className="dg-distance">{d.distanceLabel}</div>}
      {(d.pending || d.missing || d.isMain || d.notes.length > 0) && (
        <div className="dg-tags">
          {d.missing && <span className="dg-tag">{d.missing}</span>}
          {d.isMain && <span className="dg-tag">main</span>}
          {d.pending && <span className="dg-tag dg-tag-warning">pending</span>}
          {d.notes.map((n) => (
            <span key={n} className="dg-tag">{n}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function GroundSymbol() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <line x1="6" y1="0" x2="6" y2="5" />
      <line x1="1" y1="5" x2="11" y2="5" />
      <line x1="3" y1="8" x2="9" y2="8" />
      <line x1="5" y1="11" x2="7" y2="11" />
    </svg>
  );
}

interface SegmentEdgeData extends Record<string, unknown> {
  label: string;
  diameter: string | null;
  /** Splices/componentes sobre el segmento: posición 0..1 desde el nodo A. */
  markers: { label: string; t: number }[];
  lengthMm: number;
  highlight: "none" | "net" | "wire";
  selected: boolean;
  issue: Issue | null;
  onSelect: () => void;
  onLengthChange: (mm: number) => void;
  onSplit: () => void;
}

function SegmentEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<SegmentEdgeData>>) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const d = data!;
  const strong = d.selected || d.highlight !== "none";
  const stroke = strong ? "var(--accent)" : "var(--text-muted)";
  const strokeWidth = d.highlight === "wire" || d.selected ? 4 : d.highlight === "net" ? 3 : 2;
  const [editing, setEditing] = useState(false);
  // Enter o perder el foco confirman; un largo no válido (vacío, 0) se descarta.
  function commitLength(text: string) {
    if (!editing) return;
    const mm = Number(text);
    if (mm > 0 && mm !== d.lengthMm) d.onLengthChange(mm);
    setEditing(false);
  }
  const labelStyle = { transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` };
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke, strokeWidth }} interactionWidth={16} />
      <EdgeLabelRenderer>
        {editing ? (
          <input
            className="dg-edge-input nodrag nopan"
            style={labelStyle}
            type="number"
            min={1}
            defaultValue={d.lengthMm}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commitLength(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLength(e.currentTarget.value);
              if (e.key === "Escape") setEditing(false);
              e.stopPropagation();
            }}
            aria-label="Segment length (mm)"
          />
        ) : (
          <div className="dg-edge-label-group nodrag nopan" style={labelStyle}>
            <button
              className={`dg-edge-label${d.selected ? " dg-edge-label-selected" : ""}`}
              onClick={d.onSelect}
              onDoubleClick={() => setEditing(true)}
              title="Double-click to edit the length"
            >
              <IssueDot issue={d.issue} />
              {d.label}
              {d.diameter && <span className="dg-muted"> · Ø{d.diameter}</span>}
            </button>
            {d.selected && (
              // stopPropagation: el label vive en otra capa (portal), pero el click igual
              // sube por React hasta el segmento, que lo volvería a seleccionar.
              <button
                className="dg-edge-action"
                onClick={(e) => {
                  e.stopPropagation();
                  d.onSplit();
                }}
                title="Split this segment in two with a breakout in the middle"
              >
                + breakout
              </button>
            )}
          </div>
        )}
        {d.markers.map((m) => (
          <div
            key={m.label}
            className="dg-marker"
            style={{
              transform: `translate(-50%, -50%) translate(${sourceX + (targetX - sourceX) * m.t}px, ${sourceY + (targetY - sourceY) * m.t}px)`,
            }}
          >
            <span className="dg-marker-dot" />
            <span className="dg-marker-label">{m.label}</span>
          </div>
        ))}
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { harness: HarnessNode };
const edgeTypes = { segment: SegmentEdge };

// ---------------------------------------------------------------------------

interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData) => void;
  library: Library;
  findings: Finding[];
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export default function Diagrama({ project, setProject, library, findings, selection, onSelect }: Props) {
  const [report, setReport] = useState<CostReport | null>(null);
  const [distances, setDistances] = useState<Record<string, number> | null>(null);
  const [showDistances, setShowDistances] = useState(false);
  const [highlight, setHighlight] = useState<{ wire: Set<number>; net: Set<number> }>({ wire: new Set(), net: new Set() });
  const [flowNodes, setFlowNodes] = useState<FlowNode<HarnessNodeData>[]>([]);
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode<HarnessNodeData>, Edge<SegmentEdgeData>> | null>(null);
  // A escala: cada segmento dibujado proporcional a su largo; al arrastrar, el
  // nodo gira alrededor de su padre sin cambiar la distancia.
  const [toScale, setToScale] = useState(false);
  // Tamaño real de cada nodo (lo mide React Flow), para trabajar sobre su centro.
  const sizes = useRef(new Map<string, { w: number; h: number }>());
  const [sizeTick, setSizeTick] = useState(0);
  const flowNodesRef = useRef(flowNodes);
  flowNodesRef.current = flowNodes;
  // Mensaje corto en la barra (p. ej. por qué no se pudo borrar algo).
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);
  // Nodo abierto con doble click (asignar conector / ver pinout).
  const [openNodeId, setOpenNodeId] = useState<number | null>(null);

  // Layout automático solo para los nodos sin posición guardada; se recalcula
  // cuando cambia la forma del árbol, no en cada edición de un campo.
  const needsLayout = !!project && project.nodes.some((n) => n.diagram_x == null || n.diagram_y == null);
  const shapeKey = project
    ? JSON.stringify([rootNodeId(project), project.nodes.map((n) => n.id), project.segments.map((s) => [s.node_a_id, s.node_b_id])])
    : "";
  const autoPositions = useMemo(
    () => (project && needsLayout ? autoLayout(project) : null),
    [shapeKey, needsLayout], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Diámetro por segmento (etapa 4): mismo cálculo que la pantalla de Costs.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void invoke<CostReport>("compute_costs", { project, library }).then((r) => {
      if (!cancelled) setReport(r);
    });
    return () => {
      cancelled = true;
    };
  }, [project, library]);

  const mainConnector = project?.connector_instances.find((c) => c.id === project.project.main_connector_instance_id);
  useEffect(() => {
    if (!project || !mainConnector || !showDistances) {
      setDistances(null);
      return;
    }
    let cancelled = false;
    void invoke<Record<string, number>>("node_distances", { project, fromNodeId: mainConnector.node_id }).then((d) => {
      if (!cancelled) setDistances(d);
    });
    return () => {
      cancelled = true;
    };
  }, [project, mainConnector, showDistances]);

  // Cable seleccionado (desde Wires o el Inspector): se resalta su recorrido y el de toda su net.
  useEffect(() => {
    if (!project || selection?.kind !== "wire") {
      setHighlight({ wire: new Set(), net: new Set() });
      return;
    }
    const wireId = selection.id;
    let cancelled = false;
    void (async () => {
      const netIds = await invoke<number[]>("wire_net", { project, wireId });
      const ids = netIds.includes(wireId) ? netIds : [wireId, ...netIds];
      const routes = await Promise.all(ids.map((id) => invoke<number[] | null>("wire_route", { project, wireId: id })));
      if (cancelled) return;
      const net = new Set(routes.flatMap((r) => r ?? []));
      const wire = new Set(routes[ids.indexOf(wireId)] ?? []);
      setHighlight({ wire, net });
    })();
    return () => {
      cancelled = true;
    };
  }, [project, selection]);

  const issues = useMemo(() => (project ? issuesByElement(project, findings) : null), [project, findings]);
  const tree = useMemo(
    () => (project ? rootedTree(project.segments, project.nodes.map((n) => n.id), rootNodeId(project)) : null),
    [project],
  );
  const k = useMemo(() => (project ? pxPerMm(project.segments.map((s) => s.length_mm)) : 1), [project]);
  const sizeOf = (id: number) => {
    const measured = sizes.current.get(String(id));
    if (measured) return measured;
    const fallback = project && isBlock(project, id) ? BLOCK_SIZE : POINT_SIZE;
    return { w: fallback.width, h: fallback.height };
  };

  // Supr / Backspace borra el segmento o el nodo seleccionado (si se puede).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!project || !selection || (e.key !== "Delete" && e.key !== "Backspace")) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      let result: ProjectData | string | null = null;
      if (selection.kind === "segment") result = deleteSegment(project, selection.id);
      else if (selection.kind === "node") result = deleteNode(project, selection.id);
      else if (selection.kind === "connector" || selection.kind === "ground" || selection.kind === "splice")
        result = "Delete connectors, ground points and splices from their table (Connectors / Splices).";
      if (result === null) return;
      e.preventDefault();
      if (typeof result === "string") setNotice(result);
      else {
        setProject(result);
        onSelect(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [project, selection, setProject, onSelect]);

  // Nodos de React Flow: se reconstruyen desde el proyecto; mientras se
  // arrastra, React Flow mueve su copia local y al soltar se guarda.
  useEffect(() => {
    if (!project || !issues) {
      setFlowNodes([]);
      return;
    }
    const genderOf = (partId: number) => {
      const def = library.connector_defs.find((cd) => cd.part_id === partId);
      return def ? (def.gender === "male" ? "M" : "F") : "?";
    };
    const freePosition = (n: (typeof project.nodes)[number]) =>
      n.diagram_x != null && n.diagram_y != null ? { x: n.diagram_x, y: n.diagram_y } : autoPositions?.get(n.id) ?? { x: 0, y: 0 };
    // A escala: el dibujo libre solo da la dirección de cada rama.
    let scaled: Map<number, { x: number; y: number }> | null = null;
    if (toScale && tree) {
      const centers = new Map(
        project.nodes.map((n) => {
          const p = freePosition(n);
          const sz = sizeOf(n.id);
          return [n.id, { x: p.x + sz.w / 2, y: p.y + sz.h / 2 }];
        }),
      );
      scaled = scaledCenters(tree, centers, k);
    }
    setFlowNodes(
      project.nodes.map((n) => {
        const c = scaled?.get(n.id);
        const sz = sizeOf(n.id);
        const position = c ? { x: c.x - sz.w / 2, y: c.y - sz.h / 2 } : freePosition(n);
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
        let data: HarnessNodeData;
        if (connectors.length > 0) {
          data = {
            ...base,
            variant: "connector",
            title: connectors.map((x) => x.short_id).join(" / "),
            subtitle: connectors.map((x) => x.name).filter(Boolean).join(" / "),
            gender: connectors.map((x) => genderOf(x.library_part_id)).join("/"),
            pending: connectors.some((x) => x.status === "pending"),
            isMain: connectors.some((x) => x.id === mainConnector?.id),
            selected: base.selected || connectors.some((x) => sameSelection(selection, { kind: "connector", id: x.id })),
          };
        } else if (ground) {
          data = { ...base, variant: "ground", title: ground.short_id, subtitle: ground.name };
        } else if (n.kind === "connector_end" || n.kind === "ground_point") {
          const isGround = n.kind === "ground_point";
          data = {
            ...base,
            variant: isGround ? "ground" : "connector",
            title: `Node ${n.id}`,
            subtitle: "",
            missing: isGround ? "no ground point assigned" : "no connector assigned",
          };
        } else {
          data = {
            ...base,
            variant: "point",
            title: "",
            subtitle: "",
          };
        }
        return { id: String(n.id), type: "harness", position, data };
      }),
    );
  }, [project, library, autoPositions, selection, issues, distances, mainConnector, toScale, tree, k, sizeTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const edges = useMemo<Edge<SegmentEdgeData>[]>(() => {
    if (!project || !issues) return [];
    return project.segments.map((s) => {
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
        id: `s${s.id}`,
        source: String(s.node_a_id),
        target: String(s.node_b_id),
        sourceHandle: "c-s",
        targetHandle: "c-t",
        type: "segment",
        data: {
          label: `${s.length_mm} mm`,
          lengthMm: s.length_mm,
          diameter: diameter && diameter > 0 ? diameter.toFixed(1) : null,
          markers,
          highlight: highlight.wire.has(s.id) ? "wire" : highlight.net.has(s.id) ? "net" : "none",
          selected: sameSelection(selection, { kind: "segment", id: s.id }),
          issue: issues.segments.get(s.id) ?? null,
          onSelect: () => onSelect({ kind: "segment", id: s.id }),
          onLengthChange: (mm: number) => setProject(setSegmentLength(project, s.id, mm)),
          onSplit: () => split(s.id),
        },
      };
    });
  }, [project, report, highlight, selection, issues, onSelect]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) {
    return <p>Open or load a project first (Topology tab).</p>;
  }

  function savePositions(dragged: FlowNode[]) {
    // Al primer arrastre se fijan las posiciones de todos los nodos (incluidas
    // las del layout automático), para que el dibujo quede como se ve. A
    // escala, la posición buena es la ya restringida (no la del cursor).
    const byId = new Map(flowNodesRef.current.map((n) => [Number(n.id), n.position]));
    if (!toScale) for (const n of dragged) byId.set(Number(n.id), n.position);
    setProject({
      ...project!,
      nodes: project!.nodes.map((n) => {
        const p = byId.get(n.id);
        return p ? { ...n, diagram_x: Math.round(p.x), diagram_y: Math.round(p.y) } : n;
      }),
    });
  }

  function onNodesChange(changes: NodeChange<FlowNode<HarnessNodeData>>[]) {
    let sizeChanged = false;
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) {
        const old = sizes.current.get(c.id);
        if (!old || Math.abs(old.w - c.dimensions.width) > 1 || Math.abs(old.h - c.dimensions.height) > 1) {
          sizes.current.set(c.id, { w: c.dimensions.width, h: c.dimensions.height });
          sizeChanged = true;
        }
      }
    }
    if (toScale && tree) {
      const current = flowNodesRef.current;
      const centers = new Map(
        current.map((n) => {
          const sz = sizeOf(Number(n.id));
          return [Number(n.id), { x: n.position.x + sz.w / 2, y: n.position.y + sz.h / 2 }];
        }),
      );
      changes = changes.flatMap((c) => {
        if (c.type !== "position" || !c.position || !c.dragging) return [c];
        const id = Number(c.id);
        const sz = sizeOf(id);
        const moved = constrainDrag(tree, centers, id, { x: c.position.x + sz.w / 2, y: c.position.y + sz.h / 2 }, k);
        return [...moved].map(([nid, center]) => {
          const nsz = sizeOf(nid);
          return { ...c, id: String(nid), position: { x: center.x - nsz.w / 2, y: center.y - nsz.h / 2 } };
        });
      });
    }
    setFlowNodes((ns) => applyNodeChanges(changes, ns));
    if (sizeChanged && toScale) setSizeTick((t) => t + 1);
  }

  function runAutoLayout() {
    const positions = autoLayout(project!);
    window.setTimeout(() => void flow?.fitView({ duration: 200 }), 50);
    setProject({
      ...project!,
      nodes: project!.nodes.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, diagram_x: Math.round(p.x), diagram_y: Math.round(p.y) } : n;
      }),
    });
  }

  const centerOf = (id: number) => {
    const n = flowNodesRef.current.find((x) => x.id === String(id));
    const sz = sizeOf(id);
    return n ? { x: n.position.x + sz.w / 2, y: n.position.y + sz.h / 2 } : { x: 0, y: 0 };
  };

  function split(segmentId: number) {
    const seg = project!.segments.find((x) => x.id === segmentId);
    if (!seg) return;
    const a = centerOf(seg.node_a_id);
    const b = centerOf(seg.node_b_id);
    const result = splitSegment(project!, segmentId, { x: (a.x + b.x) / 2 - POINT_SIZE.width / 2, y: (a.y + b.y) / 2 - POINT_SIZE.height / 2 });
    if (typeof result === "string") return setNotice(result);
    setProject(result.project);
    onSelect({ kind: "node", id: result.nodeId });
  }

  // Soltar el "+" de un nodo: sobre otro nodo, los une con un segmento; en un
  // lugar vacío, crea una rama nueva (nodo de conector sin asignar) ahí.
  function onConnectEnd(event: MouseEvent | TouchEvent, state: FinalConnectionState) {
    const from = state.fromNode ? Number(state.fromNode.id) : null;
    if (from === null || !flow) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    const target = document.elementFromPoint(point.clientX, point.clientY)?.closest(".react-flow__node")?.getAttribute("data-id");
    if (target && Number(target) !== from) {
      const result = connectNodes(project!, from, Number(target));
      if (typeof result === "string") return setNotice(result);
      setProject(result);
      return;
    }
    if (target) return;
    const at = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    const result = addBranch(project!, from, { x: at.x - BLOCK_SIZE.width / 2, y: at.y - BLOCK_SIZE.height / 2 });
    setProject(result.project);
    onSelect({ kind: "node", id: result.nodeId });
  }

  return (
    <div className="diagram-screen">
      <div className="toolbar diagram-toolbar">
        <button onClick={runAutoLayout} title="Rearrange the whole diagram automatically (can be undone)">
          Auto layout
        </button>
        <label title={mainConnector ? undefined : "Set a main connector for the project first"}>
          <input
            type="checkbox"
            checked={showDistances}
            disabled={!mainConnector}
            onChange={(e) => setShowDistances(e.currentTarget.checked)}
          />{" "}
          Distance from {mainConnector?.short_id ?? "main connector"}
        </label>
        <label title="Draw every segment proportional to its length. Dragging a node turns it around the node it hangs from, keeping the length.">
          <input
            type="checkbox"
            checked={toScale}
            onChange={(e) => {
              setToScale(e.currentTarget.checked);
              window.setTimeout(() => void flow?.fitView({ duration: 200 }), 50);
            }}
          />{" "}
          To scale
        </label>
        <span style={{ flex: 1 }} />
        {notice ? (
          <span className="diagram-notice" role="status">{notice}</span>
        ) : (
          <span className="hint" style={{ margin: 0 }}>{toScale ? "Segment lengths to scale" : "Not to scale · lengths in mm"}</span>
        )}
      </div>
      <div className="diagram-canvas">
        {project.nodes.length === 0 ? (
          <p className="hint" style={{ padding: "1rem" }}>No nodes yet — add them in the Topology tab.</p>
        ) : (
          <ReactFlow
            nodes={flowNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={(_e, _node, dragged) => savePositions(dragged)}
            onNodeClick={(_e, node) => onSelect(infoFor(project, Number(node.id)).select)}
            onNodeDoubleClick={(_e, node) => setOpenNodeId(Number(node.id))}
            onConnectEnd={onConnectEnd}
            zoomOnDoubleClick={false}
            onEdgeClick={(_e, edge) => onSelect({ kind: "segment", id: Number(edge.id.slice(1)) })}
            onPaneClick={() => onSelect(null)}
            elementsSelectable={false}
            fitView
            proOptions={{ hideAttribution: true }}
            onInit={setFlow}
            minZoom={0.2}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        {openNodeId !== null && project.nodes.some((n) => n.id === openNodeId) && (
          <NodePanel
            key={openNodeId}
            project={project}
            library={library}
            report={report}
            nodeId={openNodeId}
            onClose={() => setOpenNodeId(null)}
            onAssign={(partId, name) => {
              const result = assignConnector(project, library, openNodeId, partId, name);
              setProject(result.project);
              onSelect({ kind: "connector", id: result.connectorId });
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Panel de un nodo (doble click): si es un extremo sin conector, se le asigna
 * uno de la biblioteca; si tiene conector, muestra su pinout (plan 7.3 / 10.4):
 * Pin · Función · Termina en · Calibre · Color · Largo de corte.
 */
function NodePanel({ project, library, report, nodeId, onClose, onAssign }: {
  project: ProjectData;
  library: Library;
  report: CostReport | null;
  nodeId: number;
  onClose: () => void;
  onAssign: (connectorDefId: number, name: string) => void;
}) {
  const connector = project.connector_instances.find((c) => c.node_id === nodeId);
  const node = project.nodes.find((n) => n.id === nodeId)!;
  const [partId, setPartId] = useState<number | "">("");
  const [name, setName] = useState("");
  const partNumber = (id: number) => library.parts.find((p) => p.id === id)?.part_number ?? `#${id}`;

  let body;
  if (connector) {
    const def = library.connector_defs.find((d) => d.part_id === connector.library_part_id);
    const rows = connector.cavities.map((cav) => {
      const wires = project.wire_instances
        .map((w) => ({ w, here: w.end_a.cavity_assignment_id === cav.id ? "a" : w.end_b.cavity_assignment_id === cav.id ? "b" : null }))
        .filter((x) => x.here !== null);
      return { cav, wires };
    });
    body = (
      <>
        <div className="dg-panel-sub">
          {partNumber(connector.library_part_id)}
          {def ? ` · ${def.series ?? ""} ${def.cavities.length}-way ${def.gender}` : ""}
        </div>
        <ConnectorViews library={library} partId={connector.library_part_id} only="image_front" used={usedCavities(project, connector)} />
        <table className="compact-table dg-pinout">
          <thead>
            <tr><th>Pin</th><th>Function</th><th>Goes to</th><th>Gauge</th><th>Color</th><th>Cut</th></tr>
          </thead>
          <tbody>
            {rows.map(({ cav, wires }) =>
              wires.length === 0 ? (
                <tr key={cav.id} className="dg-pin-unused">
                  <td>{cav.cavity_id}</td>
                  <td colSpan={5}>{cav.external_reference ?? (cav.seal_plug_library_part_id != null ? "plugged" : "—")}</td>
                </tr>
              ) : (
                wires.map(({ w, here }) => (
                  <tr key={`${cav.id}-${w.id}`}>
                    <td>{cav.cavity_id}</td>
                    <td>{w.specific_name ?? w.short_id}</td>
                    <td>{endLabel(project, here === "a" ? w.end_b : w.end_a)}</td>
                    <td>{library.wire_defs.find((d) => d.part_id === w.library_part_id)?.gauge ?? "—"}</td>
                    <td>{w.color ?? "—"}</td>
                    <td className="num">{report?.cut_list.find((c) => c.wire_id === w.id)?.cut_length_mm.toFixed(0) ?? "—"}</td>
                  </tr>
                ))
              ),
            )}
          </tbody>
        </table>
      </>
    );
  } else if (node.kind === "connector_end") {
    body = (
      <div className="dg-panel-form">
        <label>
          Part
          <select value={partId} onChange={(e) => setPartId(e.currentTarget.value ? Number(e.currentTarget.value) : "")}>
            <option value="">choose…</option>
            {library.connector_defs.map((d) => (
              <option key={d.part_id} value={d.part_id}>
                {partNumber(d.part_id)} · {d.series ?? ""} {d.cavities.length}-way {d.gender}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Oil Temp" />
        </label>
        <button className="button-primary" disabled={partId === ""} onClick={() => partId !== "" && onAssign(partId, name)}>
          Assign connector
        </button>
        {library.connector_defs.length === 0 && <p className="hint">The library has no connectors — add them in Library → Connectors.</p>}
      </div>
    );
  } else {
    body = <p className="hint">Nothing to show for a {node.kind.replace("_", " ")} here — use the Inspector.</p>;
  }

  return (
    <div className="dg-panel" role="dialog" aria-label={connector ? `${connector.short_id} pinout` : `Node ${nodeId}`}>
      <div className="dg-panel-head">
        <span>{connector ? `${connector.short_id} · ${connector.name || "—"}` : `Node ${nodeId}`}</span>
        <button className="icon-button" onClick={onClose} title="Close" aria-label="Close">×</button>
      </div>
      <div className="dg-panel-body">{body}</div>
    </div>
  );
}
