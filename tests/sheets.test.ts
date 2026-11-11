// Chequeo de las hojas imprimibles (lista de corte, pinout, etiquetas). Uso: pnpm test (todos) o node tests/<archivo>
import assert from "node:assert/strict";
import { assemblyBranches, colorWord, swatchBackground, wireColors, connectorHeatShrink, coveringRows, paginatePinout, cutListGroups, cutListRows, cutPairGroups, heatShrinkSize, labelRows, mergeCutRows, pinoutRows, terminatesAt, terminationRows, toCsv, wireTotals , type CutRow } from "../src/logic/sheets.ts";
import type { Library } from "../src/model/library.ts";
import type { ProjectData } from "../src/model/project.ts";
import type { PinDestinations } from "../src/model/calc.ts";

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
  cable_instances: [],
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
// "Termina en" como lo calcula el núcleo (pin_destinations, con sus tests en topology.rs):
// X1:1 → X2:1 y X3:1 por SP1; X2:1 → X1:1 y X3:1 por SP1; X1:2 → G1.
const destinations = new Map([
  [11, { cavity_assignment_id: 11, ends: [end("cavity", { cavity: 21 }), end("cavity", { cavity: 31 })], via_splices: [1] }],
  [21, { cavity_assignment_id: 21, ends: [end("cavity", { cavity: 11 }), end("cavity", { cavity: 31 })], via_splices: [1] }],
  [12, { cavity_assignment_id: 12, ends: [end("ground", { ground: 1 })], via_splices: [] }],
]) as Map<number, PinDestinations>;
const destinationOf = (cavityId: number) => destinations.get(cavityId);

