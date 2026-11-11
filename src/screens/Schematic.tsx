import { memo, useEffect, useMemo, useState } from "react";
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
import type { GaugeFacts } from "../model/calc";
import { BLOCK_HEADER, BLOCK_WIDTH, PIN_ROW, buildSchematic, type SchematicBlock, type SchematicPin } from "../logic/schematicLayout";
import { BLANK_END, addWire } from "../logic/projectEdit";
import { wireColors } from "../logic/sheets";
import type { ProjectData, Selection, WireEnd } from "../model/project";
import type { Library } from "../model/library";

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
  const blank = BLANK_END;
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

/**
 * Línea de un cable: un borde oscuro debajo y el color del cable encima (así un
 * cable blanco se ve). Con doble color ("orange/white"), el segundo va en tramos
 * sobre el primero, como la raya del cable.
 */
function WireEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data }: EdgeProps<Edge<WireData>>) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const d = data!;
  const width = d.highlight === "wire" ? 4 : d.highlight === "net" ? 3 : 2;
  const [base, stripe] = wireColors(d.color);
  return (
    <>
      <BaseEdge
        id={`${id}-under`}
        path={path}
        style={{ stroke: d.highlight !== "none" ? "var(--accent)" : "var(--text-muted)", strokeWidth: width + 2 }}
        interactionWidth={14}
      />
      <path d={path} fill="none" stroke={base ?? "var(--surface)"} strokeWidth={width} pointerEvents="none">
        <title>{d.label}</title>
      </path>
      {stripe && <path d={path} fill="none" stroke={stripe} strokeWidth={width} strokeDasharray="6 6" pointerEvents="none" />}
    </>
  );
}

// Rendimiento (Martin: con su arnés, 138 cables y bloques de 105 vías, la pestaña iba lenta): un bloque o un
// cable se redibuja solo si cambió lo que muestra. Antes, un clic en un cable rehacía todos los bloques (con
// todas sus patitas) y todos los cables, y arrastrar un bloque rehacía todos los cables en cada cuadro.
const sameWire = (a: EdgeProps<Edge<WireData>>, b: EdgeProps<Edge<WireData>>) =>
  a.sourceX === b.sourceX && a.sourceY === b.sourceY && a.targetX === b.targetX && a.targetY === b.targetY &&
  a.sourcePosition === b.sourcePosition && a.targetPosition === b.targetPosition &&
  a.data?.color === b.data?.color && a.data?.highlight === b.data?.highlight && a.data?.label === b.data?.label;
// Un bloque solo depende de sus datos: mientras se arrastra le llegan la posición y "dragging", que no usa,
// y sin esto rehacía sus filas y patitas (105 vías en la ECU) en cada cuadro.
const nodeTypes = { block: memo(BlockNode, (a, b) => a.data === b.data) };
const edgeTypes = { wire: memo(WireEdge, sameWire) };

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

export default function Schematic({ project, setProject, library, selection, onSelect, projectRevision, gauges }: Props) {
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
  // Solo cambian los bloques que se seleccionan o dejan de estarlo; los demás quedan como están (no se redibujan).
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => {
        const selected = isSelected(n.data.block);
        return selected === n.data.selected ? n : { ...n, data: { ...n.data, selected } };
      }),
    );
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Por qué lado sale cada punta de cada cable: el que mira al otro bloque; en la misma columna, ambas por la
  // derecha. Mientras se arrastra un bloque, esto cambia solo cuando cruza a otro bloque, así que la lista de
  // cables (y los que no tocan al bloque arrastrado) no se rehace en cada cuadro.
  const xOf = new Map(nodes.map((n) => [n.id, n.position.x]));
  const sides = (model?.links ?? [])
    .map((l) => {
      const ax = xOf.get(l.from.block) ?? 0;
      const bx = xOf.get(l.to.block) ?? 0;
      return ax < bx ? "RL" : ax > bx ? "LR" : "RR";
    })
    .join("");

  const edges = useMemo<Edge<WireData>[]>(() => {
    if (!model) return [];
    return model.links.map((l, i) => {
      const [sa, sb] = [sides[2 * i] as "L" | "R", sides[2 * i + 1] as "L" | "R"];
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
  }, [model, sides, selection, netWires]);

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
