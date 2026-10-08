// Chequeo de la vista esquemática pin a pin. Uso: node tools/check_schematic.ts
import assert from "node:assert/strict";
import { anchorY, buildSchematic } from "../src/schematic.ts";
import type { ProjectData } from "../src/types.ts";

const cav = (id: number, pin: string) => ({ id, cavity_id: pin, external_reference: null });
const conn = (id: number, short_id: string, cavities: ReturnType<typeof cav>[]) => ({ id, short_id, name: short_id, library_part_id: 1, device_connector_id: null, node_id: id, termination: null, termination_library_part_id: null, backshell_library_part_id: null, status: "complete", is_interconnect: false, mates_with: null, cavities });
const end = (kind: string, ids: { cavity?: number; splice?: number }) => ({ kind, cavity_assignment_id: ids.cavity ?? null, splice_id: ids.splice ?? null, ground_point_id: null, component_instance_id: null });
const wire = (id: number, name: string, a: ReturnType<typeof end>, b: ReturnType<typeof end>) => ({ id, short_id: `W${id}`, library_part_id: 1, color: "violet", signal_type_id: null, specific_name: name, manual_cut_margin_pct: null, label: null, end_a: a, end_b: b });

// X1 (principal, 4 vías) — pin 1 a X3, pin 2 a X2, pin 3 a SP1; X2 también a SP1. Pin 4 sin usar.
const project = {
  project: { main_connector_instance_id: 1 },
  connector_instances: [conn(1, "X1", [cav(11, "1"), cav(12, "2"), cav(13, "3"), cav(14, "4")]), conn(2, "X2", [cav(21, "1"), cav(22, "2")]), conn(3, "X3", [cav(31, "1")])],
  splice_instances: [{ id: 1, short_id: "SP1" }, { id: 9, short_id: "SP9" }],
  ground_points: [],
  component_instances: [],
  wire_instances: [
    wire(1, "TOP", end("cavity", { cavity: 11 }), end("cavity", { cavity: 31 })),
    wire(2, "MID", end("cavity", { cavity: 12 }), end("cavity", { cavity: 21 })),
    wire(3, "5V", end("cavity", { cavity: 13 }), end("splice", { splice: 1 })),
    wire(4, "5V", end("splice", { splice: 1 }), end("cavity", { cavity: 22 })),
  ],
} as unknown as ProjectData;

const { blocks, links } = buildSchematic(project, false);
const b = (key: string) => blocks.find((x) => x.key === key)!;
assert.equal(links.length, 4);
// Columnas: principal a la izquierda, splice en el medio, el resto a la derecha; SP9 (sin cables) no aparece.
assert.deepEqual([b("c1").column, b("s1").column, b("c2").column, b("c3").column], [0, 1, 2, 2]);
assert.equal(blocks.some((x) => x.key === "s9"), false);
// Solo los pines usados; el resto se cuenta.
assert.deepEqual(b("c1").pins.map((p) => p.label), ["1", "2", "3"]);
assert.equal(b("c1").hiddenPins, 1);
assert.equal(b("c2").pins.find((p) => p.cavityId === 22)!.note, "5V");
// Baricentro: X3 (unido al pin 1) queda arriba de X2 (pin 2 + splice), así no se cruzan.
assert.ok(b("c3").y < b("c2").y);
assert.ok(anchorY(b("c1"), 11) < anchorY(b("c1"), 12));
// Con todos los pines.
assert.equal(buildSchematic(project, true).blocks.find((x) => x.key === "c1")!.pins.length, 4);

console.log("schematic: ok");
