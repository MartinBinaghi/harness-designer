import type { ReactNode } from "react";
import type { ProjectData } from "../model/project";
import type { AssemblyBranch, AssemblyOutlet } from "../logic/sheets";
import { partLabel, type Library } from "../model/library";

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
      <svg className="assembly assembly-skeleton" viewBox={box.join(" ")} style={svgSize(box[2], maxHeightMm * 0.45)} fontFamily="Arial, sans-serif" role="img" aria-label="Harness overview">
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
              <td className="strong">{o.backward ? "← " : ""}{o.branch !== null ? `→ ${o.branch}` : o.name}</td>
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

// Medidas del abanico, en unidades del dibujo (ver ASSEMBLY_MM_PER_UNIT).
const ROW = 86;
const BOX_W = 330;
/** Del centro del breakout al recuadro de una salida. */
const REACH = 410;
const MAIN_W = 220;

/**
 * Escala fija de los dibujos de armado (mm de papel por unidad): antes se
 * estiraban a todo el ancho de la hoja y, con pocos elementos, la letra quedaba
 * enorme (Martin). Un dibujo más grande que la hoja se achica para entrar.
 */
const ASSEMBLY_MM_PER_UNIT = 0.15;
const svgSize = (width: number, maxHeightMm: number) => ({ width: `${width * ASSEMBLY_MM_PER_UNIT}mm`, maxHeight: `${maxHeightMm}mm` });

type Point = { x: number; y: number };
/** Un punto de la línea a → b, a una fracción `t` de su largo. */
const along = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * Filas de las salidas hacia atrás, relativas al tramo que llega (−1 = una
 * arriba): arriba o abajo como en el diagrama, la más cercana primero; sin
 * posiciones, alternadas.
 */
function backRows(backward: AssemblyOutlet[]): Map<AssemblyOutlet, number> {
  const rows = new Map<AssemblyOutlet, number>();
  const up = backward.filter((o) => o.above === true).reverse();
  const down = backward.filter((o) => o.above === false);
  up.forEach((o, i) => rows.set(o, -(i + 1)));
  down.forEach((o, i) => rows.set(o, i + 1));
  backward
    .filter((o) => o.above === null)
    .forEach((o, i) => rows.set(o, (i % 2 === 0 ? -1 : 1) * (Math.floor(i / 2) + 1 + (i % 2 === 0 ? up.length : down.length))));
  return rows;
}

/** Largo y termo de un tramo, en `at` (cerca de la punta, donde las líneas ya están separadas). */
function SegmentLabel({ at, o }: { at: Point; o: { lengthMm: number; hs: string | null } }) {
  return (
    <>
      <text x={at.x} y={at.y - 8} textAnchor="middle" fontSize={20} fontWeight={700} style={halo}>{o.lengthMm} mm</text>
      {o.hs && <text x={at.x} y={at.y + 16} textAnchor="middle" fontSize={13} style={halo}>{hsText(o.hs)}</text>}
    </>
  );
}

/** El recuadro de una salida que termina en un conector o masa: nombre, ID y pieza, terminación y distancia. */
function OutletBox({ project, o, x, yc, distances, mainId }: { project: ProjectData; o: AssemblyOutlet; x: number; yc: number; distances: Record<string, number> | null; mainId: string }) {
  const tags = [
    ...project.connector_instances.filter((c) => c.node_id === o.nodeId).map((c) => (c.termination && c.termination !== "none" ? TERMINATION[c.termination] : null)),
    distanceText(distances, o.nodeId, mainId),
  ].filter(Boolean);
  return (
    <g>
      <rect x={x} y={yc - 32} width={BOX_W} height={64} rx={5} fill="#fff" stroke="#000" strokeWidth={2.5} />
      <text x={x + 12} y={yc - 8} fontSize={20} fontWeight={700}>{o.name}</text>
      <text x={x + 12} y={yc + 12} fontSize={13}>{[o.id, o.part].filter(Boolean).join(" · ")}</text>
      {tags.length > 0 && <text x={x + 12} y={yc + 27} fontSize={12}>{tags.join(" · ")}</text>}
    </g>
  );
}

