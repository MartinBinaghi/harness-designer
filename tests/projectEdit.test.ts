// Chequeo de las ediciones del proyecto (diagrama/tablas). Uso: pnpm test (todos) o node tests/<archivo>
import assert from "node:assert/strict";
import { addBranch, addJunction, assignConnector, connectNodes, deleteJunction, deleteNode, deleteSegment, splitSegment, wiresAtJunction } from "../src/logic/projectEdit.ts";
import type { ProjectData } from "../src/model/project.ts";
import type { Library } from "../src/model/library.ts";

const node = (id: number, kind: "connector_end" | "breakout") => ({ id, kind, termination: null, termination_library_part_id: null, diagram_x: null, diagram_y: null, adhesive_heatshrink_length_mm: null });
const seg = (id: number, a: number, b: number, len: number) => ({ id, node_a_id: a, node_b_id: b, length_mm: len, twist_pitch_mm: null, covering_library_part_id: 7 });

// 1 --S1 (301 mm)-- 2, con un splice a 250 mm del nodo 1 y otro a 30 mm del nodo 2.
const base = {
  project: {} as ProjectData["project"],
  nodes: [node(1, "connector_end"), node(2, "connector_end")],
  segments: [seg(1, 1, 2, 301)],
  connector_instances: [],
  ground_points: [],
  splice_instances: [
    { id: 1, short_id: "SP1", name: "", library_part_id: 1, node_id: null, segment_id: 1, offset_from_end_mm: 250, offset_from_node_id: 1 },
    { id: 2, short_id: "SP2", name: "", library_part_id: 1, node_id: null, segment_id: 1, offset_from_end_mm: 30, offset_from_node_id: 2 },
  ],
  component_instances: [],
  wire_instances: [],
  twist_groups: [],
} as ProjectData;

// Partir: 151 + 150 (la suma no cambia), el tramo nuevo copia la cobertura, los splices quedan a la misma distancia real.
const split = splitSegment(base, 1, { x: 10, y: 20 });
assert.ok(typeof split !== "string");
const p = split.project;
const mid = split.nodeId;
assert.equal(p.nodes.find((n) => n.id === mid)!.kind, "breakout");
const s1 = p.segments.find((s) => s.id === 1)!;
const s2 = p.segments.find((s) => s.node_a_id === mid)!;
assert.deepEqual([s1.node_a_id, s1.node_b_id, s1.length_mm], [1, mid, 151]);
assert.deepEqual([s2.node_b_id, s2.length_mm, s2.covering_library_part_id], [2, 150, 7]);
const sp1 = p.splice_instances.find((s) => s.id === 1)!;
const sp2 = p.splice_instances.find((s) => s.id === 2)!;
// SP1 estaba a 250 del nodo 1 -> segundo tramo, a 99 del breakout.
assert.deepEqual([sp1.segment_id, sp1.offset_from_node_id, sp1.offset_from_end_mm], [s2.id, mid, 99]);
// SP2 estaba a 30 del nodo 2 = 271 del nodo 1 -> segundo tramo, a 120 del breakout.
assert.deepEqual([sp2.segment_id, sp2.offset_from_end_mm], [s2.id, 120]);

// Lazos: unir dos nodos ya conectados se rechaza; un nodo suelto se puede unir.
assert.equal(typeof connectNodes(p, 1, 2), "string");
const branch = addBranch(p, mid, { x: 0, y: 0 });
assert.equal(branch.project.segments.at(-1)!.node_a_id, mid);
const loose = { ...branch.project, nodes: [...branch.project.nodes, node(99, "connector_end")] };
assert.equal(typeof connectNodes(loose, 2, 99), "object");

