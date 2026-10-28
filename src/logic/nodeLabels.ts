import type { Node, ProjectData, Selection } from "../model/project";

/** Nombres para mostrar de los tipos de nodo y de sus terminaciones (plan 4.2, Node). */
export const NODE_KIND_LABELS: Record<Node["kind"], string> = {
  connector_end: "Connector end",
  breakout: "Breakout",
  splice_point: "Splice point",
  ground_point: "Ground point",
};
export const NODE_TERMINATION_LABELS: Record<NonNullable<Node["termination"]>, string> = {
  t_mold: "T-mold",
  adhesive_heatshrink: "Adhesive heat-shrink",
  none: "None",
};
export const NODE_KINDS = Object.keys(NODE_KIND_LABELS) as Node["kind"][];
export const NODE_TERMINATIONS = Object.keys(NODE_TERMINATION_LABELS) as NonNullable<Node["termination"]>[];

interface EntryInfo {
  label: string;
  select: Selection;
  dotClass: string;
}

/** Cómo se nombra un nodo en el árbol y el diagrama, y qué se selecciona al hacerle clic. */
export function infoFor(project: ProjectData, nodeId: number): EntryInfo {
  const node = project.nodes.find((n) => n.id === nodeId);
  const connector = project.connector_instances.find((c) => c.node_id === nodeId);
  if (connector) {
    return {
      label: connector.name ? `${connector.short_id} · ${connector.name}` : connector.short_id,
      select: { kind: "connector", id: connector.id },
      dotClass: "tree-dot-connector",
    };
  }
  const ground = project.ground_points.find((g) => g.node_id === nodeId);
  if (ground) {
    return {
      label: ground.name ? `${ground.short_id} · ${ground.name}` : ground.short_id,
      select: { kind: "ground", id: ground.id },
      dotClass: "tree-dot-ground",
    };
  }
  const splice = project.splice_instances.find((s) => s.node_id === nodeId);
  if (splice) {
    return { label: splice.name ? `${splice.short_id} · ${splice.name}` : splice.short_id, select: { kind: "splice", id: splice.id }, dotClass: "tree-dot-splice" };
  }
  if (node?.kind === "breakout") {
    const label = node.termination && node.termination !== "none" ? `Breakout (${node.termination.replace("_", " ")})` : "Breakout";
    return { label, select: { kind: "node", id: nodeId }, dotClass: "tree-dot-breakout" };
  }
  return { label: `Node ${nodeId}`, select: { kind: "node", id: nodeId }, dotClass: "tree-dot-node" };
}
