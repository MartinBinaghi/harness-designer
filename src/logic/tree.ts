import type { Node, Segment } from "../model/project";

export interface TreeEntry {
  nodeId: number;
  depth: number;
  lengthMm?: number;
}

/** Misma caminata que buildTreeText, pero como datos para el panel de árbol
 * (en vez de texto), para que cada entrada se pueda hacer clickeable. */
export function buildTreeEntries(nodes: Node[], segments: Segment[], rootId: number): TreeEntry[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<number, { neighbor: number; segment: Segment }[]>();
  for (const seg of segments) {
    if (!adjacency.has(seg.node_a_id)) adjacency.set(seg.node_a_id, []);
    if (!adjacency.has(seg.node_b_id)) adjacency.set(seg.node_b_id, []);
    adjacency.get(seg.node_a_id)!.push({ neighbor: seg.node_b_id, segment: seg });
    adjacency.get(seg.node_b_id)!.push({ neighbor: seg.node_a_id, segment: seg });
  }

  const entries: TreeEntry[] = [];
  const visited = new Set<number>();

  function walk(id: number, depth: number, lengthMm?: number) {
    visited.add(id);
    entries.push({ nodeId: id, depth, lengthMm });
    for (const { neighbor, segment } of adjacency.get(id) ?? []) {
      if (!visited.has(neighbor)) {
        walk(neighbor, depth + 1, segment.length_mm);
      }
    }
  }

  if (nodeById.has(rootId)) {
    walk(rootId, 0);
  }
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      walk(node.id, 0);
    }
  }

  return entries;
}

/** Vista de árbol en texto (ramas indentadas), como pide la sección 7.3 del plan. */
export function buildTreeText(nodes: Node[], segments: Segment[], rootId: number): string {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<number, { neighbor: number; segment: Segment }[]>();
  for (const seg of segments) {
    if (!adjacency.has(seg.node_a_id)) adjacency.set(seg.node_a_id, []);
    if (!adjacency.has(seg.node_b_id)) adjacency.set(seg.node_b_id, []);
    adjacency.get(seg.node_a_id)!.push({ neighbor: seg.node_b_id, segment: seg });
    adjacency.get(seg.node_b_id)!.push({ neighbor: seg.node_a_id, segment: seg });
  }

  const lines: string[] = [];
  const visited = new Set<number>();

  function label(id: number): string {
    const node = nodeById.get(id);
    return node ? `nodo ${id} · ${node.kind}` : `nodo ${id} (desconocido)`;
  }

  function walk(id: number, depth: number, viaLengthMm?: number) {
    visited.add(id);
    const prefix = "  ".repeat(depth);
    const lengthPart = viaLengthMm !== undefined ? ` (${viaLengthMm} mm)` : "";
    lines.push(`${prefix}- ${label(id)}${lengthPart}`);
    for (const { neighbor, segment } of adjacency.get(id) ?? []) {
      if (!visited.has(neighbor)) {
        walk(neighbor, depth + 1, segment.length_mm);
      }
    }
  }

  if (nodeById.has(rootId)) {
    walk(rootId, 0);
  }
  // Nodos en ramas no conectadas al root (mientras se está cargando el árbol).
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      walk(node.id, 0);
    }
  }

  return lines.join("\n");
}
