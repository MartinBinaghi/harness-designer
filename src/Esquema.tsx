import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  BaseEdge,
  ConnectionMode,
  getBezierPath,
  applyNodeChanges,
  type Node as FlowNode,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type NodeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GaugeFacts } from "./costTypes";
import { BLOCK_HEADER, BLOCK_WIDTH, PIN_ROW, buildSchematic, type SchematicBlock, type SchematicPin } from "./schematic";
import { addWire } from "./projectEdit";
import type { ProjectData, Selection, WireEnd } from "./types";
import type { Library } from "./libraryTypes";

/**
 * Vista esquemática pin a pin (plan 10.3): se genera sola desde los datos —
 * conectores con sus pines, una línea por cable con su color, splices / masas
 * / componentes como puntos de unión. Arrastrar de un pin a otro crea un cable
 * (el mismo registro que la tabla de Wires). Las posiciones no se guardan: es
 * una vista calculada; mover un bloque dura hasta que cambian los datos.
 */

// Ids de handle: "cav:<cavityAssignmentId>:L|R" para pines, "blk:<key>:L|R" para puntos de unión.
const pinHandle = (cavityId: number, side: "L" | "R") => `cav:${cavityId}:${side}`;
const blockHandle = (key: string, side: "L" | "R") => `blk:${key}:${side}`;

function handleToEnd(handle: string | null): WireEnd | null {
  if (!handle) return null;
  const [type, id] = handle.split(":");
  const blank: WireEnd = { kind: "cavity", cavity_assignment_id: null, splice_id: null, ground_point_id: null, component_instance_id: null };
  if (type === "cav") return { ...blank, cavity_assignment_id: Number(id) };
  const n = Number(id.slice(1));
  if (id.startsWith("s")) return { ...blank, kind: "splice", splice_id: n };
  if (id.startsWith("g")) return { ...blank, kind: "ground", ground_point_id: n };
  if (id.startsWith("r")) return { ...blank, kind: "component", component_instance_id: n };
  return null;
}

interface BlockData extends Record<string, unknown> {
  block: SchematicBlock;
  selected: boolean;
}

function PinRow({ pin, index }: { pin: SchematicPin; index: number }) {
  const top = BLOCK_HEADER + index * PIN_ROW + PIN_ROW / 2;
  return (
    <>
      <div className="sc-pin" title={pin.note || undefined}>
        <span className="sc-pin-id">{pin.label}</span>
        <span className="sc-pin-note">{pin.note}</span>
      </div>
      <Handle id={pinHandle(pin.cavityId, "L")} type="source" position={Position.Left} className="sc-handle" style={{ top }} />
      <Handle id={pinHandle(pin.cavityId, "R")} type="source" position={Position.Right} className="sc-handle" style={{ top }} />
    </>
  );
}

function BlockNode({ data }: NodeProps<FlowNode<BlockData>>) {
  const b = data.block;
  if (b.kind !== "connector") {
    return (
      <div className={`sc-junction sc-junction-${b.kind}${data.selected ? " sc-selected" : ""}`} title={b.subtitle || undefined}>
        <Handle id={blockHandle(b.key, "L")} type="source" position={Position.Left} className="sc-handle" />
        <Handle id={blockHandle(b.key, "R")} type="source" position={Position.Right} className="sc-handle" />
        <span className="sc-junction-dot" />
        <span className="sc-junction-label">{b.title}</span>
      </div>
    );
  }
  return (
    <div className={`sc-block${data.selected ? " sc-selected" : ""}`} style={{ width: BLOCK_WIDTH }}>
      <div className="sc-block-head">
        <span className="sc-block-id">{b.title}</span>
        <span className="sc-block-name">{b.subtitle}</span>
      </div>
      {b.pins.map((pin, i) => (
        <PinRow key={pin.cavityId} pin={pin} index={i} />
      ))}
      {b.pins.length === 0 && <div className="sc-pin sc-pin-empty">no wires yet</div>}
      {b.hiddenPins > 0 && <div className="sc-pin sc-pin-empty">+{b.hiddenPins} unused</div>}
    </div>
  );
}

interface WireData extends Record<string, unknown> {
  color: string | null;
  highlight: "none" | "net" | "wire";
  label: string;
}

/** Línea de un cable: un borde oscuro debajo y el color del cable encima (así un cable blanco se ve). */
function WireEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data }: EdgeProps<Edge<WireData>>) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const d = data!;
  const width = d.highlight === "wire" ? 4 : d.highlight === "net" ? 3 : 2;
  return (
    <>
      <BaseEdge
        id={`${id}-under`}
        path={path}
        style={{ stroke: d.highlight !== "none" ? "var(--accent)" : "var(--text-muted)", strokeWidth: width + 2 }}
        interactionWidth={14}
      />
      <path d={path} fill="none" stroke={d.color ?? "var(--surface)"} strokeWidth={width} pointerEvents="none">
        <title>{d.label}</title>
      </path>
    </>
  );
}

const nodeTypes = { block: BlockNode };
const edgeTypes = { wire: WireEdge };

interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData) => void;
  library: Library;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Revisión del proyecto en el backend: la net resaltada se rehace cuando cambia. */
  projectRevision: number;
  /** Calibres ya interpretados por el núcleo, para el tipo de un cable nuevo. */
  gauges: GaugeFacts | null;
}

