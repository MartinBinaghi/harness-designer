import { optionalNumber } from "../logic/electrical";

/**
 * Número opcional en una celda de tabla. Confirma al salir del campo o con
 * Enter (un solo paso de deshacer, y se puede escribir "0,5" sin que el "0" se
 * borre a mitad de camino); Esc vuelve al valor guardado. Vacío = sin dato. Con
 * `positive`, un 0 o un negativo no se aceptan y el campo vuelve a lo que tenía.
 */
export function OptionalNumberInput({ value, onCommit, positive = false, placeholder, title, width = "5em" }: {
  value: number | null;
  onCommit: (v: number | null) => void;
  positive?: boolean;
  placeholder?: string;
  title?: string;
  width?: string;
}) {
  const commit = (input: HTMLInputElement) => {
    const text = input.value;
    const next = optionalNumber(text, positive);
    if (next === null && text.trim() !== "") {
      input.value = value === null ? "" : String(value); // fuera de rango: no se guarda
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <input
      key={value ?? "empty"}
      type="number"
      min={0}
      step="any"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      title={title}
      style={{ width }}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget);
        if (e.key === "Escape") e.currentTarget.value = value === null ? "" : String(value);
      }}
    />
  );
}
