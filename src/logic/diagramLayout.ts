import type { ProjectData } from "../model/project";
import type { XY } from "./diagramScale";

/**
 * Dónde va cada nodo del diagrama de armado cuando todavía no tiene posición
 * guardada (plan 10.4). Lo usan el diagrama y la hoja de armado impresa.
 */

/** Tamaño aproximado de cada tipo de nodo, para centrar puntos y bloques en el layout automático. */
export const BLOCK_SIZE = { width: 170, height: 48 };
export const POINT_SIZE = { width: 14, height: 14 };
/** Grilla del layout automático: una columna por nivel del árbol, una fila por rama final. */
const COLUMN_WIDTH = 300;
const ROW_HEIGHT = 80;

export function rootNodeId(project: ProjectData): number | undefined {
  const main = project.connector_instances.find((c) => c.id === project.project.main_connector_instance_id);
  return main?.node_id ?? project.nodes[0]?.id;
}

/** Extremos de conector y puntos de masa se dibujan como bloque (aunque todavía no tengan nada asignado). */
export function isBlock(project: ProjectData, nodeId: number): boolean {
  const kind = project.nodes.find((n) => n.id === nodeId)?.kind;
  return (
    kind === "connector_end" ||
    kind === "ground_point" ||
    project.connector_instances.some((c) => c.node_id === nodeId) ||
    project.ground_points.some((g) => g.node_id === nodeId)
  );
}

/**
 * Layout automático de árbol, de izquierda a derecha: el conector principal en
 * la primera columna, cada nivel en la columna siguiente; cada rama final ocupa
 * una fila y cada nodo queda centrado entre sus ramas. Así las ramas de un
 * breakout quedan juntas y no se cruzan con las de otro.
 */
export function autoLayout(project: ProjectData): Map<number, XY> {
  const neighbors = new Map<number, number[]>();
  for (const s of project.segments) {
    neighbors.set(s.node_a_id, [...(neighbors.get(s.node_a_id) ?? []), s.node_b_id]);
    neighbors.set(s.node_b_id, [...(neighbors.get(s.node_b_id) ?? []), s.node_a_id]);
  }
  const positions = new Map<number, XY>();
  let nextRow = 0;
  // Devuelve la fila (centro) del nodo; las hojas toman filas consecutivas.
  function place(id: number, depth: number, parent: number | null): number {
    positions.set(id, { x: 0, y: 0 });
    const children = (neighbors.get(id) ?? []).filter((n) => n !== parent && !positions.has(n));
    const rows = children.map((child) => place(child, depth + 1, id));
    const row = rows.length > 0 ? (rows[0] + rows[rows.length - 1]) / 2 : nextRow++;
    const size = isBlock(project, id) ? BLOCK_SIZE : POINT_SIZE;
    positions.set(id, {
      x: depth * COLUMN_WIDTH + (BLOCK_SIZE.width - size.width) / 2,
      y: row * ROW_HEIGHT + (BLOCK_SIZE.height - size.height) / 2,
    });
    return row;
  }
  const root = rootNodeId(project);
  // Ramas desconectadas (mientras se carga el árbol) van debajo, cada una con su raíz.
  for (const id of [root, ...project.nodes.map((n) => n.id)]) {
    if (id !== undefined && !positions.has(id)) {
      place(id, 0, null);
      nextRow++;
    }
  }
  return positions;
}
