/**
 * Lectura y formato de los datos de la carga eléctrica en la pantalla. Las
 * reglas (qué corriente lleva cada cable, la caída de tensión, los chequeos)
 * viven en el núcleo (`calc/electrical.rs`); acá solo se lee lo que se escribe y
 * se muestra lo que llega.
 */

/**
 * Un número escrito en un campo opcional: vacío → `null`. Con `positive`, un 0
 * o un negativo también queda vacío: capacidad, resistencia y protección tienen
 * que ser mayores que cero (el archivo no acepta otra cosa). Un consumo de 0 A sí
 * vale (un cable de señal que no lleva corriente).
 */
export function optionalNumber(text: string, positive: boolean): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || (positive && n === 0)) return null;
  return n;
}

export const formatAmps = (a: number | null): string => (a === null ? "—" : `${a.toFixed(1)} A`);

export const formatVolts = (v: number | null): string => (v === null ? "—" : `${v.toFixed(2)} V`);
