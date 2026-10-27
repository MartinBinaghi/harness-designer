/**
 * Geometría del diagrama "a escala": cada segmento se dibuja con un largo
 * proporcional a su largo real. El dibujo libre (posiciones guardadas o del
 * layout automático) solo aporta la dirección de cada rama; el largo lo pone
 * el segmento. Todo se calcula sobre el centro de cada nodo, que es donde
 * empiezan y terminan las líneas.
 *
 * Chequeo: `node tools/check_diagram_scale.ts`.
 */

export type XY = { x: number; y: number };

interface SegmentLike {
  node_a_id: number;
  node_b_id: number;
  length_mm: number;
}

export interface RootedTree {
  /** Padre de cada nodo (salvo las raíces) y largo del segmento que los une. */
  parent: Map<number, { id: number; lengthMm: number }>;
  children: Map<number, number[]>;
  /** Orden de recorrido desde la raíz: cada nodo aparece después de su padre. */
  order: number[];
}

/** Árbol orientado desde `rootId` (y desde cada nodo suelto, para ramas desconectadas). */
export function rootedTree(segments: SegmentLike[], nodeIds: number[], rootId?: number): RootedTree {
  const neighbors = new Map<number, { id: number; lengthMm: number }[]>();
  for (const s of segments) {
    neighbors.set(s.node_a_id, [...(neighbors.get(s.node_a_id) ?? []), { id: s.node_b_id, lengthMm: s.length_mm }]);
    neighbors.set(s.node_b_id, [...(neighbors.get(s.node_b_id) ?? []), { id: s.node_a_id, lengthMm: s.length_mm }]);
  }
  const tree: RootedTree = { parent: new Map(), children: new Map(), order: [] };
  const seen = new Set<number>();
  for (const start of rootId !== undefined ? [rootId, ...nodeIds] : nodeIds) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      tree.order.push(id);
      for (const next of neighbors.get(id) ?? []) {
        if (seen.has(next.id)) continue;
        seen.add(next.id);
        tree.parent.set(next.id, { id, lengthMm: next.lengthMm });
        tree.children.set(id, [...(tree.children.get(id) ?? []), next.id]);
        queue.push(next.id);
      }
    }
  }
  return tree;
}

/** Píxeles por mm: el segmento más corto queda de ~140 px (con un tope para valores extremos). */
export function pxPerMm(lengthsMm: number[]): number {
  const positive = lengthsMm.filter((l) => l > 0);
  if (positive.length === 0) return 1;
  return Math.min(2, Math.max(0.2, 140 / Math.min(...positive)));
}

function direction(from: XY, to: XY): XY {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  return len > 1e-6 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
}

/**
 * Centros a escala: cada nodo queda a `largo × k` de su padre, en la misma
 * dirección en que estaba en `base`. Las raíces quedan donde estaban.
 */
export function scaledCenters(tree: RootedTree, base: Map<number, XY>, k: number): Map<number, XY> {
  const out = new Map<number, XY>();
  for (const id of tree.order) {
    const p = tree.parent.get(id);
    const here = base.get(id) ?? { x: 0, y: 0 };
    if (!p) {
      out.set(id, here);
      continue;
    }
    const parentNew = out.get(p.id)!;
    const d = direction(base.get(p.id) ?? parentNew, here);
    out.set(id, { x: parentNew.x + d.x * p.lengthMm * k, y: parentNew.y + d.y * p.lengthMm * k });
  }
  return out;
}

export function descendants(tree: RootedTree, id: number): number[] {
  const out: number[] = [];
  const stack = [...(tree.children.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    out.push(next);
    stack.push(...(tree.children.get(next) ?? []));
  }
  return out;
}

/**
 * Arrastre a escala: el nodo arrastrado gira alrededor de su padre sin cambiar
 * la distancia (apunta hacia donde está el cursor), y todo lo que cuelga de él
 * se mueve en bloque. Una raíz se mueve libre, con todo el árbol. Devuelve los
 * centros nuevos de los nodos que cambian.
 */
export function constrainDrag(tree: RootedTree, centers: Map<number, XY>, id: number, desired: XY, k: number): Map<number, XY> {
  const p = tree.parent.get(id);
  const old = centers.get(id) ?? desired;
  let next = desired;
  if (p) {
    const pc = centers.get(p.id)!;
    const d = direction(pc, desired);
    next = { x: pc.x + d.x * p.lengthMm * k, y: pc.y + d.y * p.lengthMm * k };
  }
  const delta = { x: next.x - old.x, y: next.y - old.y };
  const out = new Map<number, XY>([[id, next]]);
  for (const child of descendants(tree, id)) {
    const c = centers.get(child)!;
    out.set(child, { x: c.x + delta.x, y: c.y + delta.y });
  }
  return out;
}