// Borrar: un segmento con un splice encima, o un nodo con un conector, no se borran.
assert.equal(typeof deleteSegment(p, s2.id), "string");
const library = { connector_defs: [{ part_id: 5, suggested_termination: "adhesive_heatshrink", cavities: [{ cavity_id: "1", contact_size: "20" }, { cavity_id: "2", contact_size: "20" }] }] } as unknown as Library;
const assigned = assignConnector(branch.project, library, branch.nodeId, 5, "Oil Temp");
const x = assigned.project.connector_instances[0];
assert.deepEqual([x.short_id, x.name, x.cavities.length, x.termination, x.status], ["X1", "Oil Temp", 2, "adhesive_heatshrink", "pending"]);
assert.equal(typeof deleteNode(assigned.project, branch.nodeId), "string");
const removed = deleteNode(branch.project, branch.nodeId);
assert.ok(typeof removed !== "string" && !removed.nodes.some((n) => n.id === branch.nodeId) && removed.segments.length === p.segments.length);

console.log("project edit: ok");

// Cable nuevo de pin a pin: toma el tipo de cable más usado; mismo extremo dos veces se rechaza.
{
  const { addWire } = await import("../src/logic/projectEdit.ts");
  const pin = (id: number) => ({ kind: "cavity" as const, cavity_assignment_id: id, splice_id: null, ground_point_id: null, component_instance_id: null });
  const lib = { wire_defs: [{ part_id: 20 }, { part_id: 21 }] } as unknown as Library;
  const withWires = { ...p, wire_instances: [{ library_part_id: 21, id: 4 }, { library_part_id: 21, id: 9 }] } as unknown as ProjectData;
  const added = addWire(withWires, lib, null, pin(1), pin(2));
  assert.ok(typeof added !== "string");
  const w = added.project.wire_instances.at(-1)!;
  assert.deepEqual([w.id, w.short_id, w.library_part_id], [10, "W010", 21]);
  assert.equal(typeof addWire(withWires, lib, null, pin(1), pin(1)), "string");
  assert.equal((addWire(p, lib, null, pin(1), pin(2)) as { project: ProjectData }).project.wire_instances[0].library_part_id, 20);
  console.log("project edit (wires): ok");
}

// Categoría de cable -> color sugerido; un color puesto a mano no se pisa. patchItem cambia solo el elemento pedido.
{
  const { wireCategoryPatch, patchItem } = await import("../src/logic/projectEdit.ts");
  const lib = { signal_types: [{ id: 1, name: "5V", default_color: "violet" }, { id: 2, name: "0V", default_color: "black" }] } as unknown as Library;
  const wire = (color: string | null, st: number | null) => ({ color, signal_type_id: st }) as unknown as ProjectData["wire_instances"][number];
  assert.deepEqual(wireCategoryPatch(lib, wire(null, null), 1), { signal_type_id: 1, color: "violet" });
  assert.deepEqual(wireCategoryPatch(lib, wire("violet", 1), 2), { signal_type_id: 2, color: "black" });
  assert.deepEqual(wireCategoryPatch(lib, wire("white", 1), 2), { signal_type_id: 2 });
  const patched = patchItem(p, "segments", 1, { length_mm: 999 });
  assert.deepEqual(patched.segments.map((s) => s.length_mm), p.segments.map((s) => (s.id === 1 ? 999 : s.length_mm)));
  console.log("project edit (category color, patchItem): ok");
}

// Cambiar la parte de un conector conserva las vías con el mismo nombre (y sus cables); descarta las que no existen.
{
  const { changeConnectorPart } = await import("../src/logic/projectEdit.ts");
  const lib = { connector_defs: [{ part_id: 7, cavities: [{ cavity_id: "1", contact_size: "20" }, { cavity_id: "2", contact_size: "20" }, { cavity_id: "3", contact_size: "20" }] }] } as unknown as Library;
  const before = {
    ...p,
    connector_instances: [{ id: 1, library_part_id: 5, cavities: [
      { id: 50, cavity_id: "1", external_reference: "ECU pin 12" },
      { id: 51, cavity_id: "2", external_reference: null },
      { id: 52, cavity_id: "B", external_reference: null },
    ] }],
  } as unknown as ProjectData;
  const after = changeConnectorPart(before, lib, 1, 7).connector_instances[0];
  assert.equal(after.library_part_id, 7);
  assert.deepEqual(after.cavities.map((c) => c.cavity_id), ["1", "2", "3"]);
  assert.deepEqual(after.cavities.slice(0, 2).map((c) => c.id), [50, 51]); // mismos ids -> los cables siguen enganchados
  assert.equal(after.cavities[0].external_reference, "ECU pin 12");
  assert.ok(![50, 51, 52].includes(after.cavities[2].id)); // la vía nueva tiene id propio
  console.log("project edit (change connector part keeps cavities): ok");
}

