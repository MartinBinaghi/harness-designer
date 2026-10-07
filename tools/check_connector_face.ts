// Chequeo de la cara dibujada de los conectores. Uso: node tools/check_connector_face.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { connectorFace, hull, wireSide, type MilArrangements } from "../src/connectorFace.ts";
import type { ConnectorDef } from "../src/libraryTypes.ts";

const mil: MilArrangements = JSON.parse(readFileSync(new URL("../src/data/mil-std-1560.json", import.meta.url), "utf8")).arrangements;
const def = (series: string, gender: "male" | "female", cavities: [string, string][], shell: string | null = null) =>
  ({ series, gender, shell_size: shell, cavities: cavities.map(([cavity_id, contact_size]) => ({ cavity_id, contact_size })) }) as ConnectorDef;
const ways = (n: number, size = "20") => Array.from({ length: n }, (_, i): [string, string] => [String(i + 1), size]);
const at = (face: ReturnType<typeof connectorFace>, id: string) => face!.cavities.find((c) => c.id === id)!;

// DTM 4 vías (plano TE DTM04-4P): de atrás, con la traba arriba, 1 arriba a la izquierda y 4 arriba a la derecha.
const dtm4p = connectorFace(def("DTM", "male", ways(4)), mil)!;
assert.equal(dtm4p.numbering, "datasheet");
const rear = wireSide(dtm4p);
assert.ok(at(rear, "1").x < 0 && at(rear, "1").y < 0);
assert.ok(at(rear, "2").x < 0 && at(rear, "2").y > 0);
assert.ok(at(rear, "4").x > 0 && at(rear, "4").y < 0);
// La cara del macho es la vista trasera espejada; la hembra enfrenta al macho: su cara coincide con la trasera del macho.
assert.ok(at(dtm4p, "1").x > 0);
const dtm4s = connectorFace(def("DTM", "female", ways(4)), mil)!;
assert.deepEqual(dtm4s.cavities, rear.cavities);

// DT 12 (plano TE DT04-12PA): de atrás, 1–6 por la fila de abajo hacia la derecha, 7–12 vuelven por arriba.
const dt12 = wireSide(connectorFace(def("DT", "male", ways(12, "16")), mil)!);
assert.ok(at(dt12, "1").y > 0 && at(dt12, "6").y > 0 && at(dt12, "1").x < at(dt12, "6").x);
assert.ok(at(dt12, "7").y < 0 && at(dt12, "7").x === at(dt12, "6").x && at(dt12, "12").x === at(dt12, "1").x);
assert.equal(dt12.latch, "sides");
// DT 3 es triangular (2 arriba, 1 abajo); DTM 3 en línea. La numeración de 2/3 vías no está confirmada.
const dt3 = connectorFace(def("DT", "male", ways(3, "16")), mil)!;
assert.equal(new Set(dt3.cavities.map((c) => Math.round(c.y))).size, 2);
assert.equal(hull(dt3).length, 3);
assert.equal(new Set(connectorFace(def("DTM", "male", ways(3)), mil)!.cavities.map((c) => c.y)).size, 1);
assert.equal(dt3.numbering, "inferred");
// Contorno de una grilla 2×3: sus 4 esquinas.
assert.equal(hull(connectorFace(def("DT", "female", ways(6, "16")), mil)!).length, 4);

// MIL 15-15 (MIL-STD-1560): A en (+.100, +.225) pulg. en la cara del inserto de pines (y hacia arriba = y negativa acá).
const ins = mil["15-15"].map(([id, size]): [string, string] => [String(id), String(size)]);
const pin = connectorFace(def("MIL-DTL-38999 III", "male", ins, "15"), mil)!;
assert.equal(pin.numbering, "standard");
assert.ok(Math.abs(at(pin, "A").x - 2.54) < 0.01 && Math.abs(at(pin, "A").y + 5.715) < 0.01);
assert.ok(at(connectorFace(def("MIL-DTL-38999 III", "female", ins, "15"), mil)!, "A").x < 0);

// Sin familia conocida, o con vías que no son 1..n en una familia de grilla: no se dibuja.
assert.equal(connectorFace(def("Amphenol XYZ", "male", ways(4)), mil), null);
assert.equal(connectorFace(def("DTM", "male", [["A", "20"], ["B", "20"]]), mil), null);

console.log("connector face: ok");
