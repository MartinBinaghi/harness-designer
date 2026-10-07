import { useMemo, useState } from "react";
import { connectorFace, hull, minSpacing, wireSide, type MilArrangements } from "./connectorFace";
import type { ConnectorDef } from "./libraryTypes";
import milStd1560 from "./data/mil-std-1560.json";

const MIL = milStd1560.arrangements as MilArrangements;

const NUMBERING_NOTE = {
  datasheet: "numbering checked against TE drawings",
  inferred: "numbering inferred from the family — confirm it on the part",
  standard: "contact positions from MIL-STD-1560",
};

/**
 * Cara del conector dibujada a partir de su serie y sus vías (ver
 * connectorFace.ts), con selector cara de acople / lado cables. `used` resalta
 * las vías que tienen cable. `fixedSide` muestra solo esa vista, sin selector
 * (hojas impresas). No muestra nada si la familia no se reconoce.
 */
export function ConnectorFaceView({ def, used, fixedSide }: { def: ConnectorDef; used?: Set<string>; fixedSide?: "front" | "rear" }) {
  const [chosenSide, setSide] = useState<"front" | "rear">("front");
  const side = fixedSide ?? chosenSide;
  const front = useMemo(() => connectorFace(def, MIL), [def]);
  if (!front) return null;
  const face = side === "front" ? front : wireSide(front);

  const o = face.outline;
  const spacing = minSpacing(face);
  const font = Math.min(spacing * 0.34, o * 0.42);
  const latchH = o * 0.3;
  let body;
  let box: [number, number, number, number]; // minX, minY, maxX, maxY
  if (face.shape === "circle") {
    const key = o * 0.14;
    body = (
      <>
        <circle r={o} className="cf-body" />
        {/* Chavetero principal (posición normal) a las 12. */}
        <rect x={-key / 2} y={-o - 0.01} width={key} height={key} className="cf-key" />
      </>
    );
    box = [-o, -o, o, o];
  } else {
    const pts = hull(face);
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    box = [Math.min(...xs) - o, Math.min(...ys) - o, Math.max(...xs) + o, Math.max(...ys) + o];
    const midY = (box[1] + box[3]) / 2;
    body = (
      <>
        {face.shape === "rect" ? (
          <>
            {/* Carcasa rectangular con esquinas apenas redondeadas, como las Deutsch reales. */}
            <rect x={box[0] - o * 0.06} y={box[1] - o * 0.06} width={box[2] - box[0] + o * 0.12} height={box[3] - box[1] + o * 0.12} rx={o * 0.46} className="cf-body-edge" />
            <rect x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]} rx={o * 0.4} className="cf-body-fill" />
          </>
        ) : (
          <>
            <RoundedHull pts={pts} r={o * 1.06} className="cf-body-edge" />
            <RoundedHull pts={pts} r={o} className="cf-body-fill" />
          </>
        )}
        {face.latch === "top" ? (
          <rect x={-o * 0.7} y={box[1] - latchH} width={o * 1.4} height={latchH + o * 0.1} rx={latchH * 0.3} className="cf-latch" />
        ) : (
          <>
            <rect x={box[0] - latchH} y={midY - o * 0.7} width={latchH + o * 0.1} height={o * 1.4} rx={latchH * 0.3} className="cf-latch" />
            <rect x={box[2] - o * 0.1} y={midY - o * 0.7} width={latchH + o * 0.1} height={o * 1.4} rx={latchH * 0.3} className="cf-latch" />
          </>
        )}
      </>
    );
    box = face.latch === "top" ? [box[0], box[1] - latchH, box[2], box[3]] : [box[0] - latchH, box[1], box[2] + latchH, box[3]];
  }
  const pad = o * 0.1;
  const viewBox = `${box[0] - pad} ${box[1] - pad} ${box[2] - box[0] + 2 * pad} ${box[3] - box[1] + 2 * pad}`;

  return (
    <figure className="connector-face">
      <svg viewBox={viewBox} role="img" aria-label={`${side === "front" ? "Mating face" : "Wire side"} with cavity numbers`}>
        {body}
        {face.cavities.map((c) => {
          const r = Math.min(c.r, spacing * 0.46);
          return (
            <g key={c.id} className={used?.has(c.id) ? "cf-cavity cf-used" : "cf-cavity"}>
              <circle cx={c.x} cy={c.y} r={r} />
              <text x={c.x} y={c.y} fontSize={Math.min(font, r * 1.05)} textAnchor="middle" dominantBaseline="central">
                {c.id}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        {fixedSide ? (
          <span className="cf-fixed-side">{side === "front" ? "Mating face" : "Wire side"}</span>
        ) : (
          <span className="cf-toggle">
            <button className={side === "front" ? "active" : ""} onClick={() => setSide("front")}>Mating face</button>
            <button className={side === "rear" ? "active" : ""} onClick={() => setSide("rear")}>Wire side</button>
          </span>
        )}
        <span className="hint">Drawn by the program · {NUMBERING_NOTE[face.numbering]}</span>
      </figcaption>
    </figure>
  );
}

/**
 * La envolvente de los centros agrandada `r` en todas direcciones (contorno de
 * esquinas redondeadas), como figuras rellenas: el polígono, un círculo en cada
 * vértice y una banda por lado. Un trazo grueso con uniones redondeadas daría
 * lo mismo en pantalla, pero la impresión de Chromium lo deforma.
 */
function RoundedHull({ pts, r, className }: { pts: [number, number][]; r: number; className: string }) {
  const bands = pts.map(([x1, y1], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const [nx, ny] = [(-(y2 - y1) / len) * r, ((x2 - x1) / len) * r];
    return `${x1 + nx},${y1 + ny} ${x2 + nx},${y2 + ny} ${x2 - nx},${y2 - ny} ${x1 - nx},${y1 - ny}`;
  });
  return (
    <g className={className}>
      {pts.length >= 3 && <polygon points={pts.map(([x, y]) => `${x},${y}`).join(" ")} />}
      {pts.length >= 2 && bands.map((b, i) => <polygon key={i} points={b} />)}
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={r} />)}
    </g>
  );
}
