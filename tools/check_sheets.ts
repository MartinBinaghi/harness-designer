// Chequeo de las hojas imprimibles (lista de corte, pinout, etiquetas). Uso: node tools/check_sheets.ts
import assert from "node:assert/strict";
import { colorWord, connectorHeatShrink, cutListGroups, cutListRows, heatShrinkSize, labelRows, pinoutRows, terminatesAt, toCsv, wireTotals } from "../src/sheets.ts";
import type { Library } from "../src/libraryTypes.ts";
import type { ProjectData } from "../src/types.ts";

const cav = (id: number, pin: string, extra = {}) => ({ id, cavity_id: pin, external_reference: null, ...extra });
const conn = (id: number, short_id: string, name: string, cavities: ReturnType<typeof cav>[]) => ({ id, short_id, name, library_part_id: 1, node_id: id, cavities });
const end = (kind: string, ids: { cavity?: number; splice?: number; ground?: number }) => ({ kind, cavity_assignment_id: ids.cavity ?? null, splice_id: ids.splice ?? null, ground_point_id: ids.ground ?? null, component_instance_id: null });
const wire = (id: number, part: number, name: string, a: ReturnType<typeof end>, b: ReturnType<typeof end>) => ({ id, short_id: `W00${id}`, library_part_id: part, color: "red", signal_type_id: null, specific_name: name, label: id === 1 ? "5V REF" : null, end_a: a, end_b: b });

// X1 pin 1 → SP1 → X2 pin 1 y X3 pin 1 (net de 3 cables); X1 pin 2 → G1; X1 pin 3 con tapón; pin 4 con referencia externa.
const project = {
  project: { name: "Engine", harness_code: "MOT-01", main_connector_instance_id: 1 },
  connector_instances: [
    conn(1, "X1", "ECU", [cav(11, "1"), cav(12, "2"), cav(13, "3"), cav(14, "4", { external_reference: "Dash CAN" })]),
    conn(2, "X2", "MAP", [cav(21, "1")]),
    conn(3, "X3", "TPS", [cav(31, "1")]),
  ],
  splice_instances: [{ id: 1, short_id: "SP1" }],
  ground_points: [{ id: 1, short_id: "G1", name: "Chassis" }],
  component_instances: [],
  twist_groups: [{ id: 1, name: "twist I", wire_instance_ids: [2, 4] }],
  wire_instances: [
    wire(1, 20, "5V", end("cavity", { cavity: 11 }), end("splice", { splice: 1 })),
    wire(2, 20, "5V", end("splice", { splice: 1 }), end("cavity", { cavity: 21 })),
    wire(3, 21, "5V", end("splice", { splice: 1 }), end("cavity", { cavity: 31 })),
    wire(4, 21, "GND", end("cavity", { cavity: 12 }), end("ground", { ground: 1 })),
  ],
} as unknown as ProjectData;
const library = {
  parts: [],
  signal_types: [],
  device_defs: [],
  wire_defs: [{ part_id: 20, gauge: "22 AWG", spec: "M22759/32" }, { part_id: 21, gauge: "20 AWG", spec: null }],
} as unknown as Library;
const cuts = [
  { wire_id: 1, length_with_twist_mm: 100, margin_pct: 10, twist_min_margin_pct: 2, cut_length_mm: 110 },
  { wire_id: 2, length_with_twist_mm: 300, margin_pct: 10, twist_min_margin_pct: 2, cut_length_mm: 330 },
  { wire_id: 3, length_with_twist_mm: 200, margin_pct: 10, twist_min_margin_pct: 2, cut_length_mm: 220 },
  { wire_id: 4, length_with_twist_mm: 50, margin_pct: 10, twist_min_margin_pct: 2, cut_length_mm: 55 },
];
const net = (id: number) => (id === 4 ? [4] : [1, 2, 3]);

// Por largo: 330, 220, 110, 55 — pero W004 sube junto a W002 (mismo trenzado).
assert.deepEqual(cutListRows(project, library, cuts, "length").map((r) => r.id), ["W002", "W004", "W003", "W001"]);
// Por tipo de cable: 20 AWG antes que 22 AWG; dentro, de más largo a más corto; el trenzado sigue junto.
const byType = cutListRows(project, library, cuts, "type");
assert.deepEqual(byType.map((r) => r.id), ["W003", "W004", "W002", "W001"]);
assert.equal(byType[2].wireType, "22 AWG M22759/32");
assert.equal(byType[2].from, "SP1");
// Dividida por conector, cada cable una sola vez: W001 (X1 → SP1) va con X1, el principal;
// W002 (SP1 → X2) con X2; W003 (SP1 → X3) con X3. W004 (X1 → G1) va con X1, pero está
// trenzado con W002 y el trenzado va entero al bloque de su primer cable (por largo: W002 → X2).
const groups = cutListGroups(project, cutListRows(project, library, cuts, "length"));
assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => r.id)]), [["X1 · ECU", ["W001"]], ["X2 · MAP", ["W002", "W004"]], ["X3 · TPS", ["W003"]]]);
// Por pin del conector de cada bloque: X1 tiene W001 (pin 1) y W004 (pin 2).
const byPin = cutListGroups({ ...project, twist_groups: [] }, cutListRows({ ...project, twist_groups: [] }, library, cuts, "pin"));
assert.deepEqual(byPin.find((g) => g.connectorId === 1)!.rows.map((r) => [r.id, r.pin]), [["W001", "1"], ["W004", "2"]]);
// Totales por tipo, en metros.
assert.deepEqual(wireTotals(byType), [{ wireType: "20 AWG", count: 2, meters: 0.275 }, { wireType: "22 AWG M22759/32", count: 2, meters: 0.44 }]);