/** El centro de un breakout: su número, la terminación arriba y la distancia abajo. */
function Hub({ project, library, branch, at, label, distances, mainId }: { project: ProjectData; library: Library; branch: AssemblyBranch; at: Point; label: string; distances: Record<string, number> | null; mainId: string }) {
  const node = project.nodes.find((n) => n.id === branch.nodeId);
  const termination =
    node?.termination && node.termination !== "none"
      ? [TERMINATION[node.termination], node.termination_library_part_id != null ? partLabel(library, node.termination_library_part_id) : null].filter(Boolean).join(" ")
      : null;
  const distance = branch.num !== 0 ? distanceText(distances, branch.nodeId, mainId) : null;
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={24} fill="#fff" stroke="#000" strokeWidth={3} />
      <text x={at.x} y={at.y + 8} textAnchor="middle" fontSize={22} fontWeight={700}>{label}</text>
      {distance && <text x={at.x} y={at.y + 48} textAnchor="middle" fontSize={13} style={halo}>{distance}</text>}
      {termination && <text x={at.x} y={at.y - 34} textAnchor="middle" fontSize={13} style={halo}>{termination}</text>}
    </g>
  );
}

/** Una salida que lleva a otro breakout, cuando ese breakout se dibuja aparte. */
function BranchRef({ num, x, yc, toLeft, note }: { num: number; x: number; yc: number; toLeft: boolean; note: string }) {
  return (
    <g>
      <circle cx={x} cy={yc} r={22} fill="#fff" stroke="#000" strokeWidth={3} />
      <text x={x} y={yc + 7} textAnchor="middle" fontSize={20} fontWeight={700}>{num}</text>
      <text x={toLeft ? x - 34 : x + 34} y={yc + 6} textAnchor={toLeft ? "end" : "start"} fontSize={16}>breakout {num} ({note})</text>
    </g>
  );
}

/**
 * La hoja de un breakout: el tramo que llega y sus salidas en abanico, a tamaño
 * de mesa. Las salidas hacia adelante van a la derecha; las que vuelven hacia
 * el conector principal (`backward`), a la izquierda, arriba y abajo del tramo
 * que llega.
 */
export function BranchFan({ project, library, branch, distances, maxHeightMm }: {
  project: ProjectData;
  library: Library;
  branch: AssemblyBranch;
  distances: Record<string, number> | null;
  maxHeightMm: number;
}) {
  const main = mainLabel(project);
  const forward = branch.outlets.filter((o) => !o.backward);
  const backward = branch.outlets.filter((o) => o.backward);
  const n = Math.max(forward.length, 1);
  const hub = { x: (backward.length > 0 ? BOX_W + 60 : 0) + 230, y: ((n - 1) * ROW) / 2 + 30 };
  const boxX = hub.x + REACH;
  const back = backRows(backward);
  const ys = [...forward.map((_, i) => i * ROW + 30), ...[...back.values()].map((r) => hub.y + r * ROW), hub.y];
  const top = Math.min(...ys) - 60;
  const bottom = Math.max(...ys) + 60;
  const from = branch.num === 0 ? null : branch.parentNum === 0 ? main.id : `${branch.parentNum}`;
  const width = boxX + 360;

  /** Una salida: la línea desde el centro, su largo y termo, y el conector (o el breakout siguiente) en la punta. */
  const outlet = (o: AssemblyOutlet, yc: number, toLeft: boolean) => {
    const anchor = { x: toLeft ? BOX_W : boxX, y: yc };
    return (
      <g key={o.nodeId}>
        <line x1={hub.x} y1={hub.y} x2={anchor.x} y2={yc} stroke="#000" strokeWidth={3} />
        <SegmentLabel at={along(hub, anchor, 0.72)} o={o} />
        {o.branch !== null ? (
          <BranchRef num={o.branch} x={toLeft ? BOX_W - 22 : boxX + 22} yc={yc} toLeft={toLeft} note="own sheet" />
        ) : (
          <OutletBox project={project} o={o} x={toLeft ? 0 : boxX} yc={yc} distances={distances} mainId={main.id} />
        )}
      </g>
    );
  };

  return (
    <svg className="assembly" viewBox={`-10 ${top} ${width} ${bottom - top}`} style={svgSize(width, maxHeightMm)} fontFamily="Arial, sans-serif" role="img" aria-label={`Breakout ${branch.num}`}>
      {from && (
        <g>
          <line x1={0} y1={hub.y} x2={hub.x} y2={hub.y} stroke="#000" strokeWidth={3} strokeDasharray="10 6" />
          <text x={hub.x / 2 - 10} y={hub.y - 12} textAnchor="middle" fontSize={18} fontWeight={700} style={halo}>from {from} · {branch.inLengthMm} mm</text>
          {branch.inHs && <text x={hub.x / 2 - 10} y={hub.y + 26} textAnchor="middle" fontSize={14} style={halo}>{hsText(branch.inHs)}</text>}
        </g>
      )}
      {forward.map((o, i) => outlet(o, i * ROW + 30, false))}
      {backward.map((o) => outlet(o, hub.y + back.get(o)! * ROW, true))}
      <Hub project={project} library={library} branch={branch} at={hub} label={branch.num === 0 ? main.id : String(branch.num)} distances={distances} mainId={main.id} />
    </svg>
  );
}

