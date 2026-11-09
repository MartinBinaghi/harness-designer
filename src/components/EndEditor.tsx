import type { ProjectData, WireEnd } from "../model/project";
import { BLANK_END, cavityOptions, componentOptions, groundOptions, spliceOptions } from "../logic/projectEdit";
import { nodeLabel } from "../logic/nodeLabels";

/** Extremo de un cable elegido de listas: tipo (vía, splice, masa, componente, suelto en un nodo) y cuál. */
export function EndEditor({ end, project, onChange }: { end: WireEnd; project: ProjectData; onChange: (e: WireEnd) => void }) {
  function setKind(kind: WireEnd["kind"]) {
    onChange({ ...BLANK_END, kind });
  }

  return (
    <span style={{ display: "flex", flexDirection: "column", width: "100%", gap: "2px" }}>
      <select value={end.kind} onChange={(e) => setKind(e.currentTarget.value as WireEnd["kind"])}>
        <option value="cavity">cavity</option>
        <option value="splice">splice</option>
        <option value="ground">ground</option>
        <option value="component">component</option>
        <option value="loose">loose at a node</option>
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
      {end.kind === "loose" && (
        <select value={end.node_id ?? ""} onChange={(e) => onChange({ ...end, node_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
          <option value="">—</option>
          {project.nodes.map((n) => <option key={n.id} value={n.id}>{nodeLabel(project, n)}</option>)}
        </select>
      )}
    </span>
  );
}