export default function Esquema({ project, setProject, library, selection, onSelect, projectRevision, gauges }: Props) {
  const [showAllPins, setShowAllPins] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [netWires, setNetWires] = useState<Set<number>>(new Set());

  const model = useMemo(() => (project ? buildSchematic(project, library, showAllPins) : null), [project, library, showAllPins]);
  const [nodes, setNodes] = useState<FlowNode<BlockData>[]>([]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Cable seleccionado: se resalta él y el resto de su net.
  useEffect(() => {
    if (!projectRevision || selection?.kind !== "wire") {
      setNetWires(new Set());
      return;
    }
    let cancelled = false;
    void invoke<number[]>("wire_net", { wireId: selection.id }).then((ids) => {
      if (!cancelled) setNetWires(new Set(ids));
    });
    return () => {
      cancelled = true;
    };
  }, [projectRevision, selection]);

  const isSelected = (b: SchematicBlock) =>
    !!selection &&
    ((b.kind === "connector" && selection.kind === "connector" && selection.id === b.refId) ||
      (b.kind === "splice" && selection.kind === "splice" && selection.id === b.refId) ||
      (b.kind === "ground" && selection.kind === "ground" && selection.id === b.refId));

  // Los bloques se regeneran cuando cambian los datos; mover uno solo dura hasta entonces.
  useEffect(() => {
    if (!model) return setNodes([]);
    setNodes(model.blocks.map((b) => ({ id: b.key, type: "block", position: { x: b.x, y: b.y }, data: { block: b, selected: isSelected(b) } })));
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, selected: isSelected(n.data.block) } })));
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

  const edges = useMemo<Edge<WireData>[]>(() => {
    if (!model) return [];
    const xOf = new Map(nodes.map((n) => [n.id, n.position.x]));
    return model.links.map((l) => {
      const ax = xOf.get(l.from.block) ?? 0;
      const bx = xOf.get(l.to.block) ?? 0;
      // Cada punta sale por el lado que mira al otro bloque; en la misma columna, ambas por la derecha.
      const [sa, sb] = ax < bx ? (["R", "L"] as const) : ax > bx ? (["L", "R"] as const) : (["R", "R"] as const);
      const handle = (end: typeof l.from, side: "L" | "R") => (end.cavityId !== null ? pinHandle(end.cavityId, side) : blockHandle(end.block, side));
      const highlight = selection?.kind === "wire" && selection.id === l.wireId ? "wire" : netWires.has(l.wireId) ? "net" : "none";
      return {
        id: `w${l.wireId}`,
        source: l.from.block,
        target: l.to.block,
        sourceHandle: handle(l.from, sa),
        targetHandle: handle(l.to, sb),
        type: "wire",
        data: { color: l.color, highlight, label: l.label },
        zIndex: highlight === "none" ? 0 : 1,
      };
    });
  }, [model, nodes, selection, netWires]);

  if (!project || !model) {
    return <p>Open or load a project first (Topology tab).</p>;
  }

  function onConnect(c: Connection) {
    const a = handleToEnd(c.sourceHandle ?? null);
    const b = handleToEnd(c.targetHandle ?? null);
    if (!a || !b) return;
    const result = addWire(project!, library, gauges, a, b);
    if (typeof result === "string") return setNotice(result);
    setProject(result.project);
    onSelect({ kind: "wire", id: result.wireId });
    setNotice(`Added W${String(result.wireId).padStart(3, "0")} — set its type, name and color in Wires.`);
  }

  function selectBlock(b: SchematicBlock) {
    if (b.kind === "connector") onSelect({ kind: "connector", id: b.refId });
    else if (b.kind === "splice") onSelect({ kind: "splice", id: b.refId });
    else if (b.kind === "ground") onSelect({ kind: "ground", id: b.refId });
  }

  return (
    <div className="diagram-screen">
      <div className="toolbar diagram-toolbar">
        <label>
          <input type="checkbox" checked={showAllPins} onChange={(e) => setShowAllPins(e.currentTarget.checked)} /> Show unused pins
        </label>
        <span style={{ flex: 1 }} />
        {notice ? (
          <span className="diagram-notice" role="status">{notice}</span>
        ) : (
          <span className="hint" style={{ margin: 0 }}>Generated from the data · drag from one pin to another to add a wire</span>
        )}
      </div>
      <div className="diagram-canvas">
        {model.blocks.length === 0 ? (
          <p className="hint" style={{ padding: "1rem" }}>No connectors yet.</p>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={(changes: NodeChange<FlowNode<BlockData>>[]) => setNodes((ns) => applyNodeChanges(changes, ns))}
            onNodeClick={(_e, n) => selectBlock(n.data.block)}
            onEdgeClick={(_e, e) => onSelect({ kind: "wire", id: Number(e.id.slice(1)) })}
            onPaneClick={() => onSelect(null)}
            onConnect={onConnect}
            connectionMode={ConnectionMode.Loose}
            elementsSelectable={false}
            zoomOnDoubleClick={false}
            fitView
            proOptions={{ hideAttribution: true }}
            minZoom={0.1}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
