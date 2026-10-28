import { useState } from "react";
import { HelpIcon } from "../components/icons";
import type { Finding, ProjectData, Selection } from "../model/project";

interface Props {
  project: ProjectData | null;
  findings: Finding[];
  selection: Selection;
  onSelect: (s: Selection) => void;
}

function isSelected(selection: Selection, target: Finding["target"]): boolean {
  return !!target && !!selection && selection.kind === target.kind && selection.id === target.id;
}

export default function Checks({ project, findings, selection, onSelect }: Props) {
  const [showHelp, setShowHelp] = useState(false);

  if (!project) {
    return <p>Open or load a project first (Topology tab).</p>;
  }

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  function renderFinding(f: Finding, i: number, severityClass: string) {
    const clickable = f.target !== null;
    return (
      <li
        key={i}
        className={`finding ${severityClass}${clickable ? ` selectable-row${isSelected(selection, f.target) ? " selected-row" : ""}` : ""}`}
        onClick={clickable ? () => onSelect(f.target) : undefined}
      >
        {f.message}
      </li>
    );
  }

  // Un grupo por verificación ("Pending connectors (29)"), desplegable: los
  // errores abiertos, las advertencias cerradas, para ver primero lo grave.
  function renderGroups(list: Finding[], severityClass: string, open: boolean) {
    const groups = new Map<string, Finding[]>();
    for (const f of list) groups.set(f.group || f.message, [...(groups.get(f.group || f.message) ?? []), f]);
    return [...groups].map(([title, items]) => (
      <details key={title} className="findings-group" open={open || items.some((f) => isSelected(selection, f.target))}>
        <summary>
          {title} <span className="findings-count">{items.length}</span>
        </summary>
        <ul className="findings">{items.map((f, i) => renderFinding(f, i, severityClass))}</ul>
      </details>
    ));
  }

  return (
    <>
      <p className="status" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
        {errors.length} error{errors.length === 1 ? "" : "s"}, {warnings.length} warning{warnings.length === 1 ? "" : "s"}
        <button
          className="icon-button"
          title="How highlighting works"
          aria-label="How highlighting works"
          aria-expanded={showHelp}
          onClick={() => setShowHelp(!showHelp)}
        >
          <HelpIcon />
        </button>
      </p>
      {showHelp && (
        <p className="hint">
          Clicking a finding selects the element it refers to (a connector, wire, segment…). Every finding about
          that same element is highlighted, not just the one you clicked — e.g. several findings on X4 light up
          together. Findings that involve a list of wires (like a net with mismatched names) aren't clickable.
        </p>
      )}

      {findings.length === 0 && <p className="hint">No issues found.</p>}

      {errors.length > 0 && (
        <section>
          <h3>Errors</h3>
          {renderGroups(errors, "finding-error", true)}
        </section>
      )}

      {warnings.length > 0 && (
        <section>
          <h3>Warnings</h3>
          {renderGroups(warnings, "finding-warning", false)}
        </section>
      )}
    </>
  );
}
