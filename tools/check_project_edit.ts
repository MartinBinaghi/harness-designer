// Chequeo de las ediciones del proyecto (diagrama/tablas). Uso: node tools/check_project_edit.ts
import assert from "node:assert/strict";
import { addBranch, assignConnector, connectNodes, deleteNode, deleteSegment, splitSegment } from "../src/projectEdit.ts";
import type { ProjectData } from "../src/types.ts";
import type { Library } from "../src/libraryTypes.ts";

const node = (id: number, kind: "connector_end" | "breakout") => ({ id, kind, termination: null, termination_library_part_id: null, diagram_x: null, diagram_y: null });
const seg = (id: number, a: number, b: number, len: number) => ({ id, node_a_id: a, node_b_id: b, length_mm: len, twist_pitch_mm: null, covering_library_part_id: 7 });

// 1 --S1 (301 mm)-- 2, con un splice a 250 mm del nodo 1 y otro a 30 mm del nodo 2.
const base = {
  project: {} as ProjectData["project"],
  device_instances: [],
  nodes: [node(1, "connector_end"), node(2, "connector_end")],
  segments: [seg(1, 1, 2, 301)],
  connector_instances: [],
  ground_points: [],
  splice_instances: [
    { id: 1, short_id: "SP1", library_part_id: 1, node_id: null, segment_id: 1, offset_from_end_mm: 250, offset_from_node_id: 1 },
    { id: 2, short_id: "SP2", library_part_id: 1, node_id: null, segment_id: 1, offset_from_end_mm: 30, offset_from_node_id: 2 },
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
  const { addWire } = await import("../src/projectEdit.ts");
  const pin = (id: number) => ({ kind: "cavity" as const, cavity_assignment_id: id, splice_id: null, ground_point_id: null, component_instance_id: null });
  const lib = { wire_defs: [{ part_id: 20 }, { part_id: 21 }] } as unknown as Library;
  const withWires = { ...p, wire_instances: [{ library_part_id: 21, id: 4 }, { library_part_id: 21, id: 9 }] } as unknown as ProjectData;
  const added = addWire(withWires, lib, pin(1), pin(2));
  assert.ok(typeof added !== "string");
  const w = added.project.wire_instances.at(-1)!;
  assert.deepEqual([w.id, w.short_id, w.library_part_id], [10, "W010", 21]);
  assert.equal(typeof addWire(withWires, lib, pin(1), pin(1)), "string");
  assert.equal((addWire(p, lib, pin(1), pin(2)) as { project: ProjectData }).project.wire_instances[0].library_part_id, 20);
  console.log("project edit (wires): ok");
}