// Por largo: 330, 220, 110, 55 — pero W004 sube junto a W002 (mismo trenzado).
assert.deepEqual(cutListRows(project, library, cuts, [], "length").map((r) => r.id), ["W002", "W004", "W003", "W001"]);
// Por tipo de cable: 20 AWG antes que 22 AWG; dentro, de más largo a más corto; el trenzado sigue junto.
const byType = cutListRows(project, library, cuts, [], "type");
assert.deepEqual(byType.map((r) => r.id), ["W003", "W004", "W002", "W001"]);
assert.equal(byType[2].wireType, "22 AWG M22759/32");
// Dentro del mismo tipo, por color (un rollo es de un color; Martin): W001 blanco va después de W002 rojo
// aunque sea más corto; sin el color, el largo lo ponía primero.
{
  const colored = { ...project, twist_groups: [], wire_instances: project.wire_instances.map((w) => (w.id === 1 ? { ...w, color: "white" } : w)) } as ProjectData;
  assert.deepEqual(cutListRows(colored, library, cuts, [], "type").filter((r) => r.wireType === "22 AWG M22759/32").map((r) => [r.id, r.color]), [["W002", "red"], ["W001", "white"]]);
}
assert.equal(byType[2].from, "SP1");
// Dividida por conector, cada cable una sola vez: W001 (X1 → SP1) va con X1, el principal;
// W002 (SP1 → X2) con X2; W003 (SP1 → X3) con X3. W004 (X1 → G1) va con X1, pero está
// trenzado con W002 y el trenzado va entero al bloque de su primer cable (por largo: W002 → X2).
const groups = cutListGroups(project, cutListRows(project, library, cuts, [], "length"));
assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => r.id)]), [["X1 · ECU", ["W001"]], ["X2 · MAP", ["W002", "W004"]], ["X3 · TPS", ["W003"]]]);
// Por pin del conector de cada bloque: X1 tiene W001 (pin 1) y W004 (pin 2).
const byPin = cutListGroups({ ...project, twist_groups: [] }, cutListRows({ ...project, twist_groups: [] }, library, cuts, [], "pin"));
assert.deepEqual(byPin.find((g) => g.connectorId === 1)!.rows.map((r) => [r.id, r.pin]), [["W001", "1"], ["W004", "2"]]);
// Por tramo entre dos puntos (Martin: "todos los cables de ECU A a Motor"): el principal primero, después
// los conectores y al final splices y masas. El trenzado W002 + W004 va entero al bloque de su primer cable.
const pairs = (p: ProjectData) => cutPairGroups(p, cutListRows(p, library, cuts, [], "length")).map((g) => [g.title, g.rows.map((r) => r.id)]);
assert.deepEqual(pairs(project), [["X1 · ECU ↔ SP1", ["W001"]], ["X2 · MAP ↔ SP1", ["W002", "W004"]], ["X3 · TPS ↔ SP1", ["W003"]]]);
assert.deepEqual(pairs({ ...project, twist_groups: [] }), [["X1 · ECU ↔ SP1", ["W001"]], ["X1 · ECU ↔ G1 · Chassis", ["W004"]], ["X2 · MAP ↔ SP1", ["W002"]], ["X3 · TPS ↔ SP1", ["W003"]]]);
// Por un splice (Martin: el cable se corta de conector a conector y la unión se hace después): la punta en
// el splice cuenta como lo que dice "Termina en" de la otra punta; con varios, el primero de la lista (el
// principal): SP1 une X1 con X2 y X3, así que W002 (SP1 → X2) va en "X1 ↔ X2" y W001 (X1 → SP1), en el
// primero de sus destinos, X2. W003 (SP1 → X3:1, sin destinos cargados en el ejemplo) queda con el splice;
// con destinos iría en "X1 ↔ X3".
assert.deepEqual(
  cutPairGroups({ ...project, twist_groups: [] }, cutListRows({ ...project, twist_groups: [] }, library, cuts, [], "length"), destinationOf).map((g) => [g.title, g.rows.map((r) => r.id)]),
  [["X1 · ECU ↔ X2 · MAP", ["W002", "W001"]], ["X1 · ECU ↔ G1 · Chassis", ["W004"]], ["X3 · TPS ↔ SP1", ["W003"]]],
);
// Splice de tres puntas con todos los destinos (Martin: "x1 ecu - x2 map y x1 ecu - x3 tps").
{
  const all = new Map(destinations);
  all.set(31, { cavity_assignment_id: 31, ends: [end("cavity", { cavity: 11 }), end("cavity", { cavity: 21 })], via_splices: [1] } as PinDestinations);
  const p = { ...project, twist_groups: [], wire_instances: project.wire_instances.filter((w) => w.id !== 4) } as ProjectData;
  assert.deepEqual(cutPairGroups(p, cutListRows(p, library, cuts.slice(0, 3), [], "pin"), (id) => all.get(id)).map((g) => [g.title, g.rows.map((r) => r.id).sort()]), [
    ["X1 · ECU ↔ X2 · MAP", ["W001", "W002"]],
    ["X1 · ECU ↔ X3 · TPS", ["W003"]],
  ]);
}
// Suelto en el nodo de un conector (el pedal 2 de Martin): va con ese conector aunque no se conecte. X2 está
// en el nodo 2; W005 va de X1:2 suelto al nodo 2, W006 de X1:3 a X2:1; un suelto en un nodo sin conector queda aparte.
{
  const loose = (node: number) => ({ ...end("loose", {}), node_id: node });
  const p = {
    ...project,
    twist_groups: [],
    nodes: [{ id: 2, kind: "connector_end" }, { id: 9, kind: "breakout" }],
    wire_instances: [wire(5, 21, "Pedal 2", end("cavity", { cavity: 12 }), loose(2)), wire(6, 21, "Pedal 1", end("cavity", { cavity: 13 }), end("cavity", { cavity: 21 })), wire(7, 21, "Spare", end("cavity", { cavity: 14 }), loose(9))],
  } as unknown as ProjectData;
  const lengths = [5, 6, 7].map((wire_id) => ({ wire_id, length_with_twist_mm: 10, margin_pct: 10, twist_min_margin_pct: 2, cut_length_mm: 11 }));
  assert.deepEqual(cutPairGroups(p, cutListRows(p, library, lengths, [], "pin")).map((g) => [g.title, g.rows.map((r) => r.id)]), [
    ["X1 · ECU ↔ X2 · MAP", ["W006", "W005"]],
    ["X1 · ECU ↔ loose · node 9", ["W007"]],
  ]);
}
// El caso de Martin: X1:101 y X1:102 se unen en SP1 y van a X3:T. Los tres cables, en "ECU A ↔ MOTOR".
{
  const viaSplice = {
    ...project,
    twist_groups: [],
    connector_instances: [conn(1, "X1", "ECU A", [cav(1, "101"), cav(2, "102")]), conn(3, "X3", "MOTOR", [cav(3, "T")])],
    wire_instances: [
      wire(1, 21, "Throttle", end("cavity", { cavity: 1 }), end("splice", { splice: 1 })),
      wire(2, 21, "Throttle", end("cavity", { cavity: 2 }), end("splice", { splice: 1 })),
      wire(3, 21, "Throttle", end("splice", { splice: 1 }), end("cavity", { cavity: 3 })),
    ],
  } as unknown as ProjectData;
  const far = new Map([
    [1, { cavity_assignment_id: 1, ends: [end("cavity", { cavity: 3 })], via_splices: [1] }],
    [2, { cavity_assignment_id: 2, ends: [end("cavity", { cavity: 3 })], via_splices: [1] }],
    [3, { cavity_assignment_id: 3, ends: [end("cavity", { cavity: 1 }), end("cavity", { cavity: 2 })], via_splices: [1] }],
  ]) as Map<number, PinDestinations>;
  const lengths = [1, 2, 3].map((wire_id) => ({ wire_id, length_with_twist_mm: 10, margin_pct: 10, twist_min_margin_pct: 2, cut_length_mm: 11 }));
  assert.deepEqual(cutPairGroups(viaSplice, cutListRows(viaSplice, library, lengths, [], "pin"), (id) => far.get(id)).map((g) => [g.title, g.rows.length]), [["X1 · ECU A ↔ X3 · MOTOR", 3]]);
}
// Entre dos conectores, en cualquier sentido, al mismo bloque.
{
  const direct = {
    ...project,
    twist_groups: [],
    wire_instances: [wire(5, 21, "A", end("cavity", { cavity: 31 }), end("cavity", { cavity: 21 })), wire(6, 21, "B", end("cavity", { cavity: 21 }), end("cavity", { cavity: 31 }))],
  } as unknown as ProjectData;
  const lengths = [5, 6].map((wire_id) => ({ wire_id, length_with_twist_mm: 10, margin_pct: 10, twist_min_margin_pct: 2, cut_length_mm: 11 }));
  assert.deepEqual(cutPairGroups(direct, cutListRows(direct, library, lengths, [], "pin")).map((g) => [g.key, g.title, g.rows.length]), [["c2|c3", "X2 · MAP ↔ X3 · TPS", 2]]);
}
// Sin nombres: los cables iguales en un renglón con la cantidad. W002 y W004 tendrían el mismo largo
// pero W002 es de otro tipo; W003 y W005 (iguales) se juntan; un trenzado no se junta con uno suelto.
{
  const row = (id: string, wireType: string, cutMm: number, twist: string | null = null) => ({ id, wireType, color: "blue", cutMm, twist }) as CutRow;
  const merged = mergeCutRows([row("W001", "22 AWG", 1250), row("W002", "20 AWG", 1250), row("W003", "22 AWG", 1250), row("W004", "22 AWG", 1300), row("W005", "22 AWG", 1250, "twist I")]);
  assert.deepEqual(merged.map((m) => [m.wireType, m.cutMm, m.twist, m.count, m.ids]), [
    ["22 AWG", 1250, null, 2, ["W001", "W003"]],
    ["20 AWG", 1250, null, 1, ["W002"]],
    ["22 AWG", 1300, null, 1, ["W004"]],
    ["22 AWG", 1250, "twist I", 1, ["W005"]],
  ]);
}
// Totales por tipo, en metros.
assert.deepEqual(wireTotals(byType), [{ wireType: "20 AWG", count: 2, meters: 0.275 }, { wireType: "22 AWG M22759/32", count: 2, meters: 0.44 }]);

