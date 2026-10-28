import type { ProjectData } from "../model/project";
import type { AssemblyBranch } from "../logic/sheets";

/**
 * Hoja de armado por breakouts (pedido de Martin, como la hoja a mano del
 * taller): una vista general con el esqueleto del arnés (conector principal y
 * breakouts numerados, con largo y termo de cada tramo) y la lista de salidas
 * de cada breakout; después, una hoja por breakout con sus salidas en abanico,
 * con letra que se lee en la mesa.
 */

const TERMINATION: Record<string, string> = {
  boot_straight: "boot",
  boot_90: "boot 90°",
  adhesive_heatshrink: "adhesive HS",
  t_mold: "T-mold",
};
const halo = { paintOrder: "stroke", stroke: "#fff", strokeWidth: 5, strokeLinejoin: "round" } as const;
/** En la mesa da igual si el termo lo eligió Martin o lo sugirió el cálculo. */
const hsText = (hs: string | null) => (hs ? `HS ${hs.replace(" (suggested)", "")}` : null);

/** "1490 mm from X1", o null si no se muestran distancias. */
function distanceText(distances: Record<string, number> | null, nodeId: number, mainId: string) {
  const d = distances?.[String(nodeId)];
  return d === undefined ? null : `${Math.round(d)} mm from ${mainId}`;
}

function mainLabel(project: ProjectData) {
  const main = project.connector_instances.find((c) => c.id === project.project.main_connector_instance_id);
  return { id: main?.short_id ?? "", name: main?.name || main?.short_id || "Start" };
}

/** Breakouts que tienen hoja propia: todos, y el principal solo si le salen conectores directo. */
export function branchesWithSheet(branches: AssemblyBranch[]) {
  return branches.filter((b) => b.num > 0 || b.outlets.some((o) => o.branch === null));
}

export function AssemblyOverview({ project, branches, distances, maxHeightMm }: {
  project: ProjectData;
  branches: AssemblyBranch[];
  distances: Record<string, number> | null;
  maxHeightMm: number;
}) {
  if (branches.length === 0) return <p className="hint">The harness has no topology yet.</p>;
  const main = mainLabel(project);

  // Esqueleto: el tronco (la rama numerada última en cada breakout) sigue en la
  // misma fila; las ramas laterales bajan a una fila nueva.
  const STEP = 230;
  const ROW = 120;
  const pos = new Map<number, { x: number; y: number }>();
  let rows = 0;
  const place = (num: number, x: number, y: number) => {
    pos.set(num, { x, y });
    const kids = branches[num].outlets.filter((o) => o.branch !== null).map((o) => o.branch!).sort((a, b) => a - b);
    for (const k of kids.slice(0, -1)) place(k, x + STEP, ++rows * ROW);
    if (kids.length > 0) place(kids[kids.length - 1], x + STEP, y);
  };
  place(0, 0, 0);
  const xs = [...pos.values()].map((p) => p.x);
  const box = [-110, -70, Math.max(...xs) + 220, (rows + 1) * ROW + 40];

  return (
    <>
      <svg className="assembly assembly-skeleton" viewBox={box.join(" ")} style={{ maxHeight: `${maxHeightMm * 0.45}mm` }} fontFamily="Arial, sans-serif" role="img" aria-label="Harness overview">
        {branches.slice(1).map((b) => {
          const a = pos.get(b.parentNum!)!;
          const p = pos.get(b.num)!;
          const mid = { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 };
          return (
            <g key={b.num}>
              <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke="#000" strokeWidth={3} />
              <text x={mid.x} y={mid.y - 10} textAnchor="middle" fontSize={20} fontWeight={700} style={halo}>{b.inLengthMm}</text>
              {b.inHs && <text x={mid.x} y={mid.y + 22} textAnchor="middle" fontSize={14} style={halo}>{hsText(b.inHs)}</text>}
            </g>
          );
        })}
        <rect x={-100} y={-24} width={100} height={48} rx={4} fill="#fff" stroke="#000" strokeWidth={3} />
        <text x={-50} y={-2} textAnchor="middle" fontSize={16} fontWeight={700}>{main.name}</text>
        <text x={-50} y={16} textAnchor="middle" fontSize={12}>{main.id}</text>
        {branches.slice(1).map((b) => {
          const p = pos.get(b.num)!;
          const distance = distanceText(distances, b.nodeId, main.id);
          return (
            <g key={b.num}>
              <circle cx={p.x} cy={p.y} r={20} fill="#fff" stroke="#000" strokeWidth={3} />
              <text x={p.x} y={p.y + 7} textAnchor="middle" fontSize={20} fontWeight={700}>{b.num}</text>
              {distance && <text x={p.x} y={p.y + 42} textAnchor="middle" fontSize={12} style={halo}>{distance}</text>}
            </g>
          );
        })}
      </svg>

      <div className="assembly-lists">
        {branches.filter((b) => b.outlets.some((o) => o.branch === null)).map((b) => (
          <BranchList key={b.num} project={project} branch={b} distances={distances} />
        ))}
      </div>
    </>
  );
}

