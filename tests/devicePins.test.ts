// Chequeo del pinout de dispositivos (Library → Devices). Uso: pnpm test (todos) o node tests/<archivo>
import assert from "node:assert/strict";
import { applyPaste, devicePinRows, guessRoles, nextDeviceId, parsePinout, previewPaste, setDevicePin } from "../src/logic/devicePins.ts";
import type { ConnectorDef, DeviceDefConnector, Library } from "../src/model/library.ts";

const housing = { cavities: ["A1", "A2", "A10", "n", "N"].map((cavity_id) => ({ cavity_id, contact_size: "20" })) } as ConnectorDef;
const pin = (id: number, cavity_id: string, name: string, fn: string | null = null) => ({ id, cavity_id, name, function: fn });
const conn: DeviceDefConnector = { id: 1, label: "A", connector_def_id: 7, pins: [pin(1, "A1", "OUT1", "20 A output"), pin(2, "A10", "OUT1"), pin(3, "Z9", "OLD")] };

// Una fila por vía de la carcasa (vacías incluidas), y al final el pin en una vía que la carcasa no tiene.
const rows = devicePinRows(conn, housing);
assert.deepEqual(rows.map((r) => [r.cavityId, r.name, r.inHousing]), [["A1", "OUT1", true], ["A2", "", true], ["A10", "OUT1", true], ["n", "", true], ["N", "", true], ["Z9", "OLD", false]]);
// Mismo nombre en dos vías: pines en paralelo.
assert.deepEqual(rows[0].alsoOn, ["A10"]);
assert.deepEqual(rows[1].alsoOn, []);

// Escribir en una vía vacía crea el pin; vaciar nombre y función lo borra.
const typed = setDevicePin(conn, "A2", { name: "OUT2" }, 50);
assert.deepEqual(typed.pins.find((p) => p.cavity_id === "A2"), pin(50, "A2", "OUT2"));
assert.equal(setDevicePin(typed, "A2", { name: "" }, 51).pins.some((p) => p.cavity_id === "A2"), false);
assert.equal(setDevicePin(conn, "A1", { name: "" }, 51).pins.find((p) => p.cavity_id === "A1")!.function, "20 A output");

// Ids únicos en toda la biblioteca (son claves en el archivo).
const lib = { device_defs: [{ connectors: [conn] }, { connectors: [{ id: 4, pins: [pin(9, "1", "X")] }] }] } as unknown as Library;
assert.equal(nextDeviceId(lib, "pins"), 10);
assert.equal(nextDeviceId(lib, "connectors"), 5);

// Pegado: Excel (tabulaciones) o PDF (dos o más espacios).
assert.deepEqual(parsePinout("Pin\tName\tFunction\na2\tOUT2\t20 A output\n\n"), [["Pin", "Name", "Function"], ["a2", "OUT2", "20 A output"]]);
assert.deepEqual(parsePinout("A1   OUT1   20 A output 1"), [["A1", "OUT1", "20 A output 1"]]);
assert.deepEqual(guessRoles(4), ["cavity", "name", "function", "ignore"]);

// Encabezado y vías que no existen no coinciden; "a2" es A2 (única sin mayúsculas); "N" exacto aunque exista "n".
const pasted = previewPaste(parsePinout("Pin\tName\tFunction\na2\tOUT2\t20 A\nN\tCAN H\tCAN\nQ7\tX\tY\nA1\tOUT1B\tnew"), ["cavity", "name", "function"], housing.cavities.map((c) => c.cavity_id));
assert.deepEqual(pasted.map((r) => r.match), [null, "A2", "N", null, "A1"]);
// Sin reemplazar: A1 conserva su nombre; con reemplazo, toma el pegado.
const kept = applyPaste(conn, pasted, false, 100);
assert.equal(kept.pins.find((p) => p.cavity_id === "A1")!.name, "OUT1");
assert.deepEqual(kept.pins.find((p) => p.cavity_id === "N"), pin(101, "N", "CAN H", "CAN"));
assert.equal(applyPaste(conn, pasted, true, 100).pins.find((p) => p.cavity_id === "A1")!.name, "OUT1B");

// "A6" en el conector A es la vía 6 (MoTeC antepone la letra del conector).
assert.deepEqual(previewPaste([["A6", "OUT11"], ["B6", "X"]], ["cavity", "name"], ["5", "6"], "A").map((r) => r.match), ["6", null]);

console.log("device pins: ok");
