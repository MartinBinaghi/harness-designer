import { BLOCK_HEADER, BLOCK_WIDTH, PIN_ROW, anchorY, blockHeight, buildSchematic, endSides, schematicLegend, type SchematicBlock } from "../logic/schematicLayout";
import { colorWord, swatchBackground, wireColors } from "../logic/sheets";
import type { ProjectData } from "../model/project";
import type { Library } from "../model/library";

/**
 * El esquema pin a pin para imprimir (Print → Schematic): los mismos bloques,
 * en el lugar donde quedaron en la pestaña Schematic (o el acomodo automático),
 * con el mismo filtro de cables; dibujo fijo (SVG) que entra en la hoja. Debajo,
 * los colores con sus tipos de señal.
 */

const NOTE_CHARS = 34;
const MARGIN = 20;

/** Punto de salida de un cable: el borde del pin en conectores, el centro del punto en uniones. */
function anchor(b: SchematicBlock, cavityId: number | null, side: "L" | "R"): [number, number] {
  if (b.kind !== "connector") return [b.x + 6, b.y + 14];
  return [side === "R" ? b.x + BLOCK_WIDTH : b.x, anchorY(b, cavityId)];
}

export function SchematicDrawing({ project, library, keep, maxHeightMm }: { project: ProjectData; library: Library; keep: Set<number> | null; maxHeightMm: number }) {
  const { blocks, links } = buildSchematic(project, library, false, keep);
  if (blocks.length === 0) return <p className="hint">No wires match.</p>;
  const byKey = new Map(blocks.map((b) => [b.key, b]));
  const minX = Math.min(...blocks.map((b) => b.x)) - MARGIN;
  const minY = Math.min(...blocks.map((b) => b.y)) - MARGIN;
  const maxX = Math.max(...blocks.map((b) => b.x + (b.kind === "connector" ? BLOCK_WIDTH : 80))) + MARGIN;
  const maxY = Math.max(...blocks.map((b) => b.y + blockHeight(b))) + MARGIN;

  const wires = links.map((l) => {
    const a = byKey.get(l.from.block)!;
    const b = byKey.get(l.to.block)!;
    const [sa, sb] = endSides(a.x, b.x, a.side, b.side);
    const [x1, y1] = anchor(a, l.from.cavityId, sa);
    const [x2, y2] = anchor(b, l.to.cavityId, sb);
    const reach = Math.max(Math.abs(x2 - x1) * 0.5, 30);
    const d = `M${x1} ${y1} C${x1 + (sa === "R" ? reach : -reach)} ${y1}, ${x2 + (sb === "R" ? reach : -reach)} ${y2}, ${x2} ${y2}`;
    return { id: l.wireId, d, colors: wireColors(l.color) };
  });

  return (
    <>
      <svg className="schematic-drawing" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} style={{ maxHeight: `${maxHeightMm}mm` }}>
        {wires.map((w) => (
          <g key={w.id}>
            <path d={w.d} fill="none" stroke="#444" strokeWidth={4} />
            <path d={w.d} fill="none" stroke={w.colors[0] ?? "#fff"} strokeWidth={2} />
            {w.colors[1] && <path d={w.d} fill="none" stroke={w.colors[1]} strokeWidth={2} strokeDasharray="6 6" />}
          </g>
        ))}
        {blocks.map((b) =>
          b.kind === "connector" ? (
            <g key={b.key}>
              <rect x={b.x} y={b.y} width={BLOCK_WIDTH} height={blockHeight(b)} fill="#fff" stroke="#333" />
              <line x1={b.x} x2={b.x + BLOCK_WIDTH} y1={b.y + BLOCK_HEADER} y2={b.y + BLOCK_HEADER} stroke="#333" />
              <text x={b.x + 8} y={b.y + 19} fontSize={14} fontWeight={700}>{b.title}</text>
              <text x={b.x + 8} y={b.y + 36} fontSize={11} fill="#555">{b.subtitle}</text>
              {b.pins.map((p, i) => {
                const y = b.y + BLOCK_HEADER + i * PIN_ROW;
                return (
                  <g key={p.cavityId}>
                    {i > 0 && <line x1={b.x} x2={b.x + BLOCK_WIDTH} y1={y} y2={y} stroke="#ccc" />}
                    <text x={b.x + 8} y={y + 15} fontSize={11} fontWeight={700} fontFamily="monospace">{p.label}</text>
                    <text x={b.x + 44} y={y + 15} fontSize={10} fill="#333">{p.note.length > NOTE_CHARS ? `${p.note.slice(0, NOTE_CHARS - 1)}…` : p.note}</text>
                  </g>
                );
              })}
            </g>
          ) : (
            <g key={b.key}>
              {b.kind === "ground" ? <rect x={b.x} y={b.y + 8} width={12} height={12} fill="#222" /> : <circle cx={b.x + 6} cy={b.y + 14} r={6} fill={b.kind === "component" ? "#fff" : "#222"} stroke="#222" strokeWidth={2} />}
              <text x={b.x + 16} y={b.y + 18} fontSize={11} fontWeight={700} fontFamily="monospace">{b.title}</text>
            </g>
          ),
        )}
      </svg>
      <ul className="schematic-legend">
        {schematicLegend(project, library, links).map(({ color, count, types }) => (
          <li key={color}>
            <span className="schematic-swatch" style={{ background: swatchBackground(color || null) }} />
            {color ? colorWord(color) : "no color"}
            {types.length > 0 && ` · ${types.join(", ")}`} ({count})
          </li>
        ))}
      </ul>
    </>
  );
}
