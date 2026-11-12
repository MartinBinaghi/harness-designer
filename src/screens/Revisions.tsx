import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import type { ProjectData } from "../model/project";
import type { Library } from "../model/library";
import { compareProjects, type ChangeKind } from "../logic/revisionDiff";
import { fileName, isChosenPath, pickFileToOpen, pickFileToSave } from "../platform/fileDialogs";

/** Espejo de revisions::RevisionInfo (src-tauri). */
interface RevisionInfo {
  id: number;
  label: string;
  frozen_at_ms: number;
  notes: string;
  size_bytes: number;
}

/** Un lado de la comparación: el arnés abierto (con lo que no se guardó), una revisión o otro archivo. */
type Side = { kind: "current" } | { kind: "revision"; id: number } | { kind: "file"; path: string };

const sideKey = (s: Side) => (s.kind === "current" ? "current" : s.kind === "revision" ? `r${s.id}` : `f${s.path}`);

const KIND_LABELS: Record<ChangeKind, string> = { added: "added", removed: "removed", changed: "changed" };

/** La que sigue a la última: B después de A, 3 después de 2; sin ninguna, la del arnés o A. */
function nextLabel(revisions: RevisionInfo[], current: string | null): string {
  const last = revisions[revisions.length - 1]?.label;
  if (!last) return current?.trim() || "A";
  if (/^[A-Y]$/.test(last)) return String.fromCharCode(last.charCodeAt(0) + 1);
  if (/^\d+$/.test(last)) return String(Number(last) + 1);
  return "";
}

/**
 * Revisiones del arnés (plan 4.2, Revision): congelar el estado actual como
 * Rev A, B…, con notas, y ver qué cambió entre dos estados (una revisión, el
 * arnés abierto u otro archivo). Las revisiones viven dentro del archivo del
 * arnés (`revisions.rs`); la comparación, en `logic/revisionDiff.ts`.
 */
