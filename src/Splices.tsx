import { useState } from "react";
import type { ProjectData, Selection } from "./types";
import { partLabel, type Library } from "./libraryTypes";
import { TrashIcon } from "./icons";
import { addJunction, deleteJunction, wiresAtJunction, type JunctionKind } from "./projectEdit";
import { NODE_KIND_LABELS } from "./Topologia";

/**
 * Splices, masas y componentes (plan 7.3): donde se unen o terminan cables
 * fuera de un conector. Acá se crean, se ven sus cables y se borran; el resto
 * (parte, ubicación, nombre) se edita en el Inspector. Los cables se les
 * conectan desde el pinout de Conectores ("Goes to": SP1, G1, R1).
 */

const KINDS: [JunctionKind, string, string][] = [
  ["splice", "Splices", "splice"],
  ["ground", "Grounds", "ground"],
  ["component", "Components", "component"],
];

interface Place {
  node_id: number | null;
  segment_id?: number | null;
  offset_from_end_mm?: number | null;
  offset_from_node_id?: number | null;
}

function where(project: ProjectData, item: Place): string {
  if (item.segment_id != null) return `S${item.segment_id} · ${item.offset_from_end_mm ?? 0} mm from node ${item.offset_from_node_id}`;
  const node = project.nodes.find((n) => n.id === item.node_id);
  return node ? `node ${node.id} · ${NODE_KIND_LABELS[node.kind]}` : "—";
}

interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData) => void;
  library: Library;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export default function Splices({ project, setProject, library, selection, onSelect }: Props) {
  const [notice, setNotice] = useState("");
  if (!project) return <p>Open or load a project first (Topology tab).</p>;

  function add(kind: JunctionKind) {
    const result = addJunction(project!, library, kind);
    if (typeof result === "string") return setNotice(result);
    setNotice("");
    setProject(result.project);
    onSelect({ kind, id: result.id });
  }

  const rows = {
    splice: project.splice_instances.map((s) => ({ id: s.id, shortId: s.short_id, name: s.name, part: partLabel(library, s.library_part_id), where: where(project, s) })),
    ground: project.ground_points.map((g) => ({ id: g.id, shortId: g.short_id, name: g.name, part: partLabel(library, g.terminal_library_part_id), where: where(project, g) })),
    component: project.component_instances.map((c) => ({ id: c.id, shortId: c.short_id, name: c.name, part: partLabel(library, c.library_part_id), where: where(project, c) })),
  };

  return (
    <>
      <p className="hint">Click a row to edit it in the Inspector. Wires reach them from a connector's pinout (Goes to: SP1, G1, R1) or from Wires.</p>
      {notice && <p className="diagram-notice">{notice}</p>}
      {KINDS.map(([kind, title, noun]) => (
        <section key={kind}>
          <h3>{title}</h3>
          {rows[kind].length > 0 && (
            <table>
              <thead>
                <tr><th>ID</th><th>Name</th><th>{kind === "ground" ? "Terminal" : "Part"}</th><th>Location</th><th>Wires</th><th /></tr>
              </thead>
              <tbody>
                {rows[kind].map((r) => {
                  const wires = wiresAtJunction(project, kind, r.id);
                  return (
                    <tr
                      key={r.id}
                      className={`selectable-row${selection?.kind === kind && selection.id === r.id ? " selected-row" : ""}`}
                      onClick={() => onSelect({ kind, id: r.id })}
                    >
                      <td><strong>{r.shortId}</strong></td>
                      <td>{r.name}</td>
                      <td>{r.part}</td>
                      <td>{r.where}</td>
                      <td>{wires.map((w) => w.short_id).join(", ") || <span className="hint">none</span>}</td>
                      <td>
                        <button
                          className="icon-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setProject(deleteJunction(project, kind, r.id));
                          }}
                          title={`Delete ${noun} (its wires keep going, with that end empty)`}
                          aria-label={`Delete ${noun}`}
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <button className="button-ghost-accent" onClick={() => add(kind)}>+ New {noun}</button>
        </section>
      ))}
    </>
  );
}
