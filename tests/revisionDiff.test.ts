// Chequeo de la comparación de revisiones. Uso: pnpm test (todos) o node tests/<archivo>
import assert from "node:assert/strict";
import { compareProjects } from "../src/logic/revisionDiff.ts";
import type { ProjectData } from "../src/model/project.ts";
import type { Library } from "../src/model/library.ts";

const cav = (id: number, pin: string) => ({ id, cavity_id: pin, external_reference: null as string | null });
const conn = (id: number, short_id: string, name: string, node_id: number, cavities: ReturnType<typeof cav>[]) => ({ id, short_id, name, library_part_id: 1, device_connector_id: null, node_id, termination: null, termination_library_part_id: null, backshell_library_part_id: null, status: "complete", is_interconnect: false, mates_with: null, cavities });
const blank = { kind: "cavity", cavity_assignment_id: null, splice_id: null, ground_point_id: null, component_instance_id: null, node_id: null };
const wire = (id: number, short_id: string, name: string, a: object, b: object) => ({ id, short_id, library_part_id: 10, color: "red", signal_type_id: 5, specific_name: name, manual_cut_margin_pct: null, manual_length_mm: null, label: null, cable_instance_id: null, end_a: { ...blank, ...a }, end_b: { ...blank, ...b } });
const node = (id: number, kind: string) => ({ id, kind, termination: null, termination_library_part_id: null, termination_segment_ids: [], diagram_x: 0, diagram_y: 0, adhesive_heatshrink_length_mm: null });

// X1 ECU (1, 2) — breakout 3 — X3 MOTOR (EE, FF); SP4 en el breakout.
const revA = {
  project: { name: "Motor", harness_code: "MOT-01", client: null, revision: "A", main_connector_instance_id: 1, markup_pct: 0, default_cut_margin_pct: 10, default_twist_pitch_factor: 8, fill_factor: 0.75, labor_hours: 0, labor_rate_usd: 0, cost_on_purchased: false, spare_pcts: {}, cut_round_mm: null, schematic_layout: {} },
  nodes: [node(1, "connector_end"), node(2, "connector_end"), node(3, "breakout")],
  segments: [
    { id: 1, node_a_id: 1, node_b_id: 3, length_mm: 300, twist_pitch_mm: null, covering_library_part_id: null, leaves_backward: false },
    { id: 2, node_a_id: 3, node_b_id: 2, length_mm: 500, twist_pitch_mm: null, covering_library_part_id: null, leaves_backward: false },
  ],
  connector_instances: [conn(1, "X1", "ECU", 1, [cav(11, "1"), cav(12, "2")]), conn(3, "X3", "MOTOR", 2, [cav(31, "EE"), cav(32, "FF")])],
  ground_points: [],
  splice_instances: [{ id: 4, short_id: "SP4", name: "WG +", library_part_id: 20, node_id: 3, segment_id: null, offset_from_end_mm: null, offset_from_node_id: null }],
  component_instances: [],
  wire_instances: [wire(1, "W001", "12V+ Coils", { cavity_assignment_id: 11 }, { cavity_assignment_id: 31 }), wire(2, "W002", "TPS", { cavity_assignment_id: 12 }, { cavity_assignment_id: 32 })],
  cable_instances: [],
  twist_groups: [],
} as unknown as ProjectData;
const library = {
  parts: [{ id: 1, part_number: "DTM06-2S" }, { id: 10, part_number: "M22759/32-22" }, { id: 11, part_number: "M22759/32-20" }, { id: 20, part_number: "SPLICE-S" }],
  wire_defs: [{ part_id: 10, gauge: "22 AWG", spec: "M22759/32" }, { part_id: 11, gauge: "20 AWG", spec: "M22759/32" }],
  signal_types: [{ id: 5, name: "12V+" }],
  device_defs: [],
  connector_defs: [],
} as unknown as Library;

// Sin cambios (la revisión y la posición en los dibujos no cuentan).
const same = structuredClone(revA);
same.project.revision = "B";
same.nodes[0].diagram_x = 999;
same.project.schematic_layout = { c1: { x: 5, y: 5 } };
assert.deepEqual(compareProjects(revA, same, library), []);

// Rev B: W002 va al splice en vez de X3:FF y pasa a 20 AWG; el tramo 2 se alarga;
// W003 nuevo en X3:FF; el código del arnés cambia; las puntas del W001 dadas vuelta no cuentan.
const revB = structuredClone(revA);
revB.project.harness_code = "MOT-02";
revB.wire_instances[0].end_a = { ...revA.wire_instances[0].end_b };
revB.wire_instances[0].end_b = { ...revA.wire_instances[0].end_a };
revB.wire_instances[1].end_b = { ...blank, kind: "splice", splice_id: 4 } as never;
revB.wire_instances[1].library_part_id = 11;
revB.wire_instances.push(wire(3, "W003", "Lambda", { cavity_assignment_id: 32 }, { kind: "splice", splice_id: 4 }) as never);
revB.segments[1].length_mm = 520;
revB.connector_instances[1].cavities[0].external_reference = "Eng ECU 5V";

const diff = compareProjects(revA, revB, library);
const section = (title: string) => diff.find((s) => s.title === title)!;
assert.deepEqual(diff.map((s) => s.title), ["Harness", "Connectors", "Wires", "Topology"]);
assert.deepEqual(section("Harness").items[0].changes, [{ field: "Code", before: "MOT-01", after: "MOT-02" }]);

// Por conector, lo que cambió en cada vía (en X1 el pin 1 no: W001 sigue yendo a X3:EE).
const connectors = section("Connectors").items;
assert.deepEqual(connectors.map((c) => c.label), ["X1 · ECU", "X3 · MOTOR"]);
assert.deepEqual(connectors[0].changes, [{ field: "Pin 2", before: "W002 TPS → X3:FF", after: "W002 TPS → SP4" }]);
assert.deepEqual(connectors[1].changes, [
  { field: "Pin EE · external reference", before: "—", after: "Eng ECU 5V" },
  { field: "Pin FF", before: "W002 TPS → X1:2", after: "W003 Lambda → SP4" },
]);

const wires = section("Wires").items;
assert.deepEqual(wires.map((w) => [w.kind, w.label]), [["changed", "W002 · TPS"], ["added", "W003 · Lambda"]]);
assert.deepEqual(wires[0].changes, [
  { field: "Ends", before: "X1:2 ↔ X3:FF", after: "SP4 ↔ X1:2" },
  { field: "Wire type", before: "22 AWG M22759/32", after: "20 AWG M22759/32" },
]);

const topology = section("Topology").items;
assert.deepEqual(topology, [{ kind: "changed", label: "S2 · SP4 ↔ X3", changes: [{ field: "Length (mm)", before: "500", after: "520" }] }]);

// Al revés: lo agregado aparece como sacado.
const back = compareProjects(revB, revA, library);
assert.deepEqual(back.find((s) => s.title === "Wires")!.items.map((w) => [w.kind, w.label]), [["changed", "W002 · TPS"], ["removed", "W003 · Lambda"]]);

console.log("revision diff: ok");