export default function Revisions({ project, library, filePath, unsaved, flushProjectEdits, onFrozen }: {
  project: ProjectData;
  library: Library;
  filePath: string;
  unsaved: boolean;
  flushProjectEdits: () => Promise<void>;
  /** El proyecto después de congelar (su campo "revisión" cambió y quedó guardado). */
  onFrozen: (project: ProjectData) => void;
}) {
  const hasFile = isChosenPath(filePath);
  const [revisions, setRevisions] = useState<RevisionInfo[]>([]);
  const [status, setStatus] = useState("");
  const reload = useCallback(async () => {
    try {
      setRevisions(await invoke<RevisionInfo[]>("list_revisions"));
    } catch (err) {
      setStatus(`Couldn't read the revisions: ${err}`);
    }
  }, []);
  useEffect(() => void reload(), [reload, filePath]);

  const [label, setLabel] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const shownLabel = label ?? nextLabel(revisions, project.project.revision);
  const taken = revisions.some((r) => r.label === shownLabel.trim());

  async function freeze() {
    const name = shownLabel.trim();
    try {
      await flushProjectEdits();
      const next = await invoke<ProjectData>("freeze_revision", { label: name, notes });
      onFrozen(next);
      setLabel(null);
      setNotes("");
      await reload();
      setStatus(`Revision ${name} frozen${unsaved ? " (the harness was saved first)" : ""}.`);
    } catch (err) {
      setStatus(`Couldn't freeze the revision: ${err}`);
    }
  }

  async function exportRevision(r: RevisionInfo) {
    const path = await pickFileToSave("project", `${project.project.harness_code || "harness"} rev ${r.label}.harness.db`);
    if (!path) return;
    try {
      await invoke("export_revision", { id: r.id, path });
      setStatus(`Revision ${r.label} saved as ${fileName(path)}.`);
    } catch (err) {
      setStatus(`Couldn't export the revision: ${err}`);
    }
  }

  async function deleteRevision(r: RevisionInfo) {
    const sure = await ask(`Delete revision ${r.label}? Its copy is removed from the harness file and can't be recovered.`, { title: "Harness Designer", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" });
    if (!sure) return;
    try {
      await invoke("delete_revision", { id: r.id });
      await reload();
      setStatus(`Revision ${r.label} deleted.`);
    } catch (err) {
      setStatus(`Couldn't delete the revision: ${err}`);
    }
  }

  // --- Comparar ---
  const [from, setFrom] = useState<Side | null>(null);
  const [to, setTo] = useState<Side>({ kind: "current" });
  const latest = revisions[revisions.length - 1];
  const fromSide: Side | null = from ?? (latest ? { kind: "revision", id: latest.id } : null);
  // Lo ya leído de cada revisión u otro archivo (las revisiones no cambian).
  const [loaded, setLoaded] = useState<Map<string, ProjectData>>(new Map());
  const [loadError, setLoadError] = useState("");
  const reading = useRef(new Set<string>());
  useEffect(() => {
    for (const side of [fromSide, to]) {
      if (!side || side.kind === "current") continue;
      const key = sideKey(side);
      if (loaded.has(key) || reading.current.has(key)) continue;
      reading.current.add(key);
      const request = side.kind === "revision" ? invoke<ProjectData>("revision_project", { id: side.id }) : invoke<ProjectData>("read_other_project", { path: side.path });
      request
        .then(
          (data) => setLoaded((m) => new Map(m).set(key, data)),
          (err) => setLoadError(`Couldn't read ${describe(side)}: ${err}`),
        )
        .finally(() => reading.current.delete(key));
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Otro archivo del proyecto: las revisiones de antes no son de este.
  useEffect(() => {
    setFrom(null);
    setTo({ kind: "current" });
    setLoaded(new Map());
    setLoadError("");
  }, [filePath]);

  const dataOf = (side: Side | null) => (!side ? undefined : side.kind === "current" ? project : loaded.get(sideKey(side)));
  const before = dataOf(fromSide);
  const after = dataOf(to);
  const diff = useMemo(() => (before && after ? compareProjects(before, after, library) : null), [before, after, library]);
  const total = diff?.reduce((n, s) => n + s.items.length, 0) ?? 0;

  function describe(side: Side): string {
    if (side.kind === "current") return unsaved ? "the open harness (with unsaved changes)" : "the open harness";
    if (side.kind === "revision") return `revision ${revisions.find((r) => r.id === side.id)?.label ?? "?"}`;
    return fileName(side.path);
  }

  // Los archivos elegidos quedan en la lista para volver a elegirlos.
  const [files, setFiles] = useState<string[]>([]);
  async function choose(value: string, set: (side: Side) => void) {
    if (value === "file") {
      const path = await pickFileToOpen("project");
      if (!path) return;
      setFiles((f) => (f.includes(path) ? f : [...f, path]));
      setLoaded((m) => {
        const next = new Map(m);
        next.delete(`f${path}`); // releerlo: el archivo puede haber cambiado
        return next;
      });
      setLoadError("");
      set({ kind: "file", path });
      return;
    }
    setLoadError("");
    if (value === "current") set({ kind: "current" });
    else if (value.startsWith("r")) set({ kind: "revision", id: Number(value.slice(1)) });
    else set({ kind: "file", path: value.slice(1) });
  }
  const sideOptions = (
    <>
      <option value="current">Open harness (now)</option>
      {revisions.map((r) => (
        <option key={r.id} value={`r${r.id}`}>Revision {r.label} · {new Date(r.frozen_at_ms).toLocaleDateString()}</option>
      ))}
      {files.map((f) => (
        <option key={f} value={`f${f}`}>{fileName(f)}</option>
      ))}
      <option value="file">Another file…</option>
    </>
  );

  return (
    <>
      <section className="toolbar">
        <span className="file-name" title={filePath || undefined}>{hasFile ? fileName(filePath) : "Not saved yet"}</span>
        {status && <span className="status">{status}</span>}
      </section>

      <section>
        <h3>Freeze a revision</h3>
        {!hasFile ? (
          <p className="hint">Save the harness to a file first (Topology → Save): its revisions are kept inside it.</p>
        ) : (
          <div className="rv-freeze">
            <label>
              <span className="field-label">Revision</span>
              <input value={shownLabel} onChange={(e) => setLabel(e.currentTarget.value)} size={6} aria-invalid={taken} />
            </label>
            <label className="rv-notes">
              <span className="field-label">What changed (optional)</span>
              <input value={notes} onChange={(e) => setNotes(e.currentTarget.value)} placeholder="e.g. X3 pinout from the client, new lambda wire" />
            </label>
            <button className="button-primary" disabled={!shownLabel.trim() || taken} onClick={() => void freeze()}>
              {unsaved ? "Save and freeze" : "Freeze"} {shownLabel.trim() || "revision"}
            </button>
            <p className="hint">
              {taken
                ? `There's already a revision ${shownLabel.trim()}: choose another name.`
                : "Keeps a copy of the harness as it is now, with today's date, inside its file. The harness's revision becomes this one."}
            </p>
          </div>
        )}
      </section>

      {revisions.length > 0 && (
        <section>
          <h3>Revisions in this file ({revisions.length})</h3>
          <table className="rv-list">
            <thead>
              <tr><th>Revision</th><th>Frozen</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {[...revisions].reverse().map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.label}</strong></td>
                  <td>{new Date(r.frozen_at_ms).toLocaleString()}</td>
                  <td>{r.notes || "—"}</td>
                  <td className="rv-actions">
                    <button onClick={() => { setFrom({ kind: "revision", id: r.id }); setTo({ kind: "current" }); setLoadError(""); }}>Compare with now</button>
                    <button onClick={() => void exportRevision(r)} title="Save this revision as a harness file of its own (to send it)">Export…</button>
                    <button onClick={() => void deleteRevision(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h3>Compare</h3>
        <div className="rv-compare">
          <label>
            <span className="field-label">From (before)</span>
            <select value={fromSide ? sideKey(fromSide) : ""} onChange={(e) => void choose(e.currentTarget.value, setFrom)}>
              {!fromSide && <option value="">Choose…</option>}
              {sideOptions}
            </select>
          </label>
          <span className="rv-arrow">→</span>
          <label>
            <span className="field-label">To (after)</span>
            <select value={sideKey(to)} onChange={(e) => void choose(e.currentTarget.value, setTo)}>
              {sideOptions}
            </select>
          </label>
        </div>
        <p className="hint">Connectors, wires, splices and grounds are matched by their ID (X3, W012, SP4); parts and signal types are named with the open library. Positions in the drawings don't count.</p>

        {loadError && <p className="rv-error">{loadError}</p>}
        {!fromSide && <p className="hint">Freeze a revision, or choose another harness file, to see what changed.</p>}
        {fromSide && !loadError && !diff && <p className="hint">Reading…</p>}
        {diff && (
          <>
            <p className="rv-summary">
              {total === 0 ? (
                <>No differences between {describe(fromSide!)} and {describe(to)}.</>
              ) : (
                <>
                  <strong>{total} change{total === 1 ? "" : "s"}</strong> from {describe(fromSide!)} to {describe(to)}:{" "}
                  {diff.map((s) => `${s.items.length} in ${s.title.toLowerCase()}`).join(" · ")}
                </>
              )}
            </p>
            {diff.map((s) => (
              <div key={s.title} className="rv-section">
                <h4>{s.title} ({s.items.length})</h4>
                <ul className="rv-items">
                  {s.items.map((item, i) => (
                    <li key={i} className={`rv-item rv-${item.kind}`}>
                      <div className="rv-item-head">
                        <span className="rv-badge">{KIND_LABELS[item.kind]}</span> {item.label}
                      </div>
                      {item.changes.length > 0 && (
                        <table className="rv-changes">
                          <tbody>
                            {item.changes.map((c, j) => (
                              <tr key={j}>
                                <td className="rv-field">{c.field}</td>
                                <td className="rv-before">{c.before}</td>
                                <td className="rv-to">→</td>
                                <td className="rv-after">{c.after}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>
    </>
  );
}
