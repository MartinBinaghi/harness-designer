// Chequeo de la vista esquemática pin a pin. Uso: pnpm test (todos) o node tests/<archivo>
import assert from "node:assert/strict";
import { anchorY, buildSchematic, endSides, matchWires, schematicLegend } from "../src/logic/schematicLayout.ts";
import type { Library } from "../src/model/library.ts";
import type { ProjectData } from "../src/model/project.ts";

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

// X2 es el conector A de un dispositivo: su pin 2 se llama OUT11.
project.connector_instances[1].device_connector_id = 5;
const library = { device_defs: [{ connectors: [{ id: 5, pins: [{ cavity_id: "2", name: "OUT11" }] }] }] } as unknown as Library;

const { blocks, links } = buildSchematic(project, library, false);
const b = (key: string) => blocks.find((x) => x.key === key)!;
assert.equal(links.length, 4);
// Columnas: principal a la izquierda, splice en el medio, el resto a la derecha; SP9 (sin cables) no aparece.
assert.deepEqual([b("c1").column, b("s1").column, b("c2").column, b("c3").column], [0, 1, 2, 2]);
assert.equal(blocks.some((x) => x.key === "s9"), false);
// Solo los pines usados; el resto se cuenta.
assert.deepEqual(b("c1").pins.map((p) => p.label), ["1", "2", "3"]);
assert.equal(b("c1").hiddenPins, 1);
assert.equal(b("c2").pins.find((p) => p.cavityId === 22)!.note, "OUT11 · 5V");
// Baricentro: X3 (unido al pin 1) queda arriba de X2 (pin 2 + splice), así no se cruzan.
assert.ok(b("c3").y < b("c2").y);
assert.ok(anchorY(b("c1"), 11) < anchorY(b("c1"), 12));
// Con todos los pines.
assert.equal(buildSchematic(project, library, true).blocks.find((x) => x.key === "c1")!.pins.length, 4);


// Filtro: "5v" (sin distinguir mayúsculas) deja los dos cables del splice, sus pines y sus bloques; X3 se va.
const keep = matchWires(project, { ...library, signal_types: [] } as Library, "5v", null)!;
assert.deepEqual([...keep], [3, 4]);
const only5v = buildSchematic(project, library, true, keep);
assert.deepEqual(only5v.blocks.map((x) => x.key).sort(), ["c1", "c2", "s1"]);
assert.deepEqual(only5v.blocks.find((x) => x.key === "c1")!.pins.map((p) => p.label), ["3"]);
// El principal va a la izquierda si tiene alguno de esos cables; si no, el que más tiene.
const onlyMid = buildSchematic(project, library, false, new Set([2]));
assert.deepEqual(onlyMid.blocks.map((x) => [x.key, x.column]), [["c1", 0], ["c2", 2]]);
project.project.main_connector_instance_id = 3;
assert.equal(buildSchematic(project, library, false, new Set([4])).blocks.find((x) => x.key === "c2")!.column, 0);
project.project.main_connector_instance_id = 1;
// Por tipo de señal; sin filtro, null.
project.wire_instances[0].signal_type_id = 7;
assert.deepEqual([...matchWires(project, { signal_types: [{ id: 7, name: "GND", default_color: "black" }] } as unknown as Library, "", 7)!], [1]);
assert.deepEqual([...matchWires(project, { signal_types: [{ id: 7, name: "GND", default_color: "black" }] } as unknown as Library, "gnd", null)!], [1]);
assert.equal(matchWires(project, library, "  ", null), null);
// Color de la leyenda: exactamente ese ("red" no trae "red/white"), junto con el resto del filtro.
const legendLibrary = { signal_types: [] } as unknown as Library;
const colored = structuredClone(project);
colored.wire_instances[0].color = "red";
colored.wire_instances[1].color = "red/white";
assert.deepEqual([...matchWires(colored, legendLibrary, "", null, "red")!], [1]);
assert.deepEqual([...matchWires(colored, legendLibrary, "", null, "red/white")!], [2]);
assert.equal(matchWires(colored, legendLibrary, "", null, null), null);
assert.deepEqual([...matchWires(colored, { signal_types: [{ id: 7, name: "GND", default_color: "black" }] } as unknown as Library, "", 7, "violet")!], []);
// Un bloque acomodado va donde lo dejó el usuario; los demás, donde los pone el automático.
project.project.schematic_layout = { c3: { x: 900, y: -50, side: "L" } };
const placed = buildSchematic(project, library, false).blocks;
const c3 = placed.find((x) => x.key === "c3")!;
assert.deepEqual([c3.x, c3.y, c3.side], [900, -50, "L"]);
assert.equal(placed.find((x) => x.key === "c2")!.side, null);
assert.equal(placed.find((x) => x.key === "c2")!.y, b("c2").y);

// Lado de salida: el elegido manda; si no, el que mira al otro bloque; en la misma columna, los dos a la derecha.
assert.deepEqual(endSides(0, 760, null, null), ["R", "L"]);
assert.deepEqual(endSides(760, 0, null, null), ["L", "R"]);
assert.deepEqual(endSides(760, 760, null, null), ["R", "R"]);
assert.deepEqual(endSides(0, 760, "L", null), ["L", "L"]);
// Leyenda: por color, con sus tipos de señal, los más usados primero.
const legendLib = { signal_types: [{ id: 7, name: "GND", default_color: "black" }] } as unknown as Library;
assert.deepEqual(schematicLegend(project, legendLib, links), [{ color: "violet", count: 4, types: ["GND"] }]);

console.log("schematic: ok");
