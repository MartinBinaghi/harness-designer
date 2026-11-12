/**
 * Qué cambió entre dos estados de un arnés (pestaña Revisions): una revisión
 * congelada, el arnés abierto u otro archivo. Los elementos se emparejan por lo
 * que se ve en las hojas: conectores, cables, splices, masas y componentes por
 * su ID (X3, W012, SP4…), cada vía por su conector y su pin, los tramos y los
 * breakouts por su número. Con dos arneses distintos, iguales IDs se comparan
 * como si fueran lo mismo.
 *
 * Las partes y los tipos de señal se nombran con la biblioteca abierta. No se
 * compara la posición de los dibujos (diagrama, esquema): no cambia el arnés.
 * Funciones puras, chequeadas en tests/revisionDiff.test.ts.
 */
import { partLabel, type Library } from "../model/library.ts";
import type { ProjectData, WireEnd, WireInstance } from "../model/project";
import { endLabel } from "./projectEdit.ts";
import { nodeName, wireFunction, wireType } from "./sheets.ts";
import { NODE_TERMINATION_LABELS } from "./nodeLabels.ts";

export type ChangeKind = "added" | "removed" | "changed";

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface ItemChange {
  kind: ChangeKind;
  /** "X3 · MOTOR", "W012 · 12V+ Coils", "S4 · X1 ↔ Breakout 7". */
  label: string;
  /** Solo en los que cambiaron. */
  changes: FieldChange[];
}

export interface DiffSection {
  title: string;
  items: ItemChange[];
}

const EMPTY = "—";

