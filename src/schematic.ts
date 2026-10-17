/**
 * Vista esquemática pin a pin (plan 10.3), generada desde los datos: qué
 * bloques hay, qué pines muestra cada uno, qué une cada cable y dónde va cada
 * bloque. Sin React, para chequearlo con `node tools/check_schematic.ts`.
 *
 * Columnas: el conector principal a la izquierda, los puntos de unión
 * (splices, masas, componentes) en el medio y el resto de los conectores a la
 * derecha. Dentro de cada columna, cada bloque se ordena por la altura media
 * de los pines con los que se une (baricentro), para que las líneas se crucen
 * lo menos posible.
 */
import { devicePinName, type Library } from "./libraryTypes.ts";
import type { ProjectData, WireEnd } from "./types";

export const PIN_ROW = 22;
export const BLOCK_HEADER = 44;
export const BLOCK_WIDTH = 240;
const COLUMN_X = [0, 420, 760];
const GAP = 36;

export interface SchematicPin {
  /** Id de la CavityAssignment (único en el proyecto). */
  cavityId: number;
  label: string;
  /** Funciones de los cables de ese pin (o la referencia externa si sale del arnés). */
  note: string;
}

export interface SchematicBlock {
  key: string; // "c12" conector, "s3" splice, "g1" masa, "r2" componente
  kind: "connector" | "splice" | "ground" | "component";
  refId: number;
  title: string;
  subtitle: string;
  column: 0 | 1 | 2;
  pins: SchematicPin[];
  hiddenPins: number;
  x: number;
  y: number;
}

export interface SchematicLink {
  wireId: number;
  from: { block: string; cavityId: number | null };
  to: { block: string; cavityId: number | null };
  color: string | null;
  label: string;
}

export function blockHeight(b: SchematicBlock): number {
  return b.kind === "connector" ? BLOCK_HEADER + Math.max(1, b.pins.length) * PIN_ROW + (b.hiddenPins > 0 ? PIN_ROW : 0) : 28;
}

/** Altura (en el lienzo) del centro de un pin o de un punto de unión. */
export function anchorY(b: SchematicBlock, cavityId: number | null): number {
  if (b.kind !== "connector" || cavityId === null) return b.y + blockHeight(b) / 2;
  const i = b.pins.findIndex((p) => p.cavityId === cavityId);
  return b.y + BLOCK_HEADER + (i < 0 ? 0 : i) * PIN_ROW + PIN_ROW / 2;
}