// Duplicar un conector (Martin: bobinas iguales): mismas vías y cables; los que van a un
// splice o masa siguen ahí, los que van a un pin de otro conector quedan sin destino.
{
  const { duplicateConnector } = await import("../src/logic/projectEdit.ts");
  const end = (kind: string, ids: { cavity?: number; splice?: number; ground?: number }) => ({ kind, cavity_assignment_id: ids.cavity ?? null, splice_id: ids.splice ?? null, ground_point_id: ids.ground ?? null, component_instance_id: null });
  const proj = {
    ...p,
    nodes: [{ id: 1, kind: "connector_end" }, { id: 2, kind: "connector_end" }],
    connector_instances: [
      { id: 1, short_id: "X1", name: "Motor", node_id: 1, cavities: [{ id: 11, cavity_id: "F" }] },
      { id: 14, short_id: "X14", name: "Coil 1", node_id: 2, cavities: [{ id: 141, cavity_id: "1" }, { id: 143, cavity_id: "3" }] },
    ],
    wire_instances: [
      { id: 5, short_id: "W005", specific_name: "12V+", end_a: end("cavity", { cavity: 141 }), end_b: end("splice", { splice: 1 }), manual_length_mm: 900 },
      { id: 6, short_id: "W006", specific_name: "SIGNAL", end_a: end("cavity", { cavity: 143 }), end_b: end("cavity", { cavity: 11 }) },
    ],
  } as unknown as ProjectData;
  const r = duplicateConnector(proj, 14)!;
  const copy = r.project.connector_instances.find((c) => c.id === r.id)!;
  assert.deepEqual([copy.short_id, copy.name, copy.node_id, copy.cavities.map((c) => c.cavity_id)], ["X15", "Coil 1 (copy)", 3, ["1", "3"]]);
  const added = r.project.wire_instances.slice(2);
  assert.deepEqual(added.map((w) => [w.short_id, w.specific_name, w.end_a.cavity_assignment_id, w.end_b.kind, w.end_b.splice_id, w.end_b.cavity_assignment_id, w.manual_length_mm]), [
    ["W007", "12V+", copy.cavities[0].id, "splice", 1, null, null],
    ["W008", "SIGNAL", copy.cavities[1].id, "cavity", null, null, null],
  ]);
  console.log("project edit (duplicate connector): ok");
}