/** Un valor como texto para mostrar: vacío o nulo es "—". */
function show(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Arma la lista de cambios de un campo: solo si el texto que se ve es distinto. */
function fields(pairs: [field: string, before: string | number | boolean | null | undefined, after: string | number | boolean | null | undefined][]): FieldChange[] {
  return pairs.map(([field, a, b]) => ({ field, before: show(a), after: show(b) })).filter((c) => c.before !== c.after);
}

/**
 * Empareja dos listas por clave: lo que está solo en la de después se agregó,
 * lo que está solo en la de antes se sacó, y lo que está en las dos cambió si
 * algún campo difiere. Ordenado por clave (X2 antes que X10).
 */
function matchBy<T>(before: T[], after: T[], key: (item: T) => string, label: (item: T, side: "before" | "after") => string, compare: (a: T, b: T) => FieldChange[]): ItemChange[] {
  const old = new Map(before.map((item) => [key(item), item]));
  const now = new Map(after.map((item) => [key(item), item]));
  const keys = [...new Set([...old.keys(), ...now.keys()])].sort(natural);
  const out: ItemChange[] = [];
  for (const k of keys) {
    const a = old.get(k);
    const b = now.get(k);
    if (a && b) {
      const changes = compare(a, b);
      if (changes.length) out.push({ kind: "changed", label: label(b, "after"), changes });
    } else if (b) out.push({ kind: "added", label: label(b, "after"), changes: [] });
    else if (a) out.push({ kind: "removed", label: label(a, "before"), changes: [] });
  }
  return out;
}

const named = (shortId: string, name: string | null | undefined) => (name ? `${shortId} · ${name}` : shortId);

/** Dónde está un splice o componente: en un nodo, o sobre un tramo a X mm de una punta. */
function placeOf(project: ProjectData, item: { node_id: number | null; segment_id: number | null; offset_from_end_mm: number | null; offset_from_node_id: number | null }): string {
  if (item.node_id != null) return `at ${nodeName(project, item.node_id)}`;
  if (item.segment_id == null) return EMPTY;
  const from = item.offset_from_node_id != null ? ` from ${nodeName(project, item.offset_from_node_id)}` : "";
  return `on S${item.segment_id}, ${show(item.offset_from_end_mm)} mm${from}`;
}

/** Lo que hay en una vía: sus cables con su función y a dónde van; sin cable, "n/c". */
function pinContents(project: ProjectData, library: Library, cavityAssignmentId: number): string {
  const wires = project.wire_instances
    .filter((w) => w.end_a.cavity_assignment_id === cavityAssignmentId || w.end_b.cavity_assignment_id === cavityAssignmentId)
    .sort((a, b) => natural(a.short_id, b.short_id));
  if (wires.length === 0) return "n/c";
  return wires
    .map((w) => {
      const other: WireEnd = w.end_a.kind === "cavity" && w.end_a.cavity_assignment_id === cavityAssignmentId ? w.end_b : w.end_a;
      return `${w.short_id} ${wireFunction(library, w)} → ${endLabel(project, other)}`;
    })
    .join(" + ");
}

/** Las dos puntas de un cable, sin importar cuál es la A: "X1:3 ↔ X3:EE". */
function endsOf(project: ProjectData, wire: WireInstance): string {
  return [endLabel(project, wire.end_a), endLabel(project, wire.end_b)].sort(natural).join(" ↔ ");
}

function segmentLabel(project: ProjectData, seg: { id: number; node_a_id: number; node_b_id: number }): string {
  return `S${seg.id} · ${nodeName(project, seg.node_a_id)} ↔ ${nodeName(project, seg.node_b_id)}`;
}

export function compareProjects(before: ProjectData, after: ProjectData, library: Library): DiffSection[] {
  const signal = (id: number | null) => library.signal_types.find((t) => t.id === id)?.name ?? (id == null ? null : `#${id}`);
  const mainOf = (p: ProjectData) => p.connector_instances.find((c) => c.id === p.project.main_connector_instance_id)?.short_id ?? null;
  const spares = (p: ProjectData) =>
    Object.entries(p.project.spare_pcts)
      .filter(([, pct]) => pct)
      .sort(([a], [b]) => natural(a, b))
      .map(([category, pct]) => `${category} ${pct}%`)
      .join(", ");

  const a = before.project;
  const b = after.project;
  const harness = fields([
    ["Name", a.name, b.name],
    ["Code", a.harness_code, b.harness_code],
    ["Client", a.client, b.client],
    ["Main connector", mainOf(before), mainOf(after)],
    ["Cut margin %", a.default_cut_margin_pct, b.default_cut_margin_pct],
    ["Twist pitch (× bundle Ø)", a.default_twist_pitch_factor, b.default_twist_pitch_factor],
    ["Fill factor", a.fill_factor, b.fill_factor],
    ["Cut lengths rounded to (mm)", a.cut_round_mm, b.cut_round_mm],
    ["Labor hours", a.labor_hours, b.labor_hours],
    ["Labor rate (USD/h)", a.labor_rate_usd, b.labor_rate_usd],
    ["Markup %", a.markup_pct, b.markup_pct],
    ["Materials cost on", a.cost_on_purchased ? "purchased" : "used", b.cost_on_purchased ? "purchased" : "used"],
    ["Spare", spares(before), spares(after)],
  ]);

  const deviceLabel = (id: number | null) => {
    if (id == null) return null;
    for (const dd of library.device_defs) {
      const dc = dd.connectors.find((c) => c.id === id);
      if (dc) return `${partLabel(library, dd.part_id)} · ${dc.label}`;
    }
    return `#${id}`;
  };
  const termination = (kind: string | null, partId: number | null) => (kind ? (partId != null ? `${kind} · ${partLabel(library, partId)}` : kind) : null);
  const connectors = matchBy(
    before.connector_instances,
    after.connector_instances,
    (c) => c.short_id,
    (c) => named(c.short_id, c.name),
    (x, y) => {
      const pins = [...new Set([...x.cavities.map((c) => c.cavity_id), ...y.cavities.map((c) => c.cavity_id)])].sort(natural);
      const pinChanges = pins.flatMap((pin) => {
        const cx = x.cavities.find((c) => c.cavity_id === pin);
        const cy = y.cavities.find((c) => c.cavity_id === pin);
        const out = fields([
          [`Pin ${pin}`, cx ? pinContents(before, library, cx.id) : "(no such pin)", cy ? pinContents(after, library, cy.id) : "(no such pin)"],
          [`Pin ${pin} · external reference`, cx?.external_reference, cy?.external_reference],
        ]);
        return out;
      });
      return [
        ...fields([
          ["Name", x.name, y.name],
          ["Part", partLabel(library, x.library_part_id), partLabel(library, y.library_part_id)],
          ["Device", deviceLabel(x.device_connector_id), deviceLabel(y.device_connector_id)],
          ["Status", x.status, y.status],
          ["Termination", termination(x.termination, x.termination_library_part_id), termination(y.termination, y.termination_library_part_id)],
          ["Backshell", x.backshell_library_part_id != null ? partLabel(library, x.backshell_library_part_id) : null, y.backshell_library_part_id != null ? partLabel(library, y.backshell_library_part_id) : null],
          ["Interconnection", x.is_interconnect, y.is_interconnect],
          ["Mates with", x.mates_with, y.mates_with],
        ]),
        ...pinChanges,
      ];
    },
  );

  const cableOf = (p: ProjectData, w: WireInstance) => p.cable_instances.find((c) => c.id === w.cable_instance_id)?.short_id ?? null;
  const twistOf = (p: ProjectData, w: WireInstance) =>
    p.twist_groups
      .filter((g) => g.wire_instance_ids.includes(w.id))
      .map((g) => g.name)
      .join(", ");
  const wires = matchBy(
    before.wire_instances,
    after.wire_instances,
    (w) => w.short_id,
    (w) => named(w.short_id, w.specific_name),
    (x, y) =>
      fields([
        ["Function", x.specific_name, y.specific_name],
        ["Signal type", signal(x.signal_type_id), signal(y.signal_type_id)],
        ["Ends", endsOf(before, x), endsOf(after, y)],
        ["Wire type", wireType(library, x), wireType(library, y)],
        ["Color", x.color, y.color],
        ["Length by hand (mm)", x.manual_length_mm, y.manual_length_mm],
        ["Cut margin %", x.manual_cut_margin_pct, y.manual_cut_margin_pct],
        ["Label", x.label, y.label],
        ["Bought cable", cableOf(before, x), cableOf(after, y)],
        ["Twist group", twistOf(before, x), twistOf(after, y)],
      ]),
  );

  const junctions = [
    ...matchBy(
      before.splice_instances,
      after.splice_instances,
      (s) => s.short_id,
      (s) => named(s.short_id, s.name),
      (x, y) =>
        fields([
          ["Name", x.name, y.name],
          ["Part", partLabel(library, x.library_part_id), partLabel(library, y.library_part_id)],
          ["Place", placeOf(before, x), placeOf(after, y)],
        ]),
    ),
    ...matchBy(
      before.ground_points,
      after.ground_points,
      (g) => g.short_id,
      (g) => named(g.short_id, g.name),
      (x, y) =>
        fields([
          ["Name", x.name, y.name],
          ["Terminal", x.terminal_library_part_id != null ? partLabel(library, x.terminal_library_part_id) : null, y.terminal_library_part_id != null ? partLabel(library, y.terminal_library_part_id) : null],
        ]),
    ),
    ...matchBy(
      before.component_instances,
      after.component_instances,
      (c) => c.short_id,
      (c) => named(c.short_id, c.name),
      (x, y) =>
        fields([
          ["Name", x.name, y.name],
          ["Part", partLabel(library, x.library_part_id), partLabel(library, y.library_part_id)],
          ["Place", placeOf(before, x), placeOf(after, y)],
        ]),
    ),
  ];

  const covering = (id: number | null) => (id != null ? partLabel(library, id) : null);
  const segments = matchBy(
    before.segments,
    after.segments,
    (s) => String(s.id),
    (s, side) => segmentLabel(side === "before" ? before : after, s),
    (x, y) =>
      fields([
        ["Between", segmentLabel(before, x).replace(/^S\d+ · /, ""), segmentLabel(after, y).replace(/^S\d+ · /, "")],
        ["Length (mm)", x.length_mm, y.length_mm],
        ["Twist pitch (mm)", x.twist_pitch_mm, y.twist_pitch_mm],
        ["Heat-shrink", covering(x.covering_library_part_id), covering(y.covering_library_part_id)],
        ["Leaves backward", x.leaves_backward, y.leaves_backward],
      ]),
  );
  const breakoutTermination = (n: ProjectData["nodes"][number]) =>
    n.termination ? [NODE_TERMINATION_LABELS[n.termination], n.termination_library_part_id != null ? partLabel(library, n.termination_library_part_id) : ""].filter(Boolean).join(" · ") : null;
  const breakouts = matchBy(
    before.nodes.filter((n) => n.kind === "breakout"),
    after.nodes.filter((n) => n.kind === "breakout"),
    (n) => String(n.id),
    (n) => `Breakout ${n.id}`,
    (x, y) =>
      fields([
        ["Termination", breakoutTermination(x), breakoutTermination(y)],
        ["Adhesive heat-shrink (mm)", x.adhesive_heatshrink_length_mm, y.adhesive_heatshrink_length_mm],
        ["Through the boot's small end", x.termination_segment_ids.map((id) => `S${id}`).join(", "), y.termination_segment_ids.map((id) => `S${id}`).join(", ")],
      ]),
  );

  const groupWires = (p: ProjectData, ids: number[]) =>
    ids
      .map((id) => p.wire_instances.find((w) => w.id === id)?.short_id ?? `#${id}`)
      .sort(natural)
      .join(", ");
  const conductors = (p: ProjectData, cableId: number) =>
    p.wire_instances
      .filter((w) => w.cable_instance_id === cableId)
      .map((w) => w.short_id)
      .sort(natural)
      .join(", ");
  const groups = [
    ...matchBy(
      before.twist_groups,
      after.twist_groups,
      (g) => g.name,
      (g) => `Twist group ${g.name}`,
      (x, y) =>
        fields([
          ["Wires", groupWires(before, x.wire_instance_ids), groupWires(after, y.wire_instance_ids)],
          ["Shielded", x.shielded, y.shielded],
          ["Drain", x.drain, y.drain],
        ]),
    ),
    ...matchBy(
      before.cable_instances,
      after.cable_instances,
      (c) => c.short_id,
      (c) => `Bought cable ${c.short_id}`,
      (x, y) =>
        fields([
          ["Part", partLabel(library, x.library_part_id), partLabel(library, y.library_part_id)],
          ["Conductors", conductors(before, x.id), conductors(after, y.id)],
        ]),
    ),
  ];

  return [
    { title: "Harness", items: harness.length ? [{ kind: "changed" as const, label: "Harness data", changes: harness }] : [] },
    { title: "Connectors", items: connectors },
    { title: "Wires", items: wires },
    { title: "Splices, grounds and components", items: junctions },
    { title: "Topology", items: [...segments, ...breakouts] },
    { title: "Twist groups and bought cables", items: groups },
  ].filter((s) => s.items.length > 0);
}
