import { useState } from "react";
import type { ConnectorInstance, ProjectData } from "../model/project";
import type { GaugeFacts } from "../model/calc";
import type { Library } from "../model/library";
import { parsePinout } from "../logic/devicePins";
import { PINOUT_ROLE_LABELS, applyPinoutPaste, guessPinoutRoles, previewPinoutPaste, type PinoutRole } from "../logic/pinoutPaste";

/**
 * Pegar el pinout de un conector (Connectors → Paste pinout…): la tabla de un
 * Excel o un PDF, elegir qué es cada columna, ver qué vía toma cada fila y aplicar.
 * Ver `logic/pinoutPaste.ts`.
 */
export function PasteConnectorPinout({ project, library, gauges, connector, onCancel, onApply }: {
  project: ProjectData;
  library: Library;
  gauges: GaugeFacts | null;
  connector: ConnectorInstance;
  onCancel: () => void;
  onApply: (project: ProjectData, summary: string) => void;
}) {
  const [text, setText] = useState("");
  const [roles, setRoles] = useState<PinoutRole[]>([]);
  const [replace, setReplace] = useState(false);
  const cells = parsePinout(text);
  const guessed = guessPinoutRoles(cells);
  const effective = guessed.map((r, i) => roles[i] ?? r);
  const preview = previewPinoutPaste(project, library, connector, cells, effective);
  const usable = preview.filter((r) => r.cavityId !== null);
  const taken = usable.filter((r) => r.existing > 0).length;
  const applies = replace ? usable.length : usable.length - taken;
  const pinOf = (id: number | null) => connector.cavities.find((c) => c.id === id)?.cavity_id;

  function apply() {
    const result = applyPinoutPaste(project, library, gauges, preview, replace);
    const parts = [`${result.created} new wire${result.created === 1 ? "" : "s"}`, result.changed && `${result.changed} changed`, result.skipped && `${result.skipped} pin${result.skipped === 1 ? "" : "s"} already wired, kept`];
    onApply(result.project, `Pasted into ${connector.short_id}: ${parts.filter(Boolean).join(", ")}.${result.errors.length ? ` ${result.errors.join(" ")}` : ""}`);
  }

  return (
    <section className="lib-card dev-paste cn-paste">
      <label className="dev-paste-text">
        <span className="field-label">Paste the pinout of {connector.short_id} (select the rows in the Excel or PDF, copy, paste here)</span>
        <textarea value={text} onChange={(e) => setText(e.currentTarget.value)} rows={6} placeholder={"Pin\tFunction\tGoes to\nEE\t12V+ Coils\tX6:E\nKK\t12V+ WG MOTOR CMD\tSP4"} autoFocus />
      </label>
      {cells.length > 0 && (
        <>
          <div className="dev-paste-preview">
            <table>
              <thead>
                <tr>
                  {effective.map((role, i) => (
                    <th key={i}>
                      <select value={role} aria-label={`Column ${i + 1} is`} onChange={(e) => setRoles(effective.map((r, j) => (j === i ? (e.currentTarget.value as PinoutRole) : r)))}>
                        {(Object.keys(PINOUT_ROLE_LABELS) as PinoutRole[]).map((k) => <option key={k} value={k}>{PINOUT_ROLE_LABELS[k]}</option>)}
                      </select>
                    </th>
                  ))}
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {cells.slice(0, 300).map((row, i) => {
                  const r = preview[i];
                  return (
                    <tr key={i} className={r.cavityId === null ? "dev-paste-skip" : undefined}>
                      {effective.map((role, j) => <td key={j} className={role === "ignore" ? "dev-paste-ignored" : undefined}>{row[j] ?? ""}</td>)}
                      <td>
                        {r.cavityId === null ? (
                          <span className="dev-warn">skipped</span>
                        ) : r.existing > 0 ? (
                          <span className={replace ? "dev-ok" : "dev-warn"}>→ {pinOf(r.cavityId)} · {replace ? "replaces its wire" : "already wired, kept"}</span>
                        ) : (
                          <span className="dev-ok">→ {pinOf(r.cavityId)} · new wire</span>
                        )}
                        {r.problems.length > 0 && <span className="dev-warn"> · {r.problems.join(" · ")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="dev-paste-actions">
            <span>
              <strong>{cells.length} rows</strong> · {usable.length} match a pin of {connector.short_id}
              {taken > 0 && ` · ${taken} already wired`}
            </span>
            <span className="lib-detail-spacer" />
            <label className="dev-replace" title="Off: pins that already have a wire are left as they are">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.currentTarget.checked)} /> Replace what's already there
            </label>
            <button onClick={onCancel}>Cancel</button>
            <button className="button-primary" disabled={applies === 0} onClick={apply}>Apply {applies} pins</button>
          </div>
        </>
      )}
      {cells.length === 0 && (
        <div className="dev-paste-actions">
          <span className="hint">Columns are split by tabs (Excel) or by two or more spaces (PDF). Pin, Function and Goes to are recognized from the header; you can change what each column is after pasting.</span>
          <span className="lib-detail-spacer" />
          <button onClick={onCancel}>Cancel</button>
        </div>
      )}
    </section>
  );
}