// Pinout por conector: destinos escritos a mano, cables que salen de una vía, varios cables por vía.
{
  const { addWireAtCavity, deleteWire, endChoices, otherEnd, parseEnd, setOtherEnd, wiresAtCavity } = await import("../src/logic/projectEdit.ts");
  const lib = {
    wire_defs: [{ part_id: 100 }],
    device_defs: [{ part_id: 9, connectors: [{ id: 3, label: "A", connector_def_id: 1, pins: [{ id: 1, cavity_id: "A6", name: "OUT11", function: null }] }] }],
  } as unknown as Library;
  const proj = {
    ...p,
    connector_instances: [
      { id: 1, short_id: "X4", name: "Fuel pump", device_connector_id: null, cavities: [{ id: 41, cavity_id: "1" }, { id: 42, cavity_id: "2" }] },
      { id: 2, short_id: "X9", name: "PDM30", device_connector_id: 3, cavities: [{ id: 91, cavity_id: "A6" }, { id: 92, cavity_id: "a6" }] },
    ],
    ground_points: [{ id: 1, short_id: "G1" }],
    splice_instances: [{ id: 7, short_id: "SP7", name: "Coils pin 2" }],
    wire_instances: [],
    twist_groups: [],
  } as unknown as ProjectData;

  assert.ok(endChoices(proj, lib).some((c) => c.label === "PDM30 OUT11"));
  assert.equal(parseEnd(proj, lib, "X9:A6")?.cavity_assignment_id, 91);
  assert.equal(parseEnd(proj, lib, "x9:a6")?.cavity_assignment_id, 92); // la vía distingue mayúsculas
  assert.equal(parseEnd(proj, lib, "pdm30 out11")?.cavity_assignment_id, 91); // por nombre de pin del dispositivo
  assert.equal(parseEnd(proj, lib, "g1")?.ground_point_id, 1);
  assert.equal(parseEnd(proj, lib, "SP7 · Coils pin 2")?.splice_id, 7); // splice elegido por su nombre
  assert.equal(parseEnd(proj, lib, "sp7")?.splice_id, 7);
  assert.equal(parseEnd(proj, lib, "X9:B1"), null);
  // Pines en paralelo (mismo nombre en dos vías): "Goes to" lleva la vía para saber a cuál va.
  const par = { ...lib, device_defs: [{ part_id: 9, connectors: [{ id: 3, pins: [{ id: 1, cavity_id: "A6", name: "OUT1" }, { id: 2, cavity_id: "a6", name: "OUT1" }] }] }] } as unknown as Library;
  assert.equal(parseEnd(proj, par, "PDM30 OUT1 (a6)")?.cavity_assignment_id, 92);
  assert.equal(parseEnd(proj, par, "PDM30 OUT1"), null);

  // Dos cables desde X4:2: uno a PDM30 OUT11 y otro a masa.
  const a = addWireAtCavity(proj, lib, null, 42);
  assert.ok(typeof a !== "string");
  const b = addWireAtCavity(a.project, lib, null, 42);
  assert.ok(typeof b !== "string");
  let q = setOtherEnd(b.project, a.wireId, 42, parseEnd(b.project, lib, "PDM30 OUT11")!);
  assert.ok(typeof q !== "string");
  q = setOtherEnd(q, b.wireId, 42, parseEnd(q, lib, "G1")!);
  assert.ok(typeof q !== "string");
  assert.equal(wiresAtCavity(q, 42).length, 2);
  assert.equal(otherEnd(q.wire_instances[0], 42).cavity_assignment_id, 91);
  // Visto desde la otra punta, el mismo cable vuelve a X4:2.
  assert.equal(otherEnd(q.wire_instances[0], 91).cavity_assignment_id, 42);
  assert.equal(typeof setOtherEnd(q, a.wireId, 42, parseEnd(q, lib, "X4:2")!), "string"); // no puede volver a su propio pin
  assert.equal(wiresAtCavity(deleteWire(q, a.wireId), 42).length, 1);
  console.log("project edit (pinout per connector): ok");
}

// Splices, masas y componentes: alta con el próximo ID y la parte de la biblioteca; baja deja sueltos sus cables.
{
  const lib = { splice_defs: [{ part_id: 5 }], component_defs: [{ part_id: 6, component_type: "Diode" }] } as unknown as Library;
  const added = addJunction(base, lib, "splice");
  assert.ok(typeof added !== "string");
  assert.deepEqual([added.id, added.project.splice_instances.at(-1)!.short_id, added.project.splice_instances.at(-1)!.library_part_id], [3, "SP3", 5]);
  const comp = addJunction(base, lib, "component");
  assert.ok(typeof comp !== "string" && comp.project.component_instances[0].short_id === "D1");
  assert.equal(addJunction(base, { splice_defs: [], component_defs: [] } as unknown as Library, "splice"), "Add a splice type in Library → Splices first.");
  const ground = addJunction(base, lib, "ground");
  assert.ok(typeof ground !== "string");
  const w = { id: 1, short_id: "W001", end_a: { kind: "ground", cavity_assignment_id: null, splice_id: null, ground_point_id: 1, component_instance_id: null }, end_b: { kind: "splice", cavity_assignment_id: null, splice_id: 1, ground_point_id: null, component_instance_id: null } };
  const wired = { ...ground.project, wire_instances: [w] } as unknown as ProjectData;
  assert.equal(wiresAtJunction(wired, "ground", 1).length, 1);
  const gone = deleteJunction(wired, "ground", 1);
  assert.equal(gone.ground_points.length, 0);
  assert.equal(gone.wire_instances[0].end_a.ground_point_id, null);
  assert.equal(gone.wire_instances[0].end_b.splice_id, 1);
  console.log("project edit (splices, grounds, components): ok");
}

