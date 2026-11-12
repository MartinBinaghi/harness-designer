/**
 * Pegar el pinout de un conector (pedido de Martin del 2026-11-12): una tabla
 * copiada de un Excel o un PDF, una fila por vía — Pin · Función · Termina en,
 * y si están, categoría, tipo de cable y color —, en el conector elegido de la
 * pestaña Connectors. Cada fila hace lo mismo que escribir esa fila a mano en
 * el pinout: crea el cable en la vía (o, con "replace", cambia el primero que
 * ya tenga) con su función, categoría (y su color sugerido), destino, tipo y
 * color. Una celda vacía no borra nada.
 */
import type { GaugeFacts } from "../model/calc";
import type { ConnectorInstance, ProjectData, WireEnd } from "../model/project";
import type { Library } from "../model/library";
import { addWireAtCavity, parseEnd, patchItem, setOtherEnd, setWireType, wireCategoryPatch, wiresAtCavity } from "./projectEdit.ts";
import { matchCavity } from "./devicePins.ts";

export type PinoutRole = "cavity" | "function" | "category" | "goesTo" | "wireType" | "color" | "ignore";

export const PINOUT_ROLE_LABELS: Record<PinoutRole, string> = {
  cavity: "Pin",
  function: "Function",
  category: "Category",
  goesTo: "Goes to",
  wireType: "Wire type",
  color: "Color",
  ignore: "Ignore",
};

/** Por el encabezado, si la primera fila lo tiene (en castellano o en inglés); si no, Pin · Función · Termina en. */
export function guessPinoutRoles(rows: string[][]): PinoutRole[] {
  const columns = Math.max(0, ...rows.map((r) => r.length));
  const byPosition = Array.from({ length: columns }, (_, i): PinoutRole => (["cavity", "function", "goesTo"] as const)[i] ?? "ignore");
  const header = rows[0] ?? [];
  const rules: [RegExp, PinoutRole][] = [
    [/^(pin|v[ií]a|cav)/i, "cavity"],
    [/termina|goes|destin|^to$|hacia|va a/i, "goesTo"],
    [/categ|se[ñn]al|signal/i, "category"],
    [/color/i, "color"],
    [/cable|wire|awg|calibre|tipo/i, "wireType"],
    [/func|nombre|name/i, "function"],
  ];
  const guessed = header.map((h) => rules.find(([re]) => re.test(h.trim()))?.[1] ?? "ignore");
  const found = new Set(guessed.filter((r) => r !== "ignore"));
  // Un encabezado de verdad tiene al menos la vía y otra columna, sin repetir.
  const isHeader = found.has("cavity") && found.size >= 2 && found.size === guessed.filter((r) => r !== "ignore").length;
  return isHeader ? Array.from({ length: columns }, (_, i) => guessed[i] ?? "ignore") : byPosition;
}

/** Tipo de cable escrito: el nombre que muestra el pinout ("22 AWG · M22759/32"), el número de parte o el calibre si es uno solo. */
export function matchWireType(library: Library, text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const label = (d: Library["wire_defs"][number]) => `${d.gauge}${d.spec ? ` · ${d.spec}` : ""}`.toLowerCase();
  const exact = library.wire_defs.find((d) => label(d) === t || library.parts.find((p) => p.id === d.part_id)?.part_number.toLowerCase() === t);
  if (exact) return exact.part_id;
  const byGauge = library.wire_defs.filter((d) => d.gauge.toLowerCase() === t);
  return byGauge.length === 1 ? byGauge[0].part_id : null;
}

export interface PinoutPasteRow {
  /** La vía del conector (id de CavityAssignment), o null: encabezado, vía que no existe, "n/c". */
  cavityId: number | null;
  /** Lo que se reconoció de la fila (null = la columna no está o la celda está vacía). */
  fn: string | null;
  signalTypeId: number | null;
  wireTypeId: number | null;
  color: string | null;
  end: WireEnd | null;
  /** Cables que ya tiene la vía. */
  existing: number;
  /** Lo que no se pudo leer, para la vista previa ("Goes to X9:1 not found"). */
  problems: string[];
}

