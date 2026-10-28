/**
 * Vista de la cara de un conector dibujada por el programa (no una foto): el
 * contorno de la familia, cada vía en su lugar y su número. Se calcula a partir
 * de la serie y la lista de vías del ConnectorDef, así sirve para cualquier
 * parte de una familia conocida sin cargar imágenes.
 *
 * Fuentes (ver docs/BITACORA.md, "Vista de la cara dibujada"):
 * - Deutsch DT/DTM/DTP: disposición del catálogo "DT Family" de TE; numeración
 *   de los planos de TE (DT04-12PA, DTM04-4P, DTM04-6P) y del catálogo de
 *   bussing de Deutsch (DT 4/6/8/12). El resto se deduce del mismo patrón.
 * - MIL-DTL-38999: coordenadas de cada contacto de MIL-STD-1560.
 * - MIL-DTL-26482 Serie 2: el mismo arreglo de MIL-STD-1560 con esas vías
 *   (el 24-61 del MS3476L24-61P coincide con el 25-61: comparado letra por
 *   letra con fotos de la pieza que pasó Martin).
 * - AMP Superseal 1.0 (26 y 34 vías, los del MoTeC PDM30/M1): vista trasera de
 *   la hembra publicada por Corsa Technic (SS10-26S-X, SS10-34S-X); paso 3 mm,
 *   filas a 3,5 / 4 / 3,5 mm (TE 4-1437290-0).
 *
 * Coordenadas en mm, x a la derecha, y hacia abajo, vista desde la cara de
 * acople (frontal). La vista del lado de los cables es la misma espejada.
 */
import type { ConnectorDef } from "../model/library";

