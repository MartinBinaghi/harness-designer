import type { ReactNode } from "react";
import type { ProjectData, Selection } from "./types";
import type { Library } from "./libraryTypes";
import { endLabel } from "./Cables";

function partNumber(library: Library, partId: number | null | undefined): string {
  if (partId == null) return "—";
  return library.parts.find((p) => p.id === partId)?.part_number ?? `#${partId}`;
}

/** Nodo y conector comparten "adhesive_heatshrink"/"none"; el conector suma los boots. */
const TERMINATION_LABELS: Record<string, string> = {
  t_mold: "T-mold",
  adhesive_heatshrink: "Adhesive heat-shrink",
  boot_straight: "Straight boot",
  boot_90: "90° boot",
  none: "None",
};
function terminationLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return TERMINATION_LABELS[value] ?? value;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inspector-field">
      <div className="field-label">{label}</div>
      <div className="inspector-field-value">{children}</div>
    </div>
  );
}

interface Props {
  project: ProjectData | null;
  library: Library;
  selection: Selection;
}

export default function Inspector({ project, library, selection }: Props) {
  if (!project || !selection) {
    return (
      <div className="inspector-panel">
        <div className="tree-panel-title">Inspector</div>
        <p className="hint">Select a row in a table, or an item in the tree, to see its detail here.</p>
      </div>
    );
  }

  let title = "";
  let fields: ReactNode = null;

  if (selection.kind === "node") {
    const node = project.nodes.find((n) => n.id === selection.id);
    if (node) {
      title = `Node ${node.id}`;
      fields = (
        <>
          <Field label="Kind">{node.kind}</Field>
          <Field label="Termination">{terminationLabel(node.termination)}</Field>
          {node.termination_library_part_id != null && <Field label="Part">{partNumber(library, node.termination_library_part_id)}</Field>}
        </>
      );
    }
  } else if (selection.kind === "segment") {
    const seg = project.segments.find((s) => s.id === selection.id);
    if (seg) {
      title = `Segment S${seg.id}`;
      fields = (
        <>
          <Field label="From">node {seg.node_a_id}</Field>
          <Field label="To">node {seg.node_b_id}</Field>
          <Field label="Length">{seg.length_mm} mm</Field>
          <Field label="Twist pitch">{seg.twist_pitch_mm ?? "(project default)"}</Field>
          <Field label="Covering">{partNumber(library, seg.covering_library_part_id)}</Field>
        </>
      );
    }
  } else if (selection.kind === "connector") {
    const c = project.connector_instances.find((x) => x.id === selection.id);
    if (c) {
      title = c.short_id;
      const device = c.device_instance_id != null ? project.device_instances.find((d) => d.id === c.device_instance_id) : null;
      fields = (
        <>
          <Field label="Name">{c.name || "—"}</Field>
          <Field label="Part">{partNumber(library, c.library_part_id)}</Field>
          <Field label="Node">node {c.node_id}</Field>
          {device && <Field label="Device">{device.name}</Field>}
          <Field label="Termination">{terminationLabel(c.termination)}</Field>
          <Field label="Status">{c.status}</Field>
          {c.is_interconnect && <Field label="Mates with">{c.mates_with ?? "—"}</Field>}
        </>
      );
    }
  } else if (selection.kind === "ground") {
    const g = project.ground_points.find((x) => x.id === selection.id);
    if (g) {
      title = g.short_id;
      fields = (
        <>
          <Field label="Name">{g.name || "—"}</Field>
          <Field label="Node">node {g.node_id}</Field>
          <Field label="Terminal">{partNumber(library, g.terminal_library_part_id)}</Field>
        </>
      );
    }
  } else if (selection.kind === "splice") {
    const s = project.splice_instances.find((x) => x.id === selection.id);
    if (s) {
      title = s.short_id;
      fields = (
        <>
          <Field label="Part">{partNumber(library, s.library_part_id)}</Field>
          {s.node_id != null && <Field label="Node">node {s.node_id}</Field>}
          {s.segment_id != null && (
            <Field label="On segment">
              S{s.segment_id} · {s.offset_from_end_mm}mm from node {s.offset_from_node_id}
            </Field>
          )}
        </>
      );
    }
  } else if (selection.kind === "wire") {
    const w = project.wire_instances.find((x) => x.id === selection.id);
    if (w) {
      title = w.short_id;
      const wireDef = library.wire_defs.find((wd) => wd.part_id === w.library_part_id);
      fields = (
        <>
          <Field label="From">{endLabel(project, w.end_a)}</Field>
          <Field label="To">{endLabel(project, w.end_b)}</Field>
          <Field label="Wire">{wireDef ? `${wireDef.gauge}${wireDef.spec ? ` · ${wireDef.spec}` : ""}` : partNumber(library, w.library_part_id)}</Field>
          <Field label="Color">{w.color ?? "—"}</Field>
          <Field label="Name">{w.specific_name ?? "—"}</Field>
          <Field label="Cut margin">{w.manual_cut_margin_pct != null ? `${w.manual_cut_margin_pct}%` : "(default)"}</Field>
        </>
      );
    }
  }

  if (!title) {
    return (
      <div className="inspector-panel">
        <div className="tree-panel-title">Inspector</div>
        <p className="hint">Selected item no longer exists.</p>
      </div>
    );
  }

  return (
    <div className="inspector-panel">
      <div className="inspector-header">{title}</div>
      <div className="inspector-body">{fields}</div>
    </div>
  );
}