// Cable nuevo desde un pin: un tipo que entre en algún contacto que pueda llevar esa vía,
// según los calibres que interpreta el núcleo (gauge_facts): no el primero de la biblioteca.
{
  const { addWireAtCavity } = await import("../src/logic/projectEdit.ts");
  const lib = {
    wire_defs: [{ part_id: 26, gauge: "26 AWG" }, { part_id: 20, gauge: "20 AWG" }, { part_id: 18, gauge: "18 AWG" }],
    connector_defs: [{ part_id: 1, contact_part_id: 50, cavities: [{ cavity_id: "1", contact_size: "20" }] }],
  } as unknown as Library;
  // 26 AWG ≈ 0.13 mm², 20 AWG ≈ 0.52, 18 AWG ≈ 0.82; el contacto de la vía toma de 20 a 16 AWG (0.52–1.31).
  const gauges = { wire_mm2: { "26": 0.13, "20": 0.52, "18": 0.82 }, contact_ranges: { "1": { "20": [[0.52, 1.31]] as [number, number][] } } };
  const proj = { ...base, connector_instances: [{ id: 1, short_id: "X1", library_part_id: 1, cavities: [{ id: 11, cavity_id: "1" }] }], wire_instances: [], twist_groups: [] } as unknown as ProjectData;
  const r = addWireAtCavity(proj, lib, gauges, 11);
  assert.ok(typeof r !== "string");
  assert.equal(r.project.wire_instances[0].library_part_id, 20);
  // Sin los datos del núcleo todavía, no se descarta ninguno: el primero.
  const early = addWireAtCavity(proj, lib, null, 11);
  assert.ok(typeof early !== "string");
  assert.equal(early.project.wire_instances[0].library_part_id, 26);
  console.log("project edit (new wire fits the contact): ok");
}

// Cambiar a una parte con menos vías: los cables de las vías que desaparecen quedan sueltos de ese lado (no colgados).
{
  const { changeConnectorPart } = await import("../src/logic/projectEdit.ts");
  const lib = { connector_defs: [{ part_id: 7, cavities: [{ cavity_id: "1", contact_size: "20" }] }] } as unknown as Library;
  const end = (cav: number | null) => ({ kind: "cavity", cavity_assignment_id: cav, splice_id: null, ground_point_id: null, component_instance_id: null });
  const proj = {
    ...base,
    connector_instances: [{ id: 1, short_id: "X1", library_part_id: 5, cavities: [{ id: 11, cavity_id: "1" }, { id: 12, cavity_id: "2" }] }],
    wire_instances: [{ id: 1, short_id: "W001", end_a: end(11), end_b: end(null) }, { id: 2, short_id: "W002", end_a: end(12), end_b: end(null) }],
    twist_groups: [],
  } as unknown as ProjectData;
  const changed = changeConnectorPart(proj, lib, 1, 7);
  assert.deepEqual(changed.connector_instances[0].cavities.map((c) => c.id), [11]);
  assert.equal(changed.wire_instances[0].end_a.cavity_assignment_id, 11);
  assert.equal(changed.wire_instances[1].end_a.cavity_assignment_id, null);
  console.log("project edit (change to a smaller part loosens wires): ok");
}