export interface FaceCavity {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface ConnectorFace {
  /**
   * "rect": rectángulo de esquinas poco redondeadas alrededor de las vías
   * (Deutsch); "hull": contorno redondeado que sigue a las vías (Superseal,
   * ovalado; DT de 3 vías, triangular); "circle": circular militar; "d": recto
   * del lado del pin 1 y redondeado del otro (VAG).
   */
  shape: "rect" | "hull" | "circle" | "d";
  /** Margen del contorno alrededor de los centros de las vías (rect, hull) o radio (circle), mm. */
  outline: number;
  /** Traba (Deutsch/Superseal/VAG) o chavetero principal (circular): marca la orientación. "none": sin traba (termocupla). */
  latch: "top" | "sides" | "none";
  cavities: FaceCavity[];
  /** Origen de la numeración, para avisar cuando no se pudo confirmar. */
  numbering: "datasheet" | "inferred" | "standard";
}

/** Arreglos de MIL-STD-1560: código -> [id, tamaño, x, y] (pulgadas, cara frontal del inserto de pines, y hacia arriba). */
export type MilArrangements = Record<string, (string | number)[][]>;

type Grid = [x: number, y: number][]; // en pasos; índice = número de vía - 1

/**
 * Vistas traseras (lado cables) del receptáculo macho, con la traba arriba,
 * en pasos de la grilla: la numeración da la vuelta en U en sentido antihorario.
 */
function deutschRearGrid(ways: number, triangle: boolean): { grid: Grid; checked: boolean } | null {
  const half = ways / 2;
  if (ways === 2) return { grid: [[0, 0], [1, 0]], checked: false };
  if (ways === 3)
    return triangle
      ? { grid: [[0, 0], [0.5, 0.87], [1, 0]], checked: false }
      : { grid: [[2, 0], [1, 0], [0, 0]], checked: true }; // confirmado por Martin: hembra con la 3 a la izquierda
  if (ways === 4 || ways === 6) {
    // Dos columnas: baja por la izquierda, sube por la derecha.
    const left = Array.from({ length: half }, (_, i): [number, number] => [0, i]);
    const right = Array.from({ length: half }, (_, i): [number, number] => [1, half - 1 - i]);
    return { grid: [...left, ...right], checked: true };
  }
  if (ways === 8 || ways === 12) {
    // Dos filas: va por la de abajo hacia la derecha y vuelve por la de arriba.
    const bottom = Array.from({ length: half }, (_, i): [number, number] => [i, 1]);
    const top = Array.from({ length: half }, (_, i): [number, number] => [half - 1 - i, 0]);
    return { grid: [...bottom, ...top], checked: true };
  }
  return null;
}

/** Paso entre vías (mm) por familia; el dibujo es proporcionado, no un plano. */
const PITCH: Record<string, number> = { DT: 5.5, DTM: 4.2, DTP: 7.5, SUPERSEAL: 3.5 };

/** Radio dibujado del contacto (pulgadas) por tamaño MIL. */
const MIL_CONTACT_R: Record<string, number> = {
  "23-22": 0.02, "22D": 0.022, "22M": 0.022, "22": 0.022, "20": 0.03, "16": 0.045,
  "12": 0.065, "10": 0.08, "8": 0.1, "4": 0.14, "0": 0.2,
};

function family(series: string | null): string | null {
  const s = (series ?? "").trim().toUpperCase();
  if (s === "DT" || s === "DTM" || s === "DTP") return s;
  if (/^SUPERSEAL\s*1\.0/.test(s)) return "SUPERSEAL10";
  if (/^VAG\b/.test(s)) return "VAG";
  if (/^MINI\s*TIMER/.test(s)) return "MINITIMER";
  if (s.includes("THERMOCOUPLE")) return "TC";
  if (s.startsWith("SUPERSEAL")) return "SUPERSEAL";
  if (/38999|27599|29600/.test(s)) return "MIL";
  if (/26482/.test(s)) return "MIL26482";
  return null;
}

const mirror = (cavities: FaceCavity[]) => cavities.map((c) => ({ ...c, x: -c.x }));

/** Cara frontal del conector, o null si la familia o la lista de vías no se reconocen. */
export function connectorFace(def: ConnectorDef, mil: MilArrangements): ConnectorFace | null {
  const fam = family(def.series);
  if (!fam || def.cavities.length === 0) return null;
  if (fam === "MIL") return milFace(def, mil);
  if (fam === "MIL26482") {
    const face = milFace(def, mil);
    return face && { ...face, numbering: "datasheet" };
  }
  if (fam === "SUPERSEAL10") return superseal10Face(def);
  if (fam === "VAG") return vagFace(def);
  if (fam === "MINITIMER") return miniTimerFace(def);
  if (fam === "TC") return thermocoupleFace(def);

  const ways = def.cavities.length;
  // La grilla se indexa por número de vía: 1..n, o A.. (el DT de 3 vías va A, B, C).
  const ids = new Set(def.cavities.map((c) => c.cavity_id));
  const labels = [(i: number) => String(i + 1), (i: number) => String.fromCharCode(65 + i)]
    .map((label) => Array.from({ length: ways }, (_, i) => label(i)))
    .find((list) => list.every((id) => ids.has(id)));
  if (!labels) return null;

  let layout: { grid: Grid; checked: boolean } | null;
  if (fam === "SUPERSEAL") {
    layout = { grid: Array.from({ length: ways }, (_, i): [number, number] => [i, 0]), checked: false };
  } else {
    layout = deutschRearGrid(ways, fam === "DT");
    // Confirmados en planos/catálogo: DT 4/6/8/12 y DTM 4/6; DTM 3, por Martin; el resto sigue el patrón.
    if (layout && fam !== "DT" && !(fam === "DTM" && (ways === 3 || ways === 4 || ways === 6))) layout.checked = false;
  }
  if (!layout) return null;

  const p = PITCH[fam];
  const xs = layout.grid.map(([x]) => x);
  const ys = layout.grid.map(([, y]) => y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rear = layout.grid.map(([x, y], i) => ({ id: labels[i], x: (x - cx) * p, y: (y - cy) * p, r: p * 0.32 }));
  // Superseal es ovalado y el DT de 3 vías triangular; las demás Deutsch, rectangulares.
  const rounded = fam === "SUPERSEAL" || (fam === "DT" && ways === 3);
  // Cara del macho = su vista trasera espejada; la hembra enfrenta al macho, así
  // que su cara coincide con la vista trasera del macho.
  return {
    shape: rounded ? "hull" : "rect",
    outline: p * (rounded ? 0.75 : 0.8),
    latch: fam === "DT" && ways === 12 ? "sides" : "top",
    cavities: def.gender === "male" ? mirror(rear) : rear,
    numbering: layout.checked ? "datasheet" : "inferred",
  };
}

/**
 * Vías por fila del Superseal 1.0, mirando la hembra desde atrás con la traba
 * arriba: de izquierda a derecha y de arriba abajo; las filas del medio,
 * centradas (corridas medio paso).
 */
const SUPERSEAL10_ROWS: Record<number, number[]> = { 26: [7, 6, 6, 7], 34: [9, 8, 8, 9] };
const SUPERSEAL10_ROW_Y = [0, 3.5, 7.5, 11];

function superseal10Face(def: ConnectorDef): ConnectorFace | null {
  const ways = def.cavities.length;
  const rows = SUPERSEAL10_ROWS[ways];
  const ids = new Set(def.cavities.map((c) => c.cavity_id));
  if (!rows || !Array.from({ length: ways }, (_, i) => String(i + 1)).every((id) => ids.has(id))) return null;
  const pitch = 3;
  const femaleRear: FaceCavity[] = [];
  rows.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      femaleRear.push({ id: String(femaleRear.length + 1), x: (i - (count - 1) / 2) * pitch, y: SUPERSEAL10_ROW_Y[row] - 5.5, r: pitch * 0.42 });
    }
  });
  // La cara de la hembra es su vista trasera espejada; la del macho, la trasera de la hembra.
  return { shape: "rect", outline: pitch * 0.8, latch: "top", cavities: def.gender === "female" ? mirror(femaleRear) : femaleRear, numbering: "datasheet" };
}

