import { useState } from "react";
import type { ProjectData, Selection, WireEnd, WireInstance } from "./types";
import type { Library } from "./libraryTypes";
import { TrashIcon } from "./icons";
import { nextId } from "./projectEdit";


function partLabel(library: Library, partId: number | null): string {
  if (partId === null) return "—";
  const part = library.parts.find((p) => p.id === partId);
  return part ? part.part_number || `#${partId}` : `#${partId} (not in library)`;
}

function cavityOptions(project: ProjectData): { value: number; label: string }[] {
  return project.connector_instances.flatMap((c) => c.cavities.map((cav) => ({ value: cav.id, label: `${c.short_id}:${cav.cavity_id}` })));
}
function spliceOptions(project: ProjectData): { value: number; label: string }[] {
  return project.splice_instances.map((s) => ({ value: s.id, label: s.short_id }));
}
function groundOptions(project: ProjectData): { value: number; label: string }[] {
  return project.ground_points.map((g) => ({ value: g.id, label: g.short_id }));
}
function componentOptions(project: ProjectData): { value: number; label: string }[] {
  return project.component_instances.map((c) => ({ value: c.id, label: c.short_id }));
}

/** A cavity end's parent connector, if any — used by the connector filter. */
function cavityConnectorShortId(project: ProjectData, cavityAssignmentId: number | null): string | null {
  if (cavityAssignmentId === null) return null;
  const connector = project.connector_instances.find((c) => c.cavities.some((cav) => cav.id === cavityAssignmentId));
  return connector?.short_id ?? null;
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

function blankEnd(): WireEnd {
  return { kind: "cavity", cavity_assignment_id: null, splice_id: null, ground_point_id: null, component_instance_id: null };
}

function EndEditor({ end, project, onChange }: { end: WireEnd; project: ProjectData; onChange: (e: WireEnd) => void }) {
  function setKind(kind: WireEnd["kind"]) {
    onChange({ kind, cavity_assignment_id: null, splice_id: null, ground_point_id: null, component_instance_id: null });
  }

  return (
    <span style={{ display: "flex", flexDirection: "column", width: "100%", gap: "2px" }}>
      <select value={end.kind} onChange={(e) => setKind(e.currentTarget.value as WireEnd["kind"])}>
        <option value="cavity">cavity</option>
        <option value="splice">splice</option>
        <option value="ground">ground</option>
        <option value="component">component</option>
      </select>
      {end.kind === "cavity" && (
        <select value={end.cavity_assignment_id ?? ""} onChange={(e) => onChange({ ...end, cavity_assignment_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
          <option value="">—</option>
          {cavityOptions(project).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {end.kind === "splice" && (
        <select value={end.splice_id ?? ""} onChange={(e) => onChange({ ...end, splice_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
          <option value="">—</option>
          {spliceOptions(project).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {end.kind === "ground" && (
        <select value={end.ground_point_id ?? ""} onChange={(e) => onChange({ ...end, ground_point_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
          <option value="">—</option>
          {groundOptions(project).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {end.kind === "component" && (
        <select value={end.component_instance_id ?? ""} onChange={(e) => onChange({ ...end, component_instance_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
          <option value="">—</option>
          {componentOptions(project).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </span>
  );
}

function ColorSwatch({ color }: { color: string | null }) {
  return <span className="swatch" style={{ background: color || "transparent" }} title={color ?? "no color set"} />;
}

interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData) => void;
  library: Library;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export default function Cables({ project, setProject, library, selection, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [connectorFilter, setConnectorFilter] = useState("");
  const [gaugeFilter, setGaugeFilter] = useState("");

  if (!project) {
    return <p>Open or load a project first (Topology tab).</p>;
  }

  function update(id: number, patch: Partial<WireInstance>) {
    if (!project) return;
    setProject({ ...project, wire_instances: project.wire_instances.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  }

  function remove(id: number) {
    if (!project) return;
    setProject({ ...project, wire_instances: project.wire_instances.filter((w) => w.id !== id) });
  }

  function add() {
    if (!project) return;
    if (library.wire_defs.length === 0) {
      alert("Add at least one wire in Library → Wires before adding one here.");
      return;
    }
    const id = nextId(project.wire_instances.map((w) => w.id));
    const newWire: WireInstance = {
      id,
      short_id: `W${String(id).padStart(3, "0")}`,
      library_part_id: library.wire_defs[0].part_id,
      color: null,
      signal_type_id: null,
      specific_name: null,
      manual_cut_margin_pct: null,
      label: null,
      end_a: blankEnd(),
      end_b: blankEnd(),
    };
    setProject({ ...project, wire_instances: [...project.wire_instances, newWire] });
  }

  // Elegir la categoría sugiere su color (Library → Color code). Solo pisa el
  // color si estaba vacío o era el sugerido por la categoría anterior: un color
  // elegido a mano se respeta.
  function categoryPatch(wire: WireInstance, signalTypeId: number | null): Partial<WireInstance> {
    const colorOf = (id: number | null) => library.signal_types.find((st) => st.id === id)?.default_color ?? null;
    const previousSuggestion = colorOf(wire.signal_type_id);
    const keepManualColor = wire.color != null && wire.color !== "" && wire.color !== previousSuggestion;
    const suggested = colorOf(signalTypeId);
    return { signal_type_id: signalTypeId, ...(keepManualColor || !suggested ? {} : { color: suggested }) };
  }

  function gaugeOf(wire: WireInstance): string | null {
    return library.wire_defs.find((wd) => wd.part_id === wire.library_part_id)?.gauge ?? null;
  }

  function wireTouchesConnector(wire: WireInstance, shortId: string): boolean {
    return (
      cavityConnectorShortId(project!, wire.end_a.cavity_assignment_id) === shortId ||
      cavityConnectorShortId(project!, wire.end_b.cavity_assignment_id) === shortId
    );
  }

  const gauges = Array.from(new Set(library.wire_defs.map((wd) => wd.gauge))).sort();

  const visibleWires = project.wire_instances.filter((wire) => {
    if (connectorFilter && !wireTouchesConnector(wire, connectorFilter)) return false;
    if (gaugeFilter && gaugeOf(wire) !== gaugeFilter) return false;
    if (search) {
      const haystack = [
        wire.short_id,
        wire.specific_name ?? "",
        wire.color ?? "",
        endLabel(project, wire.end_a),
        endLabel(project, wire.end_b),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <>
      <div className="toolbar">
        <input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search id, name, color, endpoint…" style={{ width: "16em" }} />
        <select value={connectorFilter} onChange={(e) => setConnectorFilter(e.currentTarget.value)}>
          <option value="">All connectors</option>
          {project.connector_instances.map((c) => <option key={c.id} value={c.short_id}>{c.short_id}</option>)}
        </select>
        <select value={gaugeFilter} onChange={(e) => setGaugeFilter(e.currentTarget.value)}>
          <option value="">All gauges</option>
          {gauges.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <span className="status">{visibleWires.length} of {project.wire_instances.length} wires</span>
      </div>

      <table>
        <thead>
          <tr><th>ID</th><th>Type</th><th>Color</th><th>Category</th><th>Name</th><th>From</th><th>To</th><th></th></tr>
        </thead>
        <tbody>
          {visibleWires.map((wire) => (
            <tr
              key={wire.id}
              className={`selectable-row${selection?.kind === "wire" && selection.id === wire.id ? " selected-row" : ""}`}
              onClick={() => onSelect({ kind: "wire", id: wire.id })}
            >
              <td><input value={wire.short_id} onChange={(e) => update(wire.id, { short_id: e.currentTarget.value })} style={{ width: "5em" }} /></td>
              <td>
                <select value={wire.library_part_id} onChange={(e) => update(wire.id, { library_part_id: Number(e.currentTarget.value) })}>
                  {library.wire_defs.map((wd) => <option key={wd.part_id} value={wd.part_id}>{partLabel(library, wd.part_id)}</option>)}
                </select>
              </td>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                  <ColorSwatch color={wire.color} />
                  <input value={wire.color ?? ""} onChange={(e) => update(wire.id, { color: e.currentTarget.value || null })} style={{ width: "5em" }} />
                </span>
              </td>
              <td>
                <select value={wire.signal_type_id ?? ""} onChange={(e) => update(wire.id, categoryPatch(wire, e.currentTarget.value ? Number(e.currentTarget.value) : null))}>
                  <option value="">—</option>
                  {library.signal_types.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </td>
              <td><input value={wire.specific_name ?? ""} onChange={(e) => update(wire.id, { specific_name: e.currentTarget.value || null })} /></td>
              <td><EndEditor end={wire.end_a} project={project} onChange={(end_a) => update(wire.id, { end_a })} /></td>
              <td><EndEditor end={wire.end_b} project={project} onChange={(end_b) => update(wire.id, { end_b })} /></td>
              <td>
                <button className="icon-button" onClick={() => remove(wire.id)} title="Delete wire" aria-label="Delete wire">
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="button-ghost-accent" onClick={add} style={{ marginTop: "0.75rem" }}>+ New</button>
    </>
  );
}
