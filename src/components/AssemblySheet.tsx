import type { ProjectData } from "../model/project";
import type { Library } from "../model/library";
import type { CostReport } from "../model/calc";
import { BLOCK_SIZE, POINT_SIZE, autoLayout, isBlock, rootNodeId } from "../logic/diagramLayout";
import { pxPerMm, rootedTree, scaledCenters } from "../logic/diagramScale";
import { heatShrinkSize } from "../logic/sheets";

/**
 * Hoja de armado (etapa 6b, plan 10.2): el diagrama del arnés con sus medidas,
 * en blanco y negro, ajustado a la hoja, para llevar a la mesa. Mismo dibujo
 * que la pestaña Diagram (posiciones guardadas o layout automático, y la
 * opción a escala), sin nada interactivo.
 */

const TERMINATION: Record<string, string> = {
  boot_straight: "boot",
  boot_90: "boot 90°",
  adhesive_heatshrink: "adhesive HS",
  t_mold: "T-mold",
};
const GENDER = { male: "M", female: "F" } as const;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function AssemblySheet({ project, library, report, distances, toScale, maxHeightMm }: {
  project: ProjectData;
  library: Library;
  report: CostReport;
  /** Distancia desde el conector principal a cada nodo (`node_distances`), o null para no mostrarla. */
  distances: Record<string, number> | null;
  toScale: boolean;
  maxHeightMm: number;
}) {
  if (project.nodes.length === 0) return <p className="hint">The harness has no topology yet.</p>;

  const size = (id: number) => (isBlock(project, id) ? BLOCK_SIZE : POINT_SIZE);
  const auto = autoLayout(project);
  const centers = new Map(
    project.nodes.map((n) => {
      const p = n.diagram_x != null && n.diagram_y != null ? { x: n.diagram_x, y: n.diagram_y } : auto.get(n.id) ?? { x: 0, y: 0 };
      const sz = size(n.id);
      return [n.id, { x: p.x + sz.width / 2, y: p.y + sz.height / 2 }];
    }),
  );
  const at = toScale
    ? scaledCenters(rootedTree(project.segments, project.nodes.map((n) => n.id), rootNodeId(project)), centers, pxPerMm(project.segments.map((s) => s.length_mm)))
    : centers;

  const xs = project.nodes.flatMap((n) => [at.get(n.id)!.x - size(n.id).width / 2, at.get(n.id)!.x + size(n.id).width / 2]);
  const ys = project.nodes.flatMap((n) => [at.get(n.id)!.y - size(n.id).height / 2, at.get(n.id)!.y + size(n.id).height / 2 + 40]);
  const pad = 40;
  const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad];

  const main = project.connector_instances.find((c) => c.id === project.project.main_connector_instance_id);
  const distanceOf = (nodeId: number) => {
    const d = distances?.[String(nodeId)];
    return d !== undefined && main && nodeId !== main.node_id ? `${Math.round(d)} mm from ${main.short_id}` : null;
  };
  const segmentNote = (segmentId: number) => {
    const diameter = report.segment_diameters.find((d) => d.segment_id === segmentId)?.final_diameter_mm;
    const cut = report.covering_cuts.find((c) => c.segment_id === segmentId);
    const cover = library.covering_defs.find((c) => c.part_id === cut?.library_part_id);
    return [diameter ? `Ø${diameter.toFixed(1)}` : null, cover ? `HS ${heatShrinkSize(cover.supplied_diameter_mm)}` : null].filter(Boolean).join(" · ");
  };
  const halo = { paintOrder: "stroke", stroke: "#fff", strokeWidth: 4, strokeLinejoin: "round" } as const;

  return (
    <svg className="assembly" viewBox={box.join(" ")} style={{ maxHeight: `${maxHeightMm}mm` }} fontFamily="Arial, sans-serif" role="img" aria-label="Assembly drawing">
      {project.segments.map((s) => {
        const a = at.get(s.node_a_id);
        const b = at.get(s.node_b_id);
        if (!a || !b) return null;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const note = segmentNote(s.id);
        const onSegment = [
          ...project.splice_instances.filter((x) => x.segment_id === s.id),
          ...project.component_instances.filter((x) => x.segment_id === s.id),
        ];
        return (
          <g key={`s${s.id}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#000" strokeWidth={2.5} />
            <text x={mid.x} y={mid.y - 6} textAnchor="middle" fontSize={15} fontWeight={700} style={halo}>{s.length_mm} mm</text>
            {note && <text x={mid.x} y={mid.y + 14} textAnchor="middle" fontSize={11} style={halo}>{note}</text>}
            {onSegment.map((x) => {
              const fromA = s.length_mm > 0 ? (x.offset_from_end_mm ?? 0) / s.length_mm : 0;
              const t = Math.min(1, Math.max(0, x.offset_from_node_id === s.node_b_id ? 1 - fromA : fromA));
              const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
              return (
                <g key={x.short_id}>
                  <circle cx={p.x} cy={p.y} r={5} fill="#000" />
                  <text x={p.x} y={p.y + 30} textAnchor="middle" fontSize={11} style={halo}>{x.short_id} · {x.offset_from_end_mm ?? 0} mm</text>
                </g>
              );
            })}
          </g>
        );
      })}

      {project.nodes.map((n) => {
        const c = at.get(n.id)!;
        const connectors = project.connector_instances.filter((x) => x.node_id === n.id);
        const ground = project.ground_points.find((g) => g.node_id === n.id);
        const atNode = [
          ...project.splice_instances.filter((s) => s.node_id === n.id),
          ...project.component_instances.filter((x) => x.node_id === n.id),
        ].map((x) => x.short_id);
        const distance = distanceOf(n.id);
        if (!isBlock(project, n.id)) {
          const notes = [n.termination && n.termination !== "none" ? TERMINATION[n.termination] : null, ...atNode, distance].filter(Boolean);
          return (
            <g key={n.id}>
              <circle cx={c.x} cy={c.y} r={7} fill="#fff" stroke="#000" strokeWidth={2.5} />
              {notes.map((t, i) => (
                <text key={i} x={c.x} y={c.y + 24 + i * 13} textAnchor="middle" fontSize={11} style={halo}>{t}</text>
              ))}
            </g>
          );
        }
        // Un poco más alto que en pantalla: tercera línea para terminación / principal / pendiente.
        const w = BLOCK_SIZE.width;
        const h = 58;
        const title = connectors.length > 0
          ? connectors.map((x) => {
              const def = library.connector_defs.find((d) => d.part_id === x.library_part_id);
              return def ? `${x.short_id} ${GENDER[def.gender]}` : x.short_id;
            }).join(" / ")
          : ground?.short_id ?? `Node ${n.id}`;
        const name = connectors.map((x) => x.name).filter(Boolean).join(" / ") || ground?.name || "";
        const tags = [
          ...connectors.map((x) => (x.termination && x.termination !== "none" ? TERMINATION[x.termination] : null)),
          connectors.some((x) => x.id === main?.id) ? "main" : null,
          connectors.some((x) => x.status === "pending") ? "PENDING" : null,
          ...atNode,
        ].filter(Boolean);
        return (
          <g key={n.id}>
            <rect x={c.x - w / 2} y={c.y - h / 2} width={w} height={h} rx={4} fill="#fff" stroke="#000" strokeWidth={connectors.some((x) => x.id === main?.id) ? 3 : 1.5} strokeDasharray={connectors.some((x) => x.status === "pending") ? "6 4" : undefined} />
            <text x={c.x - w / 2 + 8} y={c.y - h / 2 + 18} fontSize={14} fontWeight={700}>{clip(name || title, 20)}</text>
            {name && <text x={c.x - w / 2 + 8} y={c.y - h / 2 + 34} fontSize={11}>{clip(title, 26)}</text>}
            {tags.length > 0 && <text x={c.x - w / 2 + 8} y={c.y - h / 2 + 50} fontSize={10}>{clip(tags.join(" · "), 30)}</text>}
            {distance && <text x={c.x} y={c.y + h / 2 + 14} fontSize={11} textAnchor="middle" style={halo}>{distance}</text>}
          </g>
        );
      })}
    </svg>
  );
}