/** La lista de un breakout, como en la hoja a mano: nombre, largo, conector y termo de cada salida. */
function BranchList({ project, branch, distances }: { project: ProjectData; branch: AssemblyBranch; distances: Record<string, number> | null }) {
  const main = mainLabel(project);
  const distance = branch.num === 0 ? null : distanceText(distances, branch.nodeId, main.id);
  return (
    <section className="assembly-list">
      <h4>{branch.num === 0 ? main.name : branch.num}{distance && <span className="assembly-muted"> · {distance}</span>}</h4>
      <table>
        <tbody>
          {branch.outlets.map((o) => (
            <tr key={o.nodeId}>
              <td className="strong">{o.branch !== null ? `→ ${o.branch}` : o.name}</td>
              <td className="assembly-muted">{o.branch !== null ? "" : o.id}</td>
              <td className="num">{o.lengthMm}</td>
              <td>{o.part}</td>
              <td>{o.hs ? o.hs.replace(" (suggested)", "") : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** La hoja de un breakout: el tramo que llega y sus salidas en abanico, a tamaño de mesa. */
export function BranchFan({ project, branch, distances, maxHeightMm }: {
  project: ProjectData;
  branch: AssemblyBranch;
  distances: Record<string, number> | null;
  maxHeightMm: number;
}) {
  const main = mainLabel(project);
  const ROW = 86;
  const n = Math.max(branch.outlets.length, 1);
  const hub = { x: 230, y: ((n - 1) * ROW) / 2 + 30 };
  const BOX_X = 640;
  const from = branch.num === 0 ? null : branch.parentNum === 0 ? main.id : `${branch.parentNum}`;
  const hubDistance = distanceText(distances, branch.nodeId, main.id);

  return (
    <svg className="assembly" viewBox={`-10 -30 1000 ${n * ROW + 60}`} style={{ maxHeight: `${maxHeightMm}mm` }} fontFamily="Arial, sans-serif" role="img" aria-label={`Breakout ${branch.num}`}>
      {from && (
        <g>
          <line x1={0} y1={hub.y} x2={hub.x} y2={hub.y} stroke="#000" strokeWidth={3} strokeDasharray="10 6" />
          <text x={hub.x / 2 - 10} y={hub.y - 12} textAnchor="middle" fontSize={18} fontWeight={700} style={halo}>from {from} · {branch.inLengthMm} mm</text>
          {branch.inHs && <text x={hub.x / 2 - 10} y={hub.y + 26} textAnchor="middle" fontSize={14} style={halo}>{hsText(branch.inHs)}</text>}
        </g>
      )}
      {branch.outlets.map((o, i) => {
        const yc = i * ROW + 30;
        // Etiqueta cerca de la salida, donde las líneas ya están separadas.
        const t = 0.72;
        const lx = hub.x + (BOX_X - hub.x) * t;
        const ly = hub.y + (yc - hub.y) * t;
        const connectors = project.connector_instances.filter((c) => c.node_id === o.nodeId);
        const tags = [
          ...connectors.map((c) => (c.termination && c.termination !== "none" ? TERMINATION[c.termination] : null)),
          distanceText(distances, o.nodeId, main.id),
        ].filter(Boolean);
        return (
          <g key={o.nodeId}>
            <line x1={hub.x} y1={hub.y} x2={BOX_X} y2={yc} stroke="#000" strokeWidth={3} />
            <text x={lx} y={ly - 8} textAnchor="middle" fontSize={20} fontWeight={700} style={halo}>{o.lengthMm} mm</text>
            {o.hs && <text x={lx} y={ly + 16} textAnchor="middle" fontSize={13} style={halo}>{hsText(o.hs)}</text>}
            {o.branch !== null ? (
              <g>
                <circle cx={BOX_X + 22} cy={yc} r={22} fill="#fff" stroke="#000" strokeWidth={3} />
                <text x={BOX_X + 22} y={yc + 7} textAnchor="middle" fontSize={20} fontWeight={700}>{o.branch}</text>
                <text x={BOX_X + 56} y={yc + 6} fontSize={16}>breakout {o.branch} (own sheet)</text>
              </g>
            ) : (
              <g>
                <rect x={BOX_X} y={yc - 32} width={330} height={64} rx={5} fill="#fff" stroke="#000" strokeWidth={2.5} />
                <text x={BOX_X + 12} y={yc - 8} fontSize={20} fontWeight={700}>{o.name}</text>
                <text x={BOX_X + 12} y={yc + 12} fontSize={13}>{[o.id, o.part].filter(Boolean).join(" · ")}</text>
                {tags.length > 0 && <text x={BOX_X + 12} y={yc + 27} fontSize={11}>{tags.join(" · ")}</text>}
              </g>
            )}
          </g>
        );
      })}
      <circle cx={hub.x} cy={hub.y} r={24} fill="#fff" stroke="#000" strokeWidth={3} />
      <text x={hub.x} y={hub.y + 8} textAnchor="middle" fontSize={22} fontWeight={700}>{branch.num === 0 ? main.id : branch.num}</text>
      {hubDistance && branch.num !== 0 && <text x={hub.x} y={hub.y + 48} textAnchor="middle" fontSize={13} style={halo}>{hubDistance}</text>}
    </svg>
  );
}
