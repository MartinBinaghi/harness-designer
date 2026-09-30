import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectData } from "./types";
import type { Library } from "./libraryTypes";

interface Finding {
  severity: "error" | "warning";
  message: string;
}

interface Props {
  project: ProjectData | null;
  library: Library;
}

export default function Checks({ project, library }: Props) {
  const [findings, setFindings] = useState<Finding[] | null>(null);

  if (!project) {
    return <p>Open or load a project first (Topology tab).</p>;
  }

  async function run() {
    const result = await invoke<Finding[]>("run_checks", { project, library });
    setFindings(result);
  }

  const errors = findings?.filter((f) => f.severity === "error") ?? [];
  const warnings = findings?.filter((f) => f.severity === "warning") ?? [];

  return (
    <>
      <h2>Checks</h2>
      <div className="toolbar">
        <button onClick={run}>Run checks</button>
        {findings && (
          <span className="status">
            {errors.length} error{errors.length === 1 ? "" : "s"}, {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {findings && findings.length === 0 && <p className="hint">No issues found.</p>}

      {errors.length > 0 && (
        <section>
          <h3>Errors</h3>
          <ul className="findings">
            {errors.map((f, i) => (
              <li key={i} className="finding finding-error">{f.message}</li>
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section>
          <h3>Warnings</h3>
          <ul className="findings">
            {warnings.map((f, i) => (
              <li key={i} className="finding finding-warning">{f.message}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