/**
 * Conectores VAG (Audi/VW) de bobina y de sonda lambda (datos de Martin):
 * carcasa recta del lado del pin 1 y redondeada del otro, traba arriba.
 * Cara de acople de la hembra, pin 1 a la izquierda:
 * - 2–4 vías en una fila, de izquierda a derecha;
 * - 6 vías por columnas: 1 abajo a la izquierda, 2 arriba de él, 3 abajo al
 *   medio, 4 arriba, 5 abajo a la derecha, 6 arriba.
 * El macho es su espejo (pin 1 a la derecha).
 */
function vagFace(def: ConnectorDef): ConnectorFace | null {
  const ways = def.cavities.length;
  const ids = new Set(def.cavities.map((c) => c.cavity_id));
  if (![2, 3, 4, 6].includes(ways) || !Array.from({ length: ways }, (_, i) => String(i + 1)).every((id) => ids.has(id))) return null;
  const pitch = 4.5;
  const at = (n: number): [number, number] =>
    ways === 6
      ? [(Math.floor(n / 2) - 1) * pitch, n % 2 === 0 ? pitch / 2 : -pitch / 2] // y hacia abajo: par = fila de abajo
      : [(n - (ways - 1) / 2) * pitch, 0];
  const femaleFace: FaceCavity[] = Array.from({ length: ways }, (_, n) => {
    const [x, y] = at(n);
    return { id: String(n + 1), x, y, r: pitch * 0.32 };
  });
  return { shape: "d", outline: pitch * 0.8, latch: "top", cavities: def.gender === "male" ? mirror(femaleFace) : femaleFace, numbering: "datasheet" };
}

