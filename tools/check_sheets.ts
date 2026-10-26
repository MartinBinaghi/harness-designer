// Chequeo de las hojas imprimibles (lista de corte, pinout, etiquetas). Uso: node tools/check_sheets.ts
import assert from "node:assert/strict";
import { assemblyBranches, colorWord, connectorHeatShrink, coveringRows, pageChunks, wireNets, cutListGroups, cutListRows, heatShrinkSize, labelRows, pinoutRows, terminatesAt, terminationRows, toCsv, wireTotals } from "../src/sheets.ts";
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
  segments: [],
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
  const devLib = { ...library, device_defs: [{ part_id: 9, connectors: [{ id: 3, label: "A", connector_def_id: 1, pins: [{ id: 1, cavity_id: "1", name: "OUT11", function: null }] }] }] } as unknown as Library;
  const pdm = { ...project, connector_instances: project.connector_instances.map((c) => (c.id === 2 ? { ...c, name: "PDM30", device_connector_id: 3 } : c)) } as ProjectData;
  assert.equal(pinoutRows(pdm, devLib, 2, net)[0].fn, "OUT11");
  assert.equal(terminatesAt(pdm, devLib, 11, net), "PDM30 · OUT11 (X2:1), X3:1 · TPS (via SP1)");
  // En la lista de corte, el extremo lleva el nombre del pin.
  assert.equal(cutListRows(pdm, devLib, cuts, "pin").find((r) => r.id === "W002")!.to, "X2:1 OUT11");
}

// Coberturas: un tramo por segmento, entre sus puntas, con la medida nominal; y lo que va en cada punta.
{
  const p = {
    ...withSegments,
    nodes: [{ id: 9, kind: "breakout", termination: "t_mold", termination_library_part_id: 40 }],
    connector_instances: withSegments.connector_instances.map((c) =>
      c.id === 2 ? { ...c, termination: "boot_90", termination_library_part_id: null } : c.id === 3 ? { ...c, termination: "adhesive_heatshrink", termination_library_part_id: 31 } : c,
    ),
  } as unknown as ProjectData;
  const lib = { ...covLib, connector_defs: [{ part_id: 1, adhesive_heatshrink_length_mm: 40 }], parts: [{ id: 31, part_number: "DR-25-1/4" }, { id: 40, part_number: "T-202" }] } as unknown as Library;
  const cov = coveringRows(p, lib, [{ segment_id: 2, library_part_id: 31, suggested: false, segment_length_mm: 400, legs_mm: 30, overlap_mm: 15, cut_length_mm: 385 }]);
  assert.deepEqual(cov.map((r) => [r.between, r.size, r.part, r.cutMm]), [["Breakout 9 – X2", '1/4"', "DR-25-1/4", 385]]);
  // La pieza con adhesivo lleva el largo de su ConnectorDef (varía según el conector).
  assert.deepEqual(terminationRows(p, lib), [["X2 · MAP", "90° boot", "not chosen"], ["X3 · TPS", "Adhesive heat-shrink", '1/4" · DR-25-1/4 · cut 40 mm'], ["Breakout 9", "T-mold", "T-202"]]);
}

// Nets armadas en el frontend: igual que el backend (X1:1 → SP1 → X2:1 y X3:1 es una net; X1:2 → G1, otra).
{
  const nets = wireNets(project);
  assert.deepEqual([...nets.get(1)!].sort(), [1, 2, 3]);
  assert.deepEqual(nets.get(4), [4]);
  assert.equal(terminatesAt(project, library, 11, (id) => nets.get(id)!), "X2:1 · MAP, X3:1 · TPS (via SP1)");
}

