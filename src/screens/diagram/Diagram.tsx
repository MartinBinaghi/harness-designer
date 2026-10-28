import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ReactFlow, Background, BackgroundVariant, Controls, applyNodeChanges, type Node as FlowNode, type Edge, type NodeChange, type ReactFlowInstance, type FinalConnectionState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { infoFor } from "../../logic/nodeLabels";
import { constrainDrag, pxPerMm, rootedTree, scaledCenters } from "../../logic/diagramScale";
import { BLOCK_SIZE, POINT_SIZE, autoLayout, isBlock, rootNodeId } from "../../logic/diagramLayout";
import { addBranch, assignConnector, connectNodes, deleteNode, deleteSegment, setSegmentLength, splitSegment } from "../../logic/projectEdit";
import type { Finding, ProjectData, Selection } from "../../model/project";
import type { Library } from "../../model/library";
import type { CostReport } from "../../model/calc";
import { NodePanel } from "./NodePanel";
import { edgeTypes, nodeTypes } from "./elements";
import { issuesByElement, nodeData, segmentData, type HarnessNodeData, type SegmentEdgeData } from "./flowData";

/**
 * Diagrama de armado (plan 10.2): no escalado, con medidas. Es otra vista de
 * los mismos datos — mover un nodo guarda su posición en el proyecto (un paso
 * de undo), y la selección es la misma que usan el árbol, las tablas y el
 * inspector. También edita (plan 10.4): ramas nuevas arrastrando desde el "+"
 * de un nodo, largo con doble click en la etiqueta, breakout en un segmento,
 * Supr para borrar, doble click en un conector para asignarlo o ver su pinout.
 */

interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData) => void;
  library: Library;
  findings: Finding[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Costos de la revisión actual (diámetros), o null mientras se calculan. */
  report: CostReport | null;
  /** Revisión del proyecto en el backend: las consultas de recorrido se rehacen cuando cambia. */
  projectRevision: number;
}

export default function Diagram({ project, setProject, library, findings, selection, onSelect, report, projectRevision }: Props) {
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
  const rootRef = useRef<HTMLDivElement>(null);
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


  const mainConnector = project?.connector_instances.find((c) => c.id === project.project.main_connector_instance_id);
  useEffect(() => {
    if (!projectRevision || !mainConnector || !showDistances) {
      setDistances(null);
      return;
    }
    let cancelled = false;
    void invoke<Record<string, number>>("node_distances", { fromNodeId: mainConnector.node_id }).then((d) => {
      if (!cancelled) setDistances(d);
    });
    return () => {
      cancelled = true;
    };
  }, [projectRevision, mainConnector?.node_id, showDistances]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cable seleccionado (desde Wires o el Inspector): se resalta su recorrido y el de toda su net.
  useEffect(() => {
    if (!projectRevision || selection?.kind !== "wire") {
      setHighlight({ wire: new Set(), net: new Set() });
      return;
    }
    const wireId = selection.id;
    let cancelled = false;
    void (async () => {
      const netIds = await invoke<number[]>("wire_net", { wireId });
      const ids = netIds.includes(wireId) ? netIds : [wireId, ...netIds];
      const routes = await Promise.all(ids.map((id) => invoke<number[] | null>("wire_route", { wireId: id })));
      if (cancelled) return;
      const net = new Set(routes.flatMap((r) => r ?? []));
      const wire = new Set(routes[ids.indexOf(wireId)] ?? []);
      setHighlight({ wire, net });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRevision, selection]);

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
      if (rootRef.current?.closest("[hidden]")) return; // pestaña oculta (otra a la vista)
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
        return { id: String(n.id), type: "harness", position, data: nodeData(project, library, n, { selection, issues, distances, mainConnector }) };
      }),
    );
  }, [project, library, autoPositions, selection, issues, distances, mainConnector, toScale, tree, k, sizeTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const edges = useMemo<Edge<SegmentEdgeData>[]>(() => {
    if (!project || !issues) return [];
    return project.segments.map((s) => ({
      id: `s${s.id}`,
      source: String(s.node_a_id),
      target: String(s.node_b_id),
      sourceHandle: "c-s",
      targetHandle: "c-t",
      type: "segment",
      data: {
        ...segmentData(project, s, report, highlight, { selection, issues }),
        onSelect: () => onSelect({ kind: "segment", id: s.id }),
        onLengthChange: (mm: number) => setProject(setSegmentLength(project, s.id, mm)),
        onSplit: () => split(s.id),
      },
    }));
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

  // Un extremo suelto nuevo, debajo de lo que ya hay (o el primero del arnés):
  // de ahí se arrastra su "+" para dibujar las ramas.
  function addLooseNode() {
    const placed = flowNodesRef.current.map((n) => n.position);
    const x = placed.length > 0 ? Math.min(...placed.map((p) => p.x)) : 0;
    const y = placed.length > 0 ? Math.max(...placed.map((p) => p.y)) + 120 : 0;
    const id = project!.nodes.reduce((m, n) => Math.max(m, n.id), 0) + 1;
    setProject({
      ...project!,
      nodes: [...project!.nodes, { id, kind: "connector_end", termination: null, termination_library_part_id: null, diagram_x: x, diagram_y: y, adhesive_heatshrink_length_mm: null }],
    });
    onSelect({ kind: "node", id });
    window.setTimeout(() => void flow?.fitView({ duration: 200, maxZoom: 1 }), 80);
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
    <div className="diagram-screen" ref={rootRef}>
      <div className="toolbar diagram-toolbar">
        <button onClick={addLooseNode} title="Add a loose connector end; then drag its '+' to draw a branch">+ Node</button>
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
          <div className="diagram-empty">
            <p>The harness has no topology yet.</p>
            <ol className="hint">
              <li>Add the first end (usually the main connector).</li>
              <li>Hover it and drag the <strong>+</strong> that appears to draw each branch; drop on an empty spot for a new end.</li>
              <li>Double-click an end to give it a connector; double-click a length to edit it.</li>
            </ol>
            <button className="button-primary" onClick={addLooseNode}>+ Add the first node</button>
          </div>
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
            onAssign={(partId, name, deviceConnectorId) => {
              const result = assignConnector(project, library, openNodeId, partId, name, deviceConnectorId);
              setProject(result.project);
              onSelect({ kind: "connector", id: result.connectorId });
            }}
          />
        )}
      </div>
    </div>
  );
}