export function buildSchematic(project: ProjectData, library: Library, showAllPins: boolean): { blocks: SchematicBlock[]; links: SchematicLink[] } {
  const connectorOfCavity = new Map<number, number>();
  for (const c of project.connector_instances) for (const cav of c.cavities) connectorOfCavity.set(cav.id, c.id);

  const endBlock = (e: WireEnd): { block: string; cavityId: number | null } | null => {
    if (e.kind === "cavity" && e.cavity_assignment_id != null) {
      const c = connectorOfCavity.get(e.cavity_assignment_id);
      return c === undefined ? null : { block: `c${c}`, cavityId: e.cavity_assignment_id };
    }
    if (e.kind === "splice" && e.splice_id != null) return { block: `s${e.splice_id}`, cavityId: null };
    if (e.kind === "ground" && e.ground_point_id != null) return { block: `g${e.ground_point_id}`, cavityId: null };
    if (e.kind === "component" && e.component_instance_id != null) return { block: `r${e.component_instance_id}`, cavityId: null };
    return null;
  };

  const links: SchematicLink[] = [];
  for (const w of project.wire_instances) {
    const from = endBlock(w.end_a);
    const to = endBlock(w.end_b);
    if (from && to) links.push({ wireId: w.id, from, to, color: w.color, label: w.specific_name ?? w.short_id });
  }

  const wiredCavities = new Set(links.flatMap((l) => [l.from.cavityId, l.to.cavityId]).filter((x): x is number => x !== null));
  const notesByCavity = new Map<number, string[]>();
  for (const l of links) {
    for (const end of [l.from, l.to]) {
      if (end.cavityId !== null) notesByCavity.set(end.cavityId, [...(notesByCavity.get(end.cavityId) ?? []), l.label]);
    }
  }

  // Conector principal: el marcado en el proyecto, o el que más cables tiene.
  const wiresPerConnector = (id: number) => links.filter((l) => l.from.block === `c${id}` || l.to.block === `c${id}`).length;
  const mainId =
    project.project.main_connector_instance_id ??
    [...project.connector_instances].sort((a, b) => wiresPerConnector(b.id) - wiresPerConnector(a.id))[0]?.id;

  const blocks: SchematicBlock[] = [
    ...project.connector_instances.map((c): SchematicBlock => {
      const pins = c.cavities
        .filter((cav) => showAllPins || wiredCavities.has(cav.id))
        .map((cav) => {
          const note = (notesByCavity.get(cav.id) ?? []).join(", ") || cav.external_reference || "";
          // En el conector de un dispositivo, el nombre del pin (OUT11) va primero.
          const pinName = devicePinName(library, c.device_connector_id, cav.cavity_id);
          return { cavityId: cav.id, label: cav.cavity_id, note: [pinName, note].filter(Boolean).join(" · ") };
        });
      return {
        key: `c${c.id}`,
        kind: "connector",
        refId: c.id,
        title: c.short_id,
        subtitle: c.name,
        column: c.id === mainId ? 0 : 2,
        pins,
        hiddenPins: c.cavities.length - pins.length,
        x: 0,
        y: 0,
      };
    }),
    ...project.splice_instances.map((s): SchematicBlock => ({ key: `s${s.id}`, kind: "splice", refId: s.id, title: s.short_id, subtitle: s.name, column: 1, pins: [], hiddenPins: 0, x: 0, y: 0 })),
    ...project.ground_points.map((g): SchematicBlock => ({ key: `g${g.id}`, kind: "ground", refId: g.id, title: g.short_id, subtitle: g.name, column: 1, pins: [], hiddenPins: 0, x: 0, y: 0 })),
    ...project.component_instances.map((r): SchematicBlock => ({ key: `r${r.id}`, kind: "component", refId: r.id, title: r.short_id, subtitle: r.name, column: 1, pins: [], hiddenPins: 0, x: 0, y: 0 })),
  ];
  // Un punto de unión sin cables no aporta nada al esquema.
  const linkedBlocks = new Set(links.flatMap((l) => [l.from.block, l.to.block]));
  const shown = blocks.filter((b) => b.kind === "connector" || linkedBlocks.has(b.key));
  const byKey = new Map(shown.map((b) => [b.key, b]));

  // Ubicar columna por columna; cada una se ordena por el baricentro de sus vínculos con las ya ubicadas.
  const placed = new Set<string>();
  for (const column of [0, 1, 2] as const) {
    const inColumn = shown.filter((b) => b.column === column);
    const barycenter = (b: SchematicBlock) => {
      const ys = links.flatMap((l) => {
        const [mine, other] = l.from.block === b.key ? [l.from, l.to] : l.to.block === b.key ? [l.to, l.from] : [null, null];
        if (!mine || !other || !placed.has(other.block)) return [];
        return [anchorY(byKey.get(other.block)!, other.cavityId)];
      });
      return ys.length > 0 ? ys.reduce((a, y) => a + y, 0) / ys.length : Number.POSITIVE_INFINITY;
    };
    const order = inColumn.map((b) => ({ b, key: barycenter(b) })).sort((a, z) => a.key - z.key || a.b.title.localeCompare(z.b.title, undefined, { numeric: true }));
    // La primera columna se apila desde arriba; las demás, a la altura de sus
    // vínculos (centradas en el baricentro), sin encimarse con el bloque anterior.
    let nextFree = 0;
    for (const { b, key } of order) {
      b.x = COLUMN_X[column] + (b.kind === "connector" ? 0 : BLOCK_WIDTH / 2 - 14);
      const target = column > 0 && Number.isFinite(key) ? key - blockHeight(b) / 2 : nextFree;
      b.y = Math.max(nextFree, target);
      nextFree = b.y + blockHeight(b) + GAP;
      placed.add(b.key);
    }
  }
  return { blocks: shown, links };
}
