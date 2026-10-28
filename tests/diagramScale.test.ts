// Chequeo de la geometría del diagrama a escala. Uso: pnpm test (todos) o node tests/<archivo>
import assert from "node:assert/strict";
import { constrainDrag, pxPerMm, rootedTree, scaledCenters, type XY } from "../src/logic/diagramScale.ts";

const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

// Árbol en Y: 1 --100mm-- 2 --80mm-- 3
//                          \--200mm-- 4
const segments = [
  { node_a_id: 1, node_b_id: 2, length_mm: 100 },
  { node_a_id: 2, node_b_id: 3, length_mm: 80 },
  { node_a_id: 2, node_b_id: 4, length_mm: 200 },
];
const tree = rootedTree(segments, [1, 2, 3, 4], 1);
const k = pxPerMm(segments.map((s) => s.length_mm));
close(k, 140 / 80);

// Dibujo libre de partida: largos visuales arbitrarios (el de 80 mm más largo que el de 200 mm).
const base = new Map<number, XY>([
  [1, { x: 0, y: 0 }],
  [2, { x: 50, y: 0 }],
  [3, { x: 500, y: 0 }],
  [4, { x: 50, y: 30 }],
]);
const scaled = scaledCenters(tree, base, k);
close(dist(scaled.get(1)!, scaled.get(2)!), 100 * k);
close(dist(scaled.get(2)!, scaled.get(3)!), 80 * k);
close(dist(scaled.get(2)!, scaled.get(4)!), 200 * k);
// Se respeta la dirección: 3 sigue a la derecha de 2, 4 sigue abajo.
close(scaled.get(3)!.y, scaled.get(2)!.y);
assert.ok(scaled.get(4)!.y > scaled.get(2)!.y);

// Arrastrar 2 hacia arriba: gira alrededor de 1 sin cambiar el largo, y 3/4 lo acompañan en bloque.
const moved = constrainDrag(tree, scaled, 2, { x: 0, y: -999 }, k);
const after = new Map([...scaled, ...moved]);
close(dist(after.get(1)!, after.get(2)!), 100 * k);
close(after.get(2)!.x, 0);
close(dist(after.get(2)!, after.get(3)!), 80 * k);
close(dist(after.get(2)!, after.get(4)!), 200 * k);

console.log("diagram scale: ok");
