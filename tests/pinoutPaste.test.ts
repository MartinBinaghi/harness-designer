// Chequeo del pegado de pinout en un conector. Uso: pnpm test (todos) o node tests/<archivo>
import assert from "node:assert/strict";
import { applyPinoutPaste, guessPinoutRoles, matchWireType, previewPinoutPaste } from "../src/logic/pinoutPaste.ts";
import { parsePinout } from "../src/logic/devicePins.ts";
import type { ProjectData } from "../src/model/project.ts";
import type { Library } from "../src/model/library.ts";

const cav = (id: number, pin: string) => ({ id, cavity_id: pin, external_reference: null });
const conn = (id: number, short_id: string, name: string, cavities: ReturnType<typeof cav>[]) => ({ id, short_id, name, library_part_id: 1, device_connector_id: null, node_id: id, termination: null, termination_library_part_id: null, backshell_library_part_id: null, status: "complete", is_interconnect: false, mates_with: null, cavities });
const blank = { kind: "", cavity_assignment_id: null, splice_id: null, ground_point_id: null, component_instance_id: null, node_id: null };

// X3 MOTOR (EE, FF, GG, KK) y X6 INTERCO (E, F); SP4. GG ya tiene un cable a X6:F.
const project = {
  project: { main_connector_instance_id: 1 },
  nodes: [],
  segments: [],
  connector_instances: [conn(3, "X3", "MOTOR", [cav(31, "EE"), cav(32, "FF"), cav(33, "GG"), cav(34, "KK")]), conn(6, "X6", "INTERCO", [cav(61, "E"), cav(62, "F")])],
  ground_points: [],
  splice_instances: [{ id: 4, short_id: "SP4", name: "WG +", library_part_id: 1, node_id: null, segment_id: null, offset_from_end_mm: null, offset_from_node_id: null }],
  component_instances: [],
  wire_instances: [
    { id: 1, short_id: "W001", library_part_id: 10, color: "blue", signal_type_id: null, specific_name: "Old", manual_cut_margin_pct: null, manual_length_mm: null, label: null, cable_instance_id: null, end_a: { ...blank, kind: "cavity", cavity_assignment_id: 33 }, end_b: { ...blank, kind: "cavity", cavity_assignment_id: 62 } },
  ],
  cable_instances: [],
  twist_groups: [],
} as unknown as ProjectData;
const library = {
  parts: [{ id: 10, part_number: "M22759/32-22" }, { id: 11, part_number: "M22759/32-20" }],
  wire_defs: [{ part_id: 10, gauge: "22 AWG", spec: "M22759/32" }, { part_id: 11, gauge: "20 AWG", spec: "M22759/32" }],
  signal_types: [{ id: 5, name: "12V+", default_color: "red" }],
  device_defs: [],
  connector_defs: [],
} as unknown as Library;
const x3 = project.connector_instances[0];

// Encabezado del taller: se reconoce y la fila no se aplica (no es una vía).
const text = "Pin\tFunción\tCategoría\tTermina en\tCable\tColor\nEE\t12V+ Coils\t12V+\tX6:E\t20 AWG\t\nX3:FF\tTPS\t\tSP4\tM22759/32-22\tyellow\nGG\tNew name\t\tX6:E\t\t\nKK\tn/c\t\t\t\t\nZZ\tNope\t\tX6:E\t\t";
const rows = parsePinout(text);
const roles = guessPinoutRoles(rows);
assert.deepEqual(roles, ["cavity", "function", "category", "goesTo", "wireType", "color"]);
// Sin encabezado: Pin · Función · Termina en.
assert.deepEqual(guessPinoutRoles([["EE", "12V+", "X6:E", "x"]]), ["cavity", "function", "goesTo", "ignore"]);

const preview = previewPinoutPaste(project, library, x3, rows, roles);
assert.deepEqual(preview.map((r) => r.cavityId), [null, 31, 32, 33, null, null]); // encabezado, EE, X3:FF, GG, n/c, ZZ
assert.equal(preview[1].signalTypeId, 5);
assert.equal(preview[1].wireTypeId, 11); // por el calibre (uno solo de 20 AWG)
assert.equal(preview[2].wireTypeId, 10); // por el número de parte
assert.equal(preview[3].existing, 1);
assert.deepEqual(preview[0].problems, []); // el encabezado no avisa nada
assert.deepEqual(previewPinoutPaste(project, library, x3, [["EE", "x", "X9:1"]], ["cavity", "function", "goesTo"])[0].problems, ['"X9:1" isn\'t a pin, splice or ground of this project']);
assert.equal(matchWireType(library, "22 awg · m22759/32"), 10);
assert.equal(matchWireType(library, "18 AWG"), null);

// Sin reemplazar: EE y FF nuevos, GG no se toca.
const kept = applyPinoutPaste(project, library, null, preview, false);
assert.deepEqual([kept.created, kept.changed, kept.skipped], [2, 0, 1]);
const ee = kept.project.wire_instances.find((w) => w.end_a.cavity_assignment_id === 31)!;
assert.deepEqual([ee.specific_name, ee.signal_type_id, ee.color, ee.library_part_id, ee.end_b.cavity_assignment_id], ["12V+ Coils", 5, "red", 11, 61]);
const ff = kept.project.wire_instances.find((w) => w.end_a.cavity_assignment_id === 32)!;
assert.deepEqual([ff.specific_name, ff.color, ff.library_part_id, ff.end_b.kind, ff.end_b.splice_id], ["TPS", "yellow", 10, "splice", 4]);
assert.equal(kept.project.wire_instances.find((w) => w.id === 1)!.specific_name, "Old");

// Reemplazando: GG cambia nombre y destino, y conserva lo que la fila no trae (color, tipo).
const replaced = applyPinoutPaste(project, library, null, preview, true);
assert.deepEqual([replaced.created, replaced.changed, replaced.skipped], [2, 1, 0]);
const gg = replaced.project.wire_instances.find((w) => w.id === 1)!;
assert.deepEqual([gg.specific_name, gg.color, gg.library_part_id, gg.end_b.cavity_assignment_id], ["New name", "blue", 10, 61]);

console.log("pinout paste: ok");
