import type { ReactNode } from "react";
import type { Library, Part } from "../../model/library";

/** Piezas comunes de las pestañas de la biblioteca. */

export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

/** Search box + result count, shared look across every library tab. */
export function FilterBar({ search, setSearch, placeholder, count, total, children }: {
  search: string;
  setSearch: (s: string) => void;
  placeholder: string;
  count: number;
  total: number;
  children?: ReactNode;
}) {
  return (
    <div className="toolbar">
      <input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder={placeholder} style={{ width: "16em" }} />
      {children}
      <span className="status">{count} of {total}</span>
    </div>
  );
}

/** Columns common to every Part: part number, manufacturer, price. */
export function PartFields({ part, onChange }: { part: Part; onChange: (patch: Partial<Part>) => void }) {
  return (
    <>
      <td><input value={part.part_number} onChange={(e) => onChange({ part_number: e.currentTarget.value })} placeholder="part number" /></td>
      <td><input value={part.manufacturer ?? ""} onChange={(e) => onChange({ manufacturer: e.currentTarget.value || null })} placeholder="manufacturer" /></td>
      <td>
        <input
          type="number"
          value={part.price_usd ?? ""}
          onChange={(e) => onChange({ price_usd: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}
          placeholder="USD"
        />
      </td>
    </>
  );
}

export interface TabProps {
  library: Library;
  setLibrary: (l: Library) => void;
  partById: (partId: number) => Part | undefined;
}

export const numberOrNull = (text: string) => (text === "" ? null : Number(text));
