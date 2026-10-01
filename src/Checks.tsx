import type { Finding, ProjectData } from "./types";

interface Props {
  project: ProjectData | null;
  findings: Finding[];
}

export default function Checks({ project, findings }: Props) {
  if (!project) {
    return <p>Open or load a project first (Topology tab).</p>;
  }

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  return (
    <>
      <p className="status">
        {errors.length} error{errors.length === 1 ? "" : "s"}, {warnings.length} warning{warnings.length === 1 ? "" : "s"}
      </p>

      {findings.length === 0 && <p className="hint">No issues found.</p>}

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