/**
 * Todo el arnés en un dibujo (pedido de Martin: la vista general y las hojas de
 * los breakouts juntas, no una copia del diagrama): el conector principal, el
 * tronco con los breakouts numerados y, en cada breakout, sus salidas en
 * abanico como en su hoja. Un breakout que sale de otro abre su abanico en la
 * punta de ese tramo; las salidas hacia atrás van a la izquierda de su
 * breakout. Un breakout que sale hacia atrás de otro (raro) se dibuja aparte,
 * debajo, como en su hoja.
 */
export function WholeHarness({ project, library, branches, distances, maxHeightMm }: {
  project: ProjectData;
  library: Library;
  branches: AssemblyBranch[];
  distances: Record<string, number> | null;
  maxHeightMm: number;
}) {
  if (branches.length === 0) return <p className="hint">The harness has no topology yet.</p>;
  const main = mainLabel(project);
  const forwardOf = (b: AssemblyBranch) => (b.num === 0 ? b.outlets : b.outlets.filter((o) => !o.backward));
  const backwardOf = (b: AssemblyBranch) => (b.num === 0 ? [] : b.outlets.filter((o) => o.backward));
  const child = (o: AssemblyOutlet) => (o.branch !== null ? branches[o.branch] : null);

  // Alto de cada breakout: su columna hacia adelante (un renglón por conector,
  // el alto entero de cada breakout que sale de él) y las filas hacia atrás,
  // arriba y abajo del tramo que llega.
  const sizes = new Map<number, { fwd: number; above: number; below: number }>();
  const size = (b: AssemblyBranch): { fwd: number; above: number; below: number } => {
    const known = sizes.get(b.num);
    if (known) return known;
    const fwd =
      forwardOf(b).reduce((t, o) => {
        const c = child(o);
        return t + (c ? size(c).above + size(c).below : ROW);
      }, 0) || ROW;
    const rows = [...backRows(backwardOf(b)).values()];
    const up = Math.max(0, ...rows.map((r) => -r));
    const down = Math.max(0, ...rows.map((r) => r));
    const s = { fwd, above: Math.max(fwd / 2, (up + 0.5) * ROW), below: Math.max(fwd / 2, (down + 0.5) * ROW) };
    sizes.set(b.num, s);
    return s;
  };

  const lines: ReactNode[] = [];
  const marks: ReactNode[] = [];
  const apart: AssemblyBranch[] = [];
  let right = 0;
  /** Dibuja un breakout (o el conector principal) desde `left`, con su franja desde `top`; devuelve su centro. */
  const draw = (b: AssemblyBranch, left: number, top: number): Point => {
    const s = size(b);
    const back = backRows(backwardOf(b));
    const hub = { x: b.num === 0 ? left + MAIN_W : left + (back.size > 0 ? BOX_W + 60 : 0) + 230, y: top + s.above };
    const forward = forwardOf(b);
    // Si le sale algún conector, los breakouts siguientes van después de su columna de recuadros.
    const childLeft = hub.x + (forward.some((o) => !child(o)) ? REACH + BOX_W + 40 : 260);
    let rowTop = hub.y - s.fwd / 2;
    for (const o of forward) {
      const c = child(o);
      if (c) {
        const at = draw(c, childLeft, rowTop);
        // El largo, a mitad de camino hasta donde empieza el breakout siguiente.
        const t = (childLeft - hub.x) / 2 / (at.x - hub.x);
        lines.push(<line key={`l${c.num}`} x1={hub.x} y1={hub.y} x2={at.x} y2={at.y} stroke="#000" strokeWidth={3} />);
        marks.push(<SegmentLabel key={`t${c.num}`} at={along(hub, at, t)} o={o} />);
        rowTop += size(c).above + size(c).below;
      } else {
        const anchor = { x: hub.x + REACH, y: rowTop + ROW / 2 };
        lines.push(<line key={`o${o.nodeId}`} x1={hub.x} y1={hub.y} x2={anchor.x} y2={anchor.y} stroke="#000" strokeWidth={3} />);
        marks.push(
          <g key={`o${o.nodeId}`}>
            <SegmentLabel at={along(hub, anchor, 0.72)} o={o} />
            <OutletBox project={project} o={o} x={anchor.x} yc={anchor.y} distances={distances} mainId={main.id} />
          </g>,
        );
        right = Math.max(right, anchor.x + BOX_W);
        rowTop += ROW;
      }
    }
    for (const o of backwardOf(b)) {
      const anchor = { x: left + BOX_W, y: hub.y + back.get(o)! * ROW };
      const c = child(o);
      if (c) apart.push(c);
      lines.push(<line key={`b${o.nodeId}`} x1={hub.x} y1={hub.y} x2={anchor.x} y2={anchor.y} stroke="#000" strokeWidth={3} />);
      marks.push(
        <g key={`b${o.nodeId}`}>
          <SegmentLabel at={along(hub, anchor, 0.72)} o={o} />
          {c ? (
            <BranchRef num={c.num} x={anchor.x - 22} yc={anchor.y} toLeft note="drawn below" />
          ) : (
            <OutletBox project={project} o={o} x={left} yc={anchor.y} distances={distances} mainId={main.id} />
          )}
        </g>,
      );
    }
    marks.push(
      b.num === 0 ? (
        <g key="main">
          <rect x={left} y={hub.y - 32} width={MAIN_W} height={64} rx={5} fill="#fff" stroke="#000" strokeWidth={3} />
          <text x={left + MAIN_W / 2} y={hub.y - 4} textAnchor="middle" fontSize={22} fontWeight={700}>{main.name}</text>
          <text x={left + MAIN_W / 2} y={hub.y + 18} textAnchor="middle" fontSize={14}>{main.id}</text>
        </g>
      ) : (
        <Hub key={`h${b.num}`} project={project} library={library} branch={b} at={hub} label={String(b.num)} distances={distances} mainId={main.id} />
      ),
    );
    right = Math.max(right, hub.x + 30);
    return hub;
  };
  const root = size(branches[0]);
  draw(branches[0], 0, 0);
  const width = right + 20;

  return (
    <>
      {/* Las líneas primero: los recuadros, centros y largos van encima. */}
      <svg className="assembly" viewBox={`-10 -50 ${width} ${root.above + root.below + 100}`} style={svgSize(width, maxHeightMm)} fontFamily="Arial, sans-serif" role="img" aria-label="Whole harness">
        {lines}
        {marks}
      </svg>
      {apart.map((b) => (
        <BranchFan key={b.num} project={project} library={library} branch={b} distances={distances} maxHeightMm={maxHeightMm} />
      ))}
    </>
  );
}
