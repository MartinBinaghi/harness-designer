import type { Library, Part, PartCategory } from "../model/library";
import { nextId } from "./projectEdit";

/** Ediciones de la biblioteca sin React: partes nuevas, borrar, cambiar campos, contraparte. */

function blankPart(id: number, category: PartCategory): Part {
  return {
    id,
    part_number: "",
    manufacturer: null,
    description: null,
    category,
    purchase_unit: "unit",
    qty_per_pack: 1,
    price_usd: null,
    price_date: null,
  };
}

/** Adds a Part of the given category plus its subtype row, in one step. */
export function addPart<K extends keyof Library>(
  library: Library,
  category: PartCategory,
  subtypeKey: K,
  makeSubtype: (partId: number) => Library[K][number],
): Library {
  const partId = nextId(library.parts.map((p) => p.id));
  return {
    ...library,
    parts: [...library.parts, blankPart(partId, category)],
    [subtypeKey]: [...(library[subtypeKey] as unknown[]), makeSubtype(partId)] as Library[K],
  };
}

export function removePart<K extends keyof Library>(library: Library, subtypeKey: K, partId: number): Library {
  return {
    ...library,
    parts: library.parts.filter((p) => p.id !== partId),
    [subtypeKey]: (library[subtypeKey] as { part_id: number }[]).filter((s) => s.part_id !== partId) as Library[K],
  };
}

export function updatePart(library: Library, partId: number, patch: Partial<Part>): Library {
  return { ...library, parts: library.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)) };
}

export function updateSubtype<K extends keyof Library, T extends { part_id: number }>(
  library: Library,
  subtypeKey: K,
  partId: number,
  patch: Partial<T>,
): Library {
  return {
    ...library,
    [subtypeKey]: (library[subtypeKey] as unknown as T[]).map((s) => (s.part_id === partId ? { ...s, ...patch } : s)) as unknown as Library[K],
  };
}

/**
 * Contraparte en los dos sentidos: si A enchufa con B, B enchufa con A. Lo que
 * apuntaba a A o a B antes queda sin contraparte.
 */
export function setCounterpart(library: Library, partId: number, counterpartId: number | null): Library {
  const old = library.connector_defs.find((d) => d.part_id === partId)?.counterpart_id ?? null;
  return {
    ...library,
    connector_defs: library.connector_defs.map((d) => {
      if (d.part_id === partId) return { ...d, counterpart_id: counterpartId };
      if (counterpartId != null && d.part_id === counterpartId) return { ...d, counterpart_id: partId };
      if (d.part_id === old || d.counterpart_id === partId || (counterpartId != null && d.counterpart_id === counterpartId)) {
        return { ...d, counterpart_id: null };
      }
      return d;
    }),
  };
}