/**
 * Fichas Mini Timer en línea (2–4 vías, ej. la ficha original de un sensor de
 * 3 vías A-B-C): carcasa rectangular con la traba arriba. En la cara de acople
 * de la hembra las vías van de izquierda a derecha en su orden (A a la
 * izquierda, dato de Martin); el macho es su espejo.
 */
function miniTimerFace(def: ConnectorDef): ConnectorFace | null {
  const ways = def.cavities.length;
  if (ways < 2 || ways > 4) return null;
  const pitch = 5;
  const femaleFace = def.cavities.map((c, i) => ({ id: c.cavity_id, x: (i - (ways - 1) / 2) * pitch, y: 0, r: pitch * 0.32 }));
  return { shape: "rect", outline: pitch * 0.75, latch: "top", cavities: def.gender === "male" ? mirror(femaleFace) : femaleFace, numbering: "inferred" };
}

/**
 * Termocupla miniatura (enchufe plano tipo K, amarillo): dos vías "+" y "−"
 * (la negativa es la de pata más ancha), sin traba.
 */
function thermocoupleFace(def: ConnectorDef): ConnectorFace | null {
  const ids = def.cavities.map((c) => c.cavity_id);
  if (ids.length !== 2 || !ids.includes("+") || !ids.includes("-")) return null;
  const pitch = 7.9;
  const cavities = [
    { id: "+", x: -pitch / 2, y: 0, r: 1.6 },
    { id: "-", x: pitch / 2, y: 0, r: 1.6 },
  ];
  return { shape: "rect", outline: 4.5, latch: "none", cavities: def.gender === "female" ? mirror(cavities) : cavities, numbering: "inferred" };
}

/**
 * Inserto MIL-STD-1560: el arreglo cuyo juego de vías (id y tamaño) coincide
 * con el del ConnectorDef, prefiriendo el de su tamaño de carcasa.
 */
function milFace(def: ConnectorDef, mil: MilArrangements): ConnectorFace | null {
  const key = (cs: { id: string; size: string }[]) => cs.map((c) => `${c.id}:${c.size}`).sort().join(",");
  const want = key(def.cavities.map((c) => ({ id: c.cavity_id, size: c.contact_size })));
  const matches = Object.entries(mil).filter(([, cs]) => key(cs.map(([id, size]) => ({ id: String(id), size: String(size) }))) === want);
  const shell = (def.shell_size ?? "").trim();
  const [, contacts] = matches.find(([code]) => code.split("-")[0] === shell) ?? matches[0] ?? [];
  if (!contacts) return null;

  const mm = 25.4;
  const pins = contacts.map(([id, size, x, y]) => ({
    id: String(id),
    x: Number(x) * mm,
    y: -Number(y) * mm,
    r: (MIL_CONTACT_R[String(size)] ?? 0.03) * mm,
  }));
  const radius = Math.max(...pins.map((c) => Math.hypot(c.x, c.y) + c.r)) + 0.06 * mm;
  // La norma dibuja la cara del inserto de pines; el de sockets es el opuesto.
  return { shape: "circle", outline: radius, latch: "top", cavities: def.gender === "female" ? mirror(pins) : pins, numbering: "standard" };
}

/** Vista desde el lado de los cables (por donde se insertan los contactos). */
export function wireSide(face: ConnectorFace): ConnectorFace {
  return { ...face, cavities: mirror(face.cavities) };
}

/** Envolvente convexa de los centros (cadena monótona); con trazo grueso y uniones redondeadas da el contorno. */
export function hull(face: ConnectorFace): [number, number][] {
  const pts = face.cavities.map((c): [number, number] => [c.x, c.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]) => {
    const out: [number, number][] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 1e-9) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** Distancia mínima entre centros de vías (para el tamaño de los números). */
export function minSpacing(face: ConnectorFace): number {
  let d = Infinity;
  const cs = face.cavities;
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) d = Math.min(d, Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y));
  return Number.isFinite(d) ? d : face.outline;
}