// Del otro lado del splice (Martin): SP1 en el nodo de X1; X2 y X3 llegan por la misma rama (S1).
// Desde X2 solo se ve X1; desde X1, los dos.
{
  const tree = {
    ...project,
    connector_instances: project.connector_instances.map((c) => ({ ...c, node_id: c.id })),
    splice_instances: [{ id: 1, short_id: "SP1", name: "", node_id: 1, segment_id: null }],
    segments: [{ id: 1, node_a_id: 1, node_b_id: 4 }, { id: 2, node_a_id: 4, node_b_id: 2 }, { id: 3, node_a_id: 4, node_b_id: 3 }],
  } as unknown as ProjectData;
  const nets = wireNets(tree);
  const netOf = (id: number) => nets.get(id)!;
  assert.equal(terminatesAt(tree, library, 21, netOf), "X1:1 · ECU (via SP1)");
  assert.equal(terminatesAt(tree, library, 11, netOf), "X2:1 · MAP, X3:1 · TPS (via SP1)");
  // Si X3 llega por otra rama (directo al nodo del splice), desde X2 sí se ve.
  const branched = { ...tree, segments: [{ id: 1, node_a_id: 1, node_b_id: 2 }, { id: 2, node_a_id: 1, node_b_id: 3 }] } as unknown as ProjectData;
  assert.equal(terminatesAt(branched, library, 21, netOf), "X1:1 · ECU, X3:1 · TPS (via SP1)");
}

// Bloques largos de pinout: tramos que entran en una hoja; un renglón de varias líneas cuenta más.
{
  const rows = Array.from({ length: 61 }, (_, i) => ({ goesTo: i === 0 ? "x".repeat(110) : "X2:1" }));
  const chunks = pageChunks(rows, 182, 52, 168);
  assert.equal(chunks.flat().length, 61);
  // 1.ª hoja (168 mm, con el título): el renglón de 3 líneas (12,3 mm) + 31 de 4,9 mm; el resto en la 2.ª.
  assert.deepEqual(chunks.map((c) => c.length), [32, 29]);
  assert.deepEqual(pageChunks([], 172, 55), [[]]);
}

// Hoja de armado por breakouts: X1 (nodo 1) → 1000 → B (5) → X2 y otro B (6) → X3, G1.
// La rama más grande se numera última; las salidas, de arriba abajo en el diagrama.
{
  const tree = {
    ...project,
    nodes: [1, 2, 3, 5, 6, 7].map((id) => ({ id, kind: "breakout", diagram_y: id === 3 ? 10 : id })),
    segments: [
      { id: 1, node_a_id: 1, node_b_id: 5, length_mm: 1000 },
      { id: 2, node_a_id: 5, node_b_id: 2, length_mm: 400 },
      { id: 3, node_a_id: 5, node_b_id: 6, length_mm: 290 },
      { id: 4, node_a_id: 6, node_b_id: 3, length_mm: 200 },
      { id: 5, node_a_id: 6, node_b_id: 7, length_mm: 150 },
    ],
    ground_points: [{ id: 1, short_id: "G1", name: "Chassis", terminal_library_part_id: null, node_id: 7 }],
  } as unknown as ProjectData;
  const b = assemblyBranches(tree, { ...library, covering_defs: [] } as Library, []);
  assert.deepEqual(b.map((x) => [x.num, x.nodeId, x.parentNum, x.inLengthMm]), [[0, 1, null, 0], [1, 5, 0, 1000], [2, 6, 1, 290]]);
  assert.deepEqual(b[0].outlets.map((o) => [o.branch, o.lengthMm]), [[1, 1000]]);
  assert.deepEqual(b[1].outlets.map((o) => [o.id, o.name, o.branch]), [["X2", "MAP", null], ["", "", 2]]);
  assert.deepEqual(b[2].outlets.map((o) => o.id), ["G1", "X3"]); // G1 (y 7) arriba de X3 (y 10)
}

// "Termina en" no sigue por las masas: dos pines al mismo ojal terminan en el ojal, no uno en el otro.
{
  const grounded = {
    ...project,
    wire_instances: [
      wire(1, 20, "GND", end("cavity", { cavity: 21 }), end("ground", { ground: 1 })),
      wire(2, 20, "GND", end("cavity", { cavity: 31 }), end("ground", { ground: 1 })),
    ],
  } as unknown as ProjectData;
  const nets = wireNets(grounded);
  assert.deepEqual(nets.get(1), [1]);
  assert.equal(terminatesAt(grounded, library, 21, (id) => nets.get(id)!), "G1 · Chassis");
}

console.log("sheets: ok");