// Termina en: los otros pines de la net, pasando por el splice.
assert.equal(terminatesAt(project, library, 11, net), "X2:1 · MAP, X3:1 · TPS (via SP1)");
assert.equal(terminatesAt(project, library, 21, net), "X1:1 · ECU, X3:1 · TPS (via SP1)");
assert.equal(terminatesAt(project, library, 12, net), "G1 · Chassis");

// Pinout con el formato del taller: un renglón por vía; sin cable, "n/c" y la referencia externa.
assert.deepEqual(pinoutRows(project, library, 1, net), [
  { pin: "1", fn: "5V", goesTo: "X2:1 · MAP, X3:1 · TPS (via SP1)" },
  { pin: "2", fn: "GND", goesTo: "G1 · Chassis" },
  { pin: "3", fn: "n/c", goesTo: "" },
  { pin: "4", fn: "n/c", goesTo: "Dash CAN" },
]);

// Etiquetas: arnés en el conector principal, cada conector, cables con etiqueta.
assert.deepEqual(labelRows(project), [["Harness", "X1", "Engine · MOT-01"], ["Connector", "X1", "ECU"], ["Connector", "X2", "MAP"], ["Connector", "X3", "TPS"], ["Wire", "W001", "5V REF"]]);
assert.equal(toCsv(["a", "b"], [["x, y", 'say "hi"']]), 'a,b\r\n"x, y","say ""hi"""\r\n');

// Color en palabras (hoja en blanco y negro): texto tal cual; un código hex, al nombre más parecido.
assert.equal(colorWord("violet"), "violet");
assert.equal(colorWord("#7f00ff"), "violet");
assert.equal(colorWord(null), "—");
assert.equal(cutListRows(project, library, cuts, "pin").find((r) => r.id === "W001")!.color, "red");

// Termocontraíble: medida nominal en pulgadas del suministrado.
assert.equal(heatShrinkSize(3.2), '1/8"');
assert.equal(heatShrinkSize(4.8), '3/16"');
assert.equal(heatShrinkSize(5.5), "5.5 mm");
// Tramo que llega a X2: asignado (1/4"); a X3: el sugerido por compute_costs; X1: ninguno sirve.
const withSegments = {
  ...project,
  segments: [
    { id: 1, node_a_id: 1, node_b_id: 9, covering_library_part_id: null },
    { id: 2, node_a_id: 9, node_b_id: 2, covering_library_part_id: 31 },
    { id: 3, node_a_id: 9, node_b_id: 3, covering_library_part_id: null },
  ],
} as unknown as ProjectData;
const covLib = { ...library, covering_defs: [{ part_id: 30, supplied_diameter_mm: 4.76 }, { part_id: 31, supplied_diameter_mm: 6.35 }] } as unknown as Library;
const diameters = [
  { segment_id: 1, bundle_diameter_mm: 7, final_diameter_mm: 7.4, covering_options: [] },
  { segment_id: 2, bundle_diameter_mm: 2, final_diameter_mm: 2.4, covering_options: [] },
  { segment_id: 3, bundle_diameter_mm: 2, final_diameter_mm: 2.4, covering_options: [{ library_part_id: 30, supplied_diameter_mm: 4.76, shrunk_diameter_mm: 2.4, fits: true }] },
];
assert.deepEqual(connectorHeatShrink(withSegments, covLib, 2, diameters), ['1/4"']);
assert.deepEqual(connectorHeatShrink(withSegments, covLib, 3, diameters), ['3/16" (suggested)']);
assert.deepEqual(connectorHeatShrink(withSegments, covLib, 1, diameters), ["none in library fits · bundle Ø 7.4 mm"]);

// Conector de un dispositivo: la función es el nombre del pin, y quien termina ahí lo ve con ese nombre.
{
  const devLib = { ...library, device_defs: [{ part_id: 9, connectors: [{ id: 3, label: "A", connector_def_id: 1, pins: [{ id: 1, cavity_id: "1", name: "OUT11", function: null }] }], pin_groups: [] }] } as unknown as Library;
  const pdm = { ...project, connector_instances: project.connector_instances.map((c) => (c.id === 2 ? { ...c, name: "PDM30", device_connector_id: 3 } : c)) } as ProjectData;
  assert.equal(pinoutRows(pdm, devLib, 2, net)[0].fn, "OUT11");
  assert.equal(terminatesAt(pdm, devLib, 11, net), "PDM30 · OUT11 (X2:1), X3:1 · TPS (via SP1)");
}

console.log("sheets: ok");
