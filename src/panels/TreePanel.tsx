import type { ProjectData, Selection } from "../model/project";
import { buildTreeEntries } from "../logic/tree";
import { infoFor } from "../logic/nodeLabels";

function isSelected(selection: Selection, target: Selection): boolean {
  return !!selection && !!target && selection.kind === target.kind && selection.id === target.id;
}

interface Props {
  project: ProjectData | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export default function Tree({ project, selection, onSelect }: Props) {
  if (!project) {
    return (
      <div className="tree-panel">
        <div className="tree-panel-title">Tree</div>
        <p className="hint">No project loaded.</p>
      </div>
    );
  }

  const rootId = project.project.main_connector_instance_id
    ? project.connector_instances.find((c) => c.id === project.project.main_connector_instance_id)?.node_id
    : undefined;
  const entries = project.nodes.length > 0 ? buildTreeEntries(project.nodes, project.segments, rootId ?? project.nodes[0].id) : [];

  return (
    <div className="tree-panel">
      <div className="tree-panel-title">Tree</div>
      <button
        className={`tree-row tree-root${selection?.kind === "project" ? " tree-row-selected" : ""}`}
        onClick={() => onSelect({ kind: "project", id: 0 })}
        title="Harness name, code, margins and costs"
      >
        {project.project.name}{project.project.harness_code && ` · ${project.project.harness_code}`}
      </button>
      <div>
        {entries.map(({ nodeId, depth, lengthMm }) => {
          const info = infoFor(project, nodeId);
          const selected = isSelected(selection, info.select);
          return (
            <button
              key={nodeId}
              className={`tree-row${selected ? " tree-row-selected" : ""}`}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
              onClick={() => onSelect(info.select)}
            >
              <span className={`tree-dot ${info.dotClass}`} />
              <span className="tree-label">{info.label}</span>
              {lengthMm !== undefined && <span className="tree-length">{lengthMm}mm</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
