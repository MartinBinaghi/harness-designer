// Chequeo de la cara dibujada de los conectores. Uso: pnpm test (todos) o node tests/<archivo>
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { connectorFace, hull, wireSide, type MilArrangements } from "../src/logic/connectorFace.ts";
import type { ConnectorDef } from "../src/model/library.ts";

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
// Marcado A, B, C (como lo usa el taller): misma cara, con las letras.
assert.deepEqual(connectorFace(def("DT", "male", [["A", "16"], ["B", "16"], ["C", "16"]]), mil)!.cavities.map((c) => c.id), ["A", "B", "C"]);
// Contorno: rectangular en las Deutsch, salvo el DT de 3 vías (triangular); Superseal ovalado.
assert.equal(dt3.shape, "hull");
assert.equal(dtm4p.shape, "rect");
assert.equal(connectorFace(def("Superseal 1.5", "male", ways(3, "1.5")), mil)!.shape, "hull");
// Contorno de una grilla 2×3: sus 4 esquinas.
assert.equal(hull(connectorFace(def("DT", "female", ways(6, "16")), mil)!).length, 4);

// MIL 15-15 (MIL-STD-1560): A en (+.100, +.225) pulg. en la cara del inserto de pines (y hacia arriba = y negativa acá).
const ins = mil["15-15"].map(([id, size]): [string, string] => [String(id), String(size)]);
const pin = connectorFace(def("MIL-DTL-38999 III", "male", ins, "15"), mil)!;
assert.equal(pin.numbering, "standard");
assert.ok(Math.abs(at(pin, "A").x - 2.54) < 0.01 && Math.abs(at(pin, "A").y + 5.715) < 0.01);
assert.ok(at(connectorFace(def("MIL-DTL-38999 III", "female", ins, "15"), mil)!, "A").x < 0);

// Sin familia conocida, o con vías que no son 1..n ni A.. en una familia de grilla: no se dibuja.
assert.equal(connectorFace(def("Amphenol XYZ", "male", ways(4)), mil), null);
assert.equal(connectorFace(def("DTM", "male", [["1", "20"], ["X", "20"]]), mil), null);

// Superseal 1.0 de 34 vías (PDM30 A): filas de 9, 8, 8, 9; la hembra vista de atrás numera de izquierda a derecha.
{
  const ss = (gender: "male" | "female") => connectorFace(def("Superseal 1.0", gender, ways(34, "1.0")), mil)!;
  const rows = [...new Set(ss("female").cavities.map((c) => c.y))];
  assert.deepEqual(rows.map((y) => ss("female").cavities.filter((c) => c.y === y).length), [9, 8, 8, 9]);
  const back = wireSide(ss("female"));
  assert.ok(at(back, "1").x < at(back, "9").x && at(back, "1").y === at(back, "9").y && at(back, "26").y > at(back, "18").y);
  assert.equal(ss("female").numbering, "datasheet");
  assert.equal(connectorFace(def("Superseal 1.0", "female", ways(26, "1.0")), mil)!.cavities.length, 26);
  assert.equal(connectorFace(def("Superseal 1.0", "female", ways(20, "1.0")), mil), null);
}

// VAG: bobina de 4 vías en una fila; lambda de 6 en dos filas de 3; ovalados con traba arriba.
{
  const coil = connectorFace(def("VAG", "female", ways(4, "Mini Timer")), mil)!;
  assert.equal(new Set(coil.cavities.map((c) => c.y)).size, 1);
  assert.deepEqual([coil.shape, coil.latch, coil.numbering], ["d", "top", "datasheet"]);
  const lambda = connectorFace(def("VAG", "female", ways(6, "Mini Timer")), mil)!;
  assert.deepEqual([...new Set(lambda.cavities.map((c) => c.y))].map((y) => lambda.cavities.filter((c) => c.y === y).length), [3, 3]);
  assert.equal(connectorFace(def("VAG", "female", ways(5, "Mini Timer")), mil), null);
  // Cara de acople: el macho con el pin 1 a la derecha, la hembra a la izquierda (Martin).
  const pin1 = (gender: "male" | "female") => connectorFace(def("VAG", gender, ways(4, "Mini Timer")), mil)!.cavities.find((c) => c.id === "1")!.x;
  assert.ok(pin1("male") > 0 && pin1("female") < 0);
  // Lambda (6 vías), cara de acople de la hembra: por columnas, 1 abajo a la izquierda y 2 arriba; 3 abajo al medio, 4 arriba… (Martin).
  const l6 = connectorFace(def("VAG", "female", ways(6, "Micro Timer")), mil)!;
  const p = (id: string) => at(l6, id);
  assert.ok(p("1").x < 0 && p("1").y > 0 && p("2").x === p("1").x && p("2").y < 0);
  assert.ok(p("3").x === 0 && p("3").y > 0 && p("4").x === 0 && p("4").y < 0 && p("5").x > 0 && p("6").y < 0);
}
// Termocupla miniatura: "+" y "-", sin traba.
{
  const tc = connectorFace(def("Mini thermocouple K", "female", [["+", "K"], ["-", "K"]]), mil)!;
  assert.deepEqual([tc.latch, tc.cavities.map((c) => c.id).sort().join("")], ["none", "+-"]);
}

// MIL-DTL-26482 Serie 2 (MS3476L24-61P): arreglo de MIL-STD-1560 con esas vías. Mirando
// desde atrás con la traba arriba, la fila de arriba va B · A · b · a · Z · Y (foto de la pieza).
{
  const ids61 = (mil["25-61"] as (string | number)[][]).map(([id]) => [String(id), "20"] as [string, string]);
  const face = connectorFace(def("MIL-DTL-26482 II", "male", ids61, "24"), mil)!;
  assert.equal(face.numbering, "datasheet");
  const rear = wireSide(face);
  const x = (id: string) => at(rear, id).x;
  assert.ok(x("B") < x("A") && x("A") < x("b") && x("b") < x("a") && x("a") < x("Z") && x("Z") < x("Y"));
}

// Mini Timer en línea: la ficha original de 3 vías A-B-C, con la A a la izquierda en la cara de la hembra (Martin).
{
  const mt = connectorFace(def("Mini Timer", "female", [["A", "Mini Timer"], ["B", "Mini Timer"], ["C", "Mini Timer"]]), mil)!;
  assert.ok(at(mt, "A").x < at(mt, "B").x && at(mt, "B").x < at(mt, "C").x);
  assert.deepEqual([mt.shape, mt.latch], ["rect", "top"]);
}

// DTM 3 vías (Martin): en la cara de la hembra la 3 va a la izquierda; el macho, al revés.
{
  const s3 = connectorFace(def("DTM", "female", ways(3)), mil)!;
  const p3 = connectorFace(def("DTM", "male", ways(3)), mil)!;
  assert.ok(at(s3, "3").x < at(s3, "2").x && at(s3, "2").x < at(s3, "1").x);
  assert.ok(at(p3, "1").x < at(p3, "3").x);
  assert.equal(s3.numbering, "datasheet");
}

console.log("connector face: ok");