export function previewPinoutPaste(project: ProjectData, library: Library, connector: ConnectorInstance, rows: string[][], roles: PinoutRole[]): PinoutPasteRow[] {
  const ids = connector.cavities.map((c) => c.cavity_id);
  return rows.map((row) => {
    const cell = (role: PinoutRole) => {
      const i = roles.indexOf(role);
      const v = i >= 0 ? (row[i] ?? "").trim() : "";
      return v && !/^(n\/?c|—|-)$/i.test(v) ? v : null;
    };
    const problems: string[] = [];
    const pin = cell("cavity");
    // "X3:EE" también es la vía EE de X3.
    const match = pin ? matchCavity(pin, ids, `${connector.short_id}:`) : null;
    const cavityId = connector.cavities.find((c) => c.cavity_id === match)?.id ?? null;
    const fn = cell("function");
    const typeText = cell("category");
    const signalTypeId = typeText ? (library.signal_types.find((t) => t.name.toLowerCase() === typeText.toLowerCase())?.id ?? null) : null;
    if (typeText && signalTypeId === null) problems.push(`category "${typeText}" not in the library`);
    const wireText = cell("wireType");
    const wireTypeId = wireText ? matchWireType(library, wireText) : null;
    if (wireText && wireTypeId === null) problems.push(`wire type "${wireText}" not found`);
    const goesTo = cell("goesTo");
    const end = goesTo ? parseEnd(project, library, goesTo) : null;
    if (goesTo && !end) problems.push(`"${goesTo}" isn't a pin, splice or ground of this project`);
    const hasData = fn !== null || goesTo !== null || typeText !== null || wireText !== null || cell("color") !== null;
    return {
      cavityId: hasData ? cavityId : null,
      fn,
      signalTypeId,
      wireTypeId,
      color: cell("color"),
      end,
      existing: cavityId === null ? 0 : wiresAtCavity(project, cavityId).length,
      // En una fila que no va a ninguna vía (el encabezado, otra carcasa) no hay nada que avisar.
      problems: cavityId === null ? [] : problems,
    };
  });
}

/**
 * Aplica las filas con vía. Sin `replace`, las vías que ya tienen cable no se
 * tocan; con `replace`, se cambia su primer cable con lo que trae la fila.
 */
export function applyPinoutPaste(project: ProjectData, library: Library, gauges: GaugeFacts | null, rows: PinoutPasteRow[], replace: boolean): { project: ProjectData; created: number; changed: number; skipped: number; errors: string[] } {
  let p = project;
  let [created, changed, skipped] = [0, 0, 0];
  const errors: string[] = [];
  for (const r of rows) {
    if (r.cavityId === null) continue;
    const existing = wiresAtCavity(p, r.cavityId)[0];
    if (existing && !replace) {
      skipped++;
      continue;
    }
    let wireId = existing?.id;
    if (wireId === undefined) {
      const made = addWireAtCavity(p, library, gauges, r.cavityId);
      if (typeof made === "string") {
        errors.push(made);
        continue;
      }
      [p, wireId] = [made.project, made.wireId];
      created++;
    } else changed++;
    const wire = () => p.wire_instances.find((w) => w.id === wireId)!;
    if (r.fn !== null) p = patchItem(p, "wire_instances", wireId, { specific_name: r.fn });
    if (r.signalTypeId !== null) p = patchItem(p, "wire_instances", wireId, wireCategoryPatch(library, wire(), r.signalTypeId));
    if (r.color !== null) p = patchItem(p, "wire_instances", wireId, { color: r.color });
    if (r.wireTypeId !== null) p = setWireType(p, wireId, r.wireTypeId);
    if (r.end) {
      const moved = setOtherEnd(p, wireId, r.cavityId, r.end);
      if (typeof moved === "string") errors.push(moved);
      else p = moved;
    }
  }
  return { project: p, created, changed, skipped, errors };
}