// Termina en, escrito: cada destino con su nombre, y por qué splices pasa.
assert.equal(terminatesAt(project, library, destinationOf(11)), "X2:1 · MAP, X3:1 · TPS (via SP1)");
assert.equal(terminatesAt(project, library, destinationOf(21)), "X1:1 · ECU, X3:1 · TPS (via SP1)");
assert.equal(terminatesAt(project, library, destinationOf(12)), "G1 · Chassis");
assert.equal(terminatesAt(project, library, undefined), "—");

// Pinout con el formato del taller: un renglón por vía; sin cable, "n/c" y la referencia externa.
assert.deepEqual(pinoutRows(project, library, 1, destinationOf), [
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
// Doble color: base y raya.
assert.deepEqual(wireColors("orange / white"), ["orange", "white"]);
assert.deepEqual(wireColors(null), []);
assert.equal(swatchBackground("red"), "red");
assert.equal(swatchBackground("orange/white"), "linear-gradient(135deg, orange 50%, white 50%)");
assert.equal(colorWord(null), "—");
assert.equal(cutListRows(project, library, cuts, [], "pin").find((r) => r.id === "W001")!.color, "red");

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
  assert.equal(pinoutRows(pdm, devLib, 2, destinationOf)[0].fn, "OUT11");
  assert.equal(terminatesAt(pdm, devLib, destinationOf(11)), "PDM30 · OUT11 (X2:1), X3:1 · TPS (via SP1)");
  // En la lista de corte, el extremo lleva el nombre del pin.
  assert.equal(cutListRows(pdm, devLib, cuts, [], "pin").find((r) => r.id === "W002")!.to, "X2:1 OUT11");
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

// Paginación del pinout (A4 apaisada: 181 mm por hoja, título 9, espacio entre conectores 3,5).
{
  const opts = { pageMm: 181, titleMm: 9, gapMm: 3.5, charsPerLine: 60 };
  const rows = (n: number) => Array.from({ length: n }, () => ({ goesTo: "X6:U · INTERCO" }));
  const shape = (chunks: ReturnType<typeof paginatePinout>) => chunks.map((c) => [c.block, c.rows.length, c.cont, c.newPage]);
  // ECU A y ECU B de Martin (105 vías cada una). Con 4,9 mm por renglón el 2.º tramo de la A no
  // entraba (hoja en blanco, tramo partido); y la B empezaba en hoja nueva dejando un hueco: ahora
  // arranca debajo del último tramo de la A y usa lo que queda de esa hoja.
  const ecus = paginatePinout([{ rows: rows(105), extraMm: 3 }, { rows: rows(105), extraMm: 3 }], opts);
  assert.deepEqual(shape(ecus), [
    [0, 33, false, false], [0, 35, true, true], [0, 35, true, true], [0, 2, true, true],
    [1, 31, false, false], [1, 35, true, true], [1, 35, true, true], [1, 4, true, true],
  ]);
  // Cada tramo entra con lo medido en su PDF (5,12 mm por renglón, encabezado 7,4, título 8,6, hoja 190).
  assert.ok(ecus.filter((c) => c.rows.length > 2).every((c) => c.rows.length * 5.12 + 7.4 + (c.block === 0 && !c.cont ? 8.6 : 0) <= 190));
  // Si al final de la hoja no entran ni 8 renglones del conector siguiente, empieza en la otra.
  assert.deepEqual(shape(paginatePinout([{ rows: rows(30), extraMm: 0 }, { rows: rows(10), extraMm: 0 }], opts)), [[0, 30, false, false], [1, 10, false, true]]);
  // Un renglón de varias líneas cuenta más (3 líneas = 12,55 mm); un conector sin vías, un tramo vacío.
  const long = [{ goesTo: "x".repeat(150) }, ...rows(40)];
  assert.deepEqual(shape(paginatePinout([{ rows: long, extraMm: 0 }, { rows: [], extraMm: 0 }], opts)), [[0, 31, false, false], [0, 10, true, true], [1, 0, false, false]]);
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

// Lados del breakout como en el diagrama (arnés de Martin, nodo 3): ECU A llega por la izquierda;
// MOTOR (arriba), ECU B y GND (abajo) están del mismo lado y salen hacia atrás, sin marca en el tramo;
// 12v+ B.B., a la derecha, sigue hacia adelante.
{
  const pos: Record<number, [number, number]> = { 1: [-145, 291], 2: [11, 329], 3: [378, 297], 4: [64, 219], 5: [88, 403], 6: [594, 163] };
  const tree = {
    ...project,
    nodes: Object.entries(pos).map(([id, [x, y]]) => ({ id: Number(id), kind: "breakout", diagram_x: x, diagram_y: y })),
    segments: [1, 2, 4, 5, 6].map((n, i) => ({ id: i + 1, node_a_id: n === 1 ? 1 : 3, node_b_id: n === 1 ? 3 : n, length_mm: 100, leaves_backward: false })),
    connector_instances: [],
    ground_points: [],
  } as unknown as ProjectData;
  const hub = assemblyBranches(tree, { ...library, covering_defs: [] } as Library, []).find((x) => x.nodeId === 3)!;
  assert.deepEqual(hub.outlets.map((o) => [o.nodeId, o.backward, o.above]), [[6, false, null], [4, true, true], [2, true, false], [5, true, false]]);
  // Sin posiciones en el diagrama manda la marca del tramo.
  const flagged = { ...tree, nodes: tree.nodes.map((n) => ({ ...n, diagram_x: null })), segments: tree.segments.map((s) => ({ ...s, leaves_backward: s.node_b_id === 4 })) };
  const plain = assemblyBranches(flagged, { ...library, covering_defs: [] } as Library, []).find((x) => x.nodeId === 3)!;
  assert.deepEqual(plain.outlets.filter((o) => o.backward).map((o) => o.nodeId), [4]);
}

// Cable comprado: W002 y W003 son los conductores de WC1, que va en un solo renglón con el
// largo que da el núcleo (el del más largo) y sus conductores debajo; se cuenta una vez.
{
  const inCable = {
    ...project,
    twist_groups: [],
    cable_instances: [{ id: 1, short_id: "WC1", library_part_id: 20 }],
    wire_instances: project.wire_instances.map((w) => (w.id === 2 || w.id === 3 ? { ...w, library_part_id: 20, cable_instance_id: 1 } : { ...w, cable_instance_id: null })),
  } as ProjectData;
  const rows = cutListRows(inCable, library, cuts, [{ cable_id: 1, cut_length_mm: 330 }], "length");
  assert.deepEqual(rows.map((r) => [r.id, r.cutMm, r.conductors.map((c) => c.id)]), [["WC1", 330, ["W002", "W003"]], ["W001", 110, []], ["W004", 55, []]]);
  assert.equal(rows[0].fn, "5V");
  assert.deepEqual(wireTotals(rows).find((t) => t.wireType === "22 AWG M22759/32"), { wireType: "22 AWG M22759/32", count: 2, meters: 0.44 });
}

console.log("sheets: ok");
