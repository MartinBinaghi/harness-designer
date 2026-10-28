import { useState } from "react";
import { guessRoles, parsePinout, previewPaste, type ColumnRole, type PasteRow } from "../../logic/devicePins";

const ROLE_LABELS: Record<ColumnRole, string> = { cavity: "Cavity", name: "Pin name", function: "Function", ignore: "Ignore" };

/** Pegar la tabla del cliente (Excel o PDF): elegir qué columna es cada cosa, ver qué coincide con la carcasa y aplicar. */
export function PastePinout({ cavityIds, label, housingName, onCancel, onApply }: {
  cavityIds: string[];
  label: string;
  housingName: string;
  onCancel: () => void;
  onApply: (rows: PasteRow[], replace: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [replace, setReplace] = useState(true);
  const cells = parsePinout(text);
  const columns = Math.max(0, ...cells.map((r) => r.length));
  const effectiveRoles = Array.from({ length: columns }, (_, i) => roles[i] ?? guessRoles(columns)[i]);
  const preview = previewPaste(cells, effectiveRoles, cavityIds, label);
  const matched = preview.filter((r) => r.match).length;
  const unmatched = preview.filter((r) => !r.match).map((r) => r.cavity || "(empty)");

  return (
    <section className="lib-card dev-paste">
      <label className="dev-paste-text">
        <span className="field-label">Paste the client's pinout (select the rows in their Excel or PDF, copy, paste here)</span>
        <textarea value={text} onChange={(e) => setText(e.currentTarget.value)} rows={8} placeholder={"A1\tOUT1\t20 A output\nA2\tOUT2\t20 A output"} autoFocus />
      </label>
      {cells.length > 0 && (
        <>
          <div className="dev-paste-preview">
            <table>
              <thead>
                <tr>
                  {effectiveRoles.map((role, i) => (
                    <th key={i}>
                      <select
                        value={role}
                        aria-label={`Column ${i + 1} is`}
                        onChange={(e) => setRoles(effectiveRoles.map((r, j) => (j === i ? (e.currentTarget.value as ColumnRole) : r)))}
                      >
                        {(Object.keys(ROLE_LABELS) as ColumnRole[]).map((k) => <option key={k} value={k}>{ROLE_LABELS[k]}</option>)}
                      </select>
                    </th>
                  ))}
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {cells.slice(0, 200).map((row, i) => (
                  <tr key={i} className={preview[i].match ? undefined : "dev-paste-skip"}>
                    {effectiveRoles.map((role, j) => <td key={j} className={role === "ignore" ? "dev-paste-ignored" : undefined}>{row[j] ?? ""}</td>)}
                    <td>{preview[i].match ? <span className="dev-ok">→ {preview[i].match}</span> : <span className="dev-warn">not in housing</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dev-paste-actions">
            <span>
              <strong>{cells.length} rows</strong> · {matched} match a cavity of {housingName}
              {unmatched.length > 0 && <span className="dev-warn"> · {unmatched.length} skipped ({unmatched.slice(0, 5).join(", ")}{unmatched.length > 5 ? "…" : ""})</span>}
            </span>
            <span className="lib-detail-spacer" />
            <label className="dev-replace"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.currentTarget.checked)} /> Replace names already typed</label>
            <button onClick={onCancel}>Cancel</button>
            <button className="button-primary" disabled={matched === 0} onClick={() => onApply(preview, replace)}>Apply {matched} pins</button>
          </div>
        </>
      )}
      {cells.length === 0 && (
        <div className="dev-paste-actions">
          <span className="hint">Columns are split by tabs (Excel) or by two or more spaces (PDF). You choose which column is which after pasting.</span>
          <span className="lib-detail-spacer" />
          <button onClick={onCancel}>Cancel</button>
        </div>
      )}
    </section>
  );
}
