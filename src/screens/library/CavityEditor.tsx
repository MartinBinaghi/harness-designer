import { useState } from "react";
import type { ConnectorDef } from "../../model/library";
import { PencilIcon, TrashIcon } from "../../components/icons";
import milStd1560 from "../../data/mil-std-1560.json";
import type { MilArrangements } from "../../logic/connectorFace";

type Numbering = "numbers" | "upper" | "lower";
const NUMBERING_LABELS: Record<Numbering, string> = { numbers: "1, 2, 3…", upper: "A, B, C…", lower: "a, b, c…" };

// ponytail: letras solo A–Z / a–z (26 vías); conectores con más vías por letra
// (MIL que saltean I/O/Q, etc.) se cargan con "Edit individually".
export function cavityIds(count: number, numbering: Numbering): string[] {
  return Array.from({ length: count }, (_, i) =>
    numbering === "numbers" ? String(i + 1) : String.fromCharCode((numbering === "upper" ? 65 : 97) + i),
  );
}

/** Resumen legible de tamaños de contacto: "20" si son todos iguales, "20 ×4, 16 ×2" si no. */
export function contactSizeSummary(cavities: ConnectorDef["cavities"]): string {
  const counts = new Map<string, number>();
  for (const c of cavities) counts.set(c.contact_size || "—", (counts.get(c.contact_size || "—") ?? 0) + 1);
  if (counts.size === 1) return `contact size ${[...counts.keys()][0]}`;
  return `contact sizes ${[...counts].map(([size, n]) => `${size} ×${n}`).join(", ")}`;
}

/** Arreglos de inserto MIL-DTL-38999 (MIL-STD-1560): "13-35" -> [[id, tamaño, x, y], ...]. */
const MIL_INSERTS = milStd1560.arrangements as MilArrangements;

function insertLabel(code: string): string {
  const counts = new Map<string, number>();
  for (const [, size] of MIL_INSERTS[code]) counts.set(String(size), (counts.get(String(size)) ?? 0) + 1);
  return `${code} · ${[...counts].map(([size, n]) => `${n} × ${size}`).join(", ")}`;
}

function generatorDefaults(cavities: ConnectorDef["cavities"]) {
  const first = cavities[0]?.cavity_id ?? "";
  return {
    count: cavities.length || 1,
    numbering: (/^[A-Z]$/.test(first) ? "upper" : /^[a-z]$/.test(first) ? "lower" : "numbers") as Numbering,
    size: cavities[0]?.contact_size ?? "",
  };
}

/**
 * Vías del conector: un generador (cantidad + numeración + tamaño de contacto)
 * para el caso normal, un arreglo de inserto MIL-STD-1560 para los circulares
 * militares, y edición una por una solo para conectores mixtos.
 */
export function CavityEditor({ cd, onChange: onPatch }: { cd: ConnectorDef; onChange: (patch: Partial<ConnectorDef>) => void }) {
  const onChange = (cavities: ConnectorDef["cavities"]) => onPatch({ cavities });
  const initial = generatorDefaults(cd.cavities);
  const [count, setCount] = useState(initial.count);
  const [numbering, setNumbering] = useState<Numbering>(initial.numbering);
  const [size, setSize] = useState(initial.size);
  // Con vías ya cargadas se muestra solo el resumen; el lápiz abre la edición.
  const [editing, setEditing] = useState(false);
  const open = editing || cd.cavities.length === 0;
  const maxCount = numbering === "numbers" ? 200 : 26;

  function startEditing() {
    const d = generatorDefaults(cd.cavities);
    setCount(d.count);
    setNumbering(d.numbering);
    setSize(d.size);
    setEditing(true);
  }
  function generate() {
    onChange(cavityIds(Math.min(count, maxCount), numbering).map((id) => ({ cavity_id: id, contact_size: size })));
  }
  function updateCavity(index: number, patch: Partial<ConnectorDef["cavities"][number]>) {
    onChange(cd.cavities.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  return (
    <div className="cavity-editor">
      {cd.cavities.length > 0 && (
        <div className="cavity-summary">
          <span>
            {cd.cavities.length} cavit{cd.cavities.length === 1 ? "y" : "ies"} · {cd.cavities[0].cavity_id}–{cd.cavities[cd.cavities.length - 1].cavity_id} ·{" "}
            {contactSizeSummary(cd.cavities)}
          </span>
          {editing ? (
            <button className="link-button" onClick={() => setEditing(false)}>Done</button>
          ) : (
            <button className="icon-button" onClick={startEditing} title="Edit cavities" aria-label="Edit cavities">
              <PencilIcon />
            </button>
          )}
        </div>
      )}
      {open && (
        <>
          <div className="cavity-generator">
            <label>
              Ways <input type="number" min={1} max={maxCount} value={count} onChange={(e) => setCount(Math.max(1, Number(e.currentTarget.value) || 1))} />
            </label>
            <label>
              Numbering{" "}
              <select value={numbering} onChange={(e) => setNumbering(e.currentTarget.value as Numbering)}>
                {Object.entries(NUMBERING_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Contact size <input value={size} onChange={(e) => setSize(e.currentTarget.value)} placeholder="e.g. 20" />
            </label>
            <button onClick={generate} title={cd.cavities.length > 0 ? "Replaces the current cavity list (can be undone)" : undefined}>
              {cd.cavities.length > 0 ? "Regenerate" : "Generate"}
            </button>
            <label title="Circular MIL-DTL-38999 connectors: shell size + insert arrangement, from MIL-STD-1560C. Replaces the current cavity list.">
              or MIL-STD-1560 insert{" "}
              <select
                value=""
                onChange={(e) => {
                  const code = e.currentTarget.value;
                  if (!code) return;
                  onPatch({
                    shell_size: code.split("-")[0],
                    cavities: MIL_INSERTS[code].map(([id, size]) => ({ cavity_id: String(id), contact_size: String(size) })),
                  });
                }}
              >
                <option value="">choose…</option>
                {Object.keys(MIL_INSERTS).map((code) => (
                  <option key={code} value={code}>{insertLabel(code)}</option>
                ))}
              </select>
            </label>
          </div>
          {cd.cavities.length > 0 && (
            <>
              <table className="compact-table">
                <thead><tr><th>ID</th><th>Contact size</th><th></th></tr></thead>
                <tbody>
                  {cd.cavities.map((cav, i) => (
                    <tr key={i}>
                      <td><input value={cav.cavity_id} onChange={(e) => updateCavity(i, { cavity_id: e.currentTarget.value })} /></td>
                      <td><input value={cav.contact_size} onChange={(e) => updateCavity(i, { contact_size: e.currentTarget.value })} /></td>
                      <td>
                        <button className="icon-button" onClick={() => onChange(cd.cavities.filter((_, j) => j !== i))} title="Delete" aria-label="Delete cavity">
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => onChange([...cd.cavities, { cavity_id: "", contact_size: size }])}>+ cavity</button>
            </>
          )}
        </>
      )}
    </div>
  );
}
