import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Node, ProjectData, Segment, Selection } from "./types";
import type { Library } from "./libraryTypes";
import { buildTreeText } from "./tree";
import { FolderIcon, SaveIcon, TrashIcon } from "./icons";
import { fileName, isChosenPath, pickFileToOpen, pickFileToSave } from "./fileDialogs";
import { nextId } from "./projectEdit";

export const NODE_KIND_LABELS: Record<Node["kind"], string> = {
  connector_end: "Connector end",
  breakout: "Breakout",
  splice_point: "Splice point",
  ground_point: "Ground point",
};
export const TERMINATION_LABELS: Record<NonNullable<Node["termination"]>, string> = {
  t_mold: "T-mold",
  adhesive_heatshrink: "Adhesive heat-shrink",
  none: "None",
};
export const NODE_KINDS = Object.keys(NODE_KIND_LABELS) as Node["kind"][];
export const TERMINATIONS = Object.keys(TERMINATION_LABELS) as NonNullable<Node["termination"]>[];


interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData | null) => void;
  /** El backend ya tiene el proyecto nuevo (open_project/demo_project); esto solo refleja el espejo local. */
  loadProject: (p: ProjectData) => void;
  /** Descarta cualquier edición pendiente antes de reemplazar el documento entero. */
  cancelProjectEdits: () => void;
  /** Manda cualquier edición pendiente al backend ya, sin esperar la pausa de tipeo. */
  flushProjectEdits: () => Promise<void>;
  filePath: string;
  setFilePath: (p: string) => void;
  library: Library;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export default function Topologia({ project, setProject, loadProject, cancelProjectEdits, flushProjectEdits, filePath, setFilePath, library, selection, onSelect }: Props) {
  const [status, setStatus] = useState("");
  const [selectedWireId, setSelectedWireId] = useState<number | null>(null);
  const [route, setRoute] = useState<number[] | null>(null);
  const [net, setNet] = useState<number[] | null>(null);

  const treeText = useMemo(() => {
    if (!project || project.nodes.length === 0) return "";
    const rootId = project.project.main_connector_instance_id
      ? project.connector_instances.find((c) => c.id === project.project.main_connector_instance_id)?.node_id
      : undefined;
    return buildTreeText(project.nodes, project.segments, rootId ?? project.nodes[0].id);
  }, [project]);

  async function loadDemo() {
    cancelProjectEdits();
    const data = await invoke<ProjectData>("demo_project");
    loadProject(data);
    setRoute(null);
    setNet(null);
    setFilePath("");
    setStatus("Sample project loaded (not saved to disk yet).");
  }

  async function newProject() {
    cancelProjectEdits();
    loadProject(await invoke<ProjectData>("new_project"));
    setFilePath("");
    setRoute(null);
    setNet(null);
    setStatus("New project: name and code in the Inspector (click the project in the tree).");
  }

  async function openProject() {
    const path = await pickFileToOpen("project");
    if (!path) return;
    cancelProjectEdits();
    try {
      const data = await invoke<ProjectData>("open_project", { path });
      loadProject(data);
      setFilePath(path);
      setRoute(null);
      setNet(null);
      setStatus(`Opened ${fileName(path)}`);
    } catch (err) {
      setStatus(`Error opening file: ${err}`);
    }
  }

  // Guardar: al archivo abierto; si todavía no tiene (o es "Save as"), pregunta dónde.
  async function saveProject(saveAs: boolean) {
    if (!project) return;
    let path: string | null = filePath;
    if (saveAs || !isChosenPath(filePath)) {
      path = await pickFileToSave("project", `${project.project.harness_code || "project"}.harness.db`);
      if (!path) return;
    }
    try {
      await flushProjectEdits();
      await invoke("save_project", { path });
      setFilePath(path);
      setStatus(`Saved ${fileName(path)}`);
    } catch (err) {
      setStatus(`Error saving file: ${err}`);
    }
  }

  function updateNode(id: number, patch: Partial<Node>) {
    if (!project) return;
    setProject({
      ...project,
      nodes: project.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    });
  }

  function addNode() {
    if (!project) return;
    const id = nextId(project.nodes.map((n) => n.id));
    setProject({ ...project, nodes: [...project.nodes, { id, kind: "connector_end", termination: null, termination_library_part_id: null, diagram_x: null, diagram_y: null }] });
  }

  function removeNode(id: number) {
    if (!project) return;
    setProject({
      ...project,
      nodes: project.nodes.filter((n) => n.id !== id),
      segments: project.segments.filter((s) => s.node_a_id !== id && s.node_b_id !== id),
    });
  }

  function updateSegment(id: number, patch: Partial<Segment>) {
    if (!project) return;
    setProject({
      ...project,
      segments: project.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  }

  // El segmento nuevo cuelga un nodo suelto (sin segmentos) del conector
  // principal; si no hay ninguno suelto, crea uno. Nunca arma un lazo: después
  // se elige en "From" el nodo del que cuelga de verdad.
  function addSegment() {
    if (!project || project.nodes.length === 0) return;
    const connected = new Set(project.segments.flatMap((s) => [s.node_a_id, s.node_b_id]));
    const mainNode = project.connector_instances.find((c) => c.id === project.project.main_connector_instance_id)?.node_id;
    const free = [...project.nodes].reverse().find((n) => !connected.has(n.id) && n.id !== mainNode && n.id !== project.nodes[0].id);
    const nodes = free ? project.nodes : [...project.nodes, { id: nextId(project.nodes.map((n) => n.id)), kind: "connector_end" as const, termination: null, termination_library_part_id: null, diagram_x: null, diagram_y: null }];
    const to = free ?? nodes[nodes.length - 1];
    const from = mainNode ?? project.nodes[0].id;
    const id = nextId(project.segments.map((s) => s.id));
    setProject({
      ...project,
      nodes,
      segments: [...project.segments, { id, node_a_id: from, node_b_id: to.id, length_mm: 100, twist_pitch_mm: null, covering_library_part_id: null }],
    });
  }

  function removeSegment(id: number) {
    if (!project) return;
    setProject({ ...project, segments: project.segments.filter((s) => s.id !== id) });
  }

  async function queryWire() {
    if (!project || selectedWireId === null) return;
    const [routeResult, netResult] = await Promise.all([
      invoke<number[] | null>("wire_route", { project, wireId: selectedWireId }),
      invoke<number[]>("wire_net", { project, wireId: selectedWireId }),
    ]);
    setRoute(routeResult);
    setNet(netResult);
  }

  return (
    <>
      <section className="toolbar">
        <span className="file-name" title={filePath || undefined}>{filePath ? fileName(filePath) : project ? "Not saved yet" : "No file"}</span>
        <button onClick={() => void newProject()}>New</button>
        <button className="icon-button" onClick={() => void openProject()} title="Open…" aria-label="Open project file">
          <FolderIcon />
        </button>
        <button className="icon-button" onClick={() => void saveProject(false)} disabled={!project} title="Save" aria-label="Save project file">
          <SaveIcon />
        </button>
        <button onClick={() => void saveProject(true)} disabled={!project}>Save as…</button>
        <button onClick={loadDemo}>Load sample</button>
        {status && <span className="status">{status}</span>}
      </section>

      {!project ? (
        <p>Load the sample project or open a file to get started.</p>
      ) : (
        <>
          <section>
            <h3>Nodes</h3>
            <table>
              <thead>
                <tr><th>ID</th><th>Kind</th><th>Termination</th><th>T-mold</th><th></th></tr>
              </thead>
              <tbody>
                {project.nodes.map((node) => (
                  <tr
                    key={node.id}
                    className={`selectable-row${selection?.kind === "node" && selection.id === node.id ? " selected-row" : ""}`}
                    onClick={() => onSelect({ kind: "node", id: node.id })}
                  >
                    <td>{node.id}</td>
                    <td>
                      <select value={node.kind} onChange={(e) => updateNode(node.id, { kind: e.currentTarget.value as Node["kind"] })}>
                        {NODE_KINDS.map((k) => <option key={k} value={k}>{NODE_KIND_LABELS[k]}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        value={node.termination ?? ""}
                        onChange={(e) =>
                          updateNode(node.id, {
                            termination: (e.currentTarget.value || null) as Node["termination"],
                            termination_library_part_id: null,
                          })
                        }
                      >
                        <option value="">—</option>
                        {TERMINATIONS.map((t) => <option key={t} value={t}>{TERMINATION_LABELS[t]}</option>)}
                      </select>
                    </td>
                    <td>
                      {node.termination === "t_mold" && (
                        <select
                          value={node.termination_library_part_id ?? ""}
                          onChange={(e) => updateNode(node.id, { termination_library_part_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
                        >
                          <option value="">—</option>
                          {library.t_mold_defs.map((td) => {
                            const part = library.parts.find((p) => p.id === td.part_id);
                            return <option key={td.part_id} value={td.part_id}>{part?.part_number ?? `#${td.part_id}`}</option>;
                          })}
                        </select>
                      )}
                    </td>
                    <td>
                      <button className="icon-button" onClick={() => removeNode(node.id)} title="Delete" aria-label="Delete node">
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="button-ghost-accent" onClick={addNode}>+ node</button>
          </section>

          <section>
            <h3>Segments</h3>
            <table>
              <thead>
                <tr><th>ID</th><th>From</th><th>To</th><th>Length (mm)</th><th>Twist pitch (mm)</th><th>Covering</th><th></th></tr>
              </thead>
              <tbody>
                {project.segments.map((segment) => (
                  <tr
                    key={segment.id}
                    className={`selectable-row${selection?.kind === "segment" && selection.id === segment.id ? " selected-row" : ""}`}
                    onClick={() => onSelect({ kind: "segment", id: segment.id })}
                  >
                    <td>{segment.id}</td>
                    <td>
                      <select value={segment.node_a_id} onChange={(e) => updateSegment(segment.id, { node_a_id: Number(e.currentTarget.value) })}>
                        {project.nodes.map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={segment.node_b_id} onChange={(e) => updateSegment(segment.id, { node_b_id: Number(e.currentTarget.value) })}>
                        {project.nodes.map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        value={segment.length_mm}
                        onChange={(e) => updateSegment(segment.id, { length_mm: Number(e.currentTarget.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={segment.twist_pitch_mm ?? ""}
                        placeholder="(project default)"
                        onChange={(e) => updateSegment(segment.id, { twist_pitch_mm: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}
                      />
                    </td>
                    <td>
                      <select
                        value={segment.covering_library_part_id ?? ""}
                        onChange={(e) => updateSegment(segment.id, { covering_library_part_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
                      >
                        <option value="">—</option>
                        {library.covering_defs.map((cd) => {
                          const part = library.parts.find((p) => p.id === cd.part_id);
                          return <option key={cd.part_id} value={cd.part_id}>{part?.part_number ?? `#${cd.part_id}`}</option>;
                        })}
                      </select>
                    </td>
                    <td>
                      <button className="icon-button" onClick={() => removeSegment(segment.id)} title="Delete" aria-label="Delete segment">
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="button-ghost-accent" onClick={addSegment} disabled={project.nodes.length === 0}>+ segment</button>
          </section>

          <section>
            <h3>Tree</h3>
            <pre className="tree">{treeText}</pre>
          </section>

          <section>
            <h3>Wire lookup (route and net)</h3>
            <div className="toolbar">
              <select value={selectedWireId ?? ""} onChange={(e) => setSelectedWireId(e.currentTarget.value ? Number(e.currentTarget.value) : null)}>
                <option value="">choose a wire…</option>
                {project.wire_instances.map((w) => (
                  <option key={w.id} value={w.id}>{w.short_id}{w.specific_name ? ` · ${w.specific_name}` : ""}</option>
                ))}
              </select>
              <button onClick={queryWire} disabled={selectedWireId === null}>Look up</button>
            </div>
            {route !== undefined && selectedWireId !== null && (
              <div className="query-result">
                <p>
                  <strong>Route:</strong>{" "}
                  {route === null
                    ? "no resolvable physical location at one of its ends"
                    : route.length === 0
                      ? "same node at both ends (zero length)"
                      : route
                          .map((segId) => {
                            const seg = project.segments.find((s) => s.id === segId);
                            return seg ? `S${segId} (${seg.length_mm}mm)` : `S${segId}`;
                          })
                          .join(" → ")}
                </p>
                <p>
                  <strong>Net:</strong>{" "}
                  {net?.map((wireId) => project.wire_instances.find((w) => w.id === wireId)?.short_id ?? `#${wireId}`).join(", ")}
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
