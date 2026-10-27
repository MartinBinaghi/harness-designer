import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Fotos de los conectores (frontal con la numeración, lateral, trasera). Viven
 * en el archivo de la biblioteca, aparte de las fichas (ver library.sql): no
 * viajan con cada edición de la biblioteca. Acá se guarda qué fotos hay (la
 * lista, liviana) y se trae cada una recién cuando se muestra, una sola vez.
 * Cargar o sacar una foto se escribe directo, como un adjunto (no entra en
 * deshacer).
 */

export type ImageView = "front" | "side" | "back";

export const IMAGE_VIEWS: { view: ImageView; label: string }[] = [
  { view: "front", label: "Front" },
  { view: "side", label: "Side" },
  { view: "back", label: "Back" },
];

let index = new Map<number, Set<ImageView>>();
const fetched = new Map<string, Promise<string | null>>();
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const key = (partId: number, view: ImageView) => `${partId}:${view}`;

/** Vuelve a leer qué fotos hay (al abrir otra biblioteca). */
export async function reloadConnectorImages(): Promise<void> {
  const raw = await invoke<Record<string, ImageView[]>>("connector_image_index");
  index = new Map(Object.entries(raw).map(([partId, views]) => [Number(partId), new Set(views)]));
  fetched.clear();
  changed();
}

/** Pone una foto (data URL ya achicada) o, con null, la saca. */
export async function setConnectorImage(partId: number, view: ImageView, data: string | null): Promise<void> {
  await invoke("set_connector_image", { partId, view, data });
  const views = new Set(index.get(partId));
  if (data) views.add(view);
  else views.delete(view);
  index = new Map(index).set(partId, views);
  fetched.set(key(partId, view), Promise.resolve(data));
  changed();
}

function fetchImage(partId: number, view: ImageView): Promise<string | null> {
  const k = key(partId, view);
  let pending = fetched.get(k);
  if (!pending) {
    pending = invoke<string | null>("connector_image", { partId, view }).catch(() => {
      fetched.delete(k); // un error no queda guardado: se reintenta la próxima vez
      return null;
    });
    fetched.set(k, pending);
  }
  return pending;
}

/** Qué vistas tienen foto para una parte. */
export function useImageViews(partId: number | null | undefined): ImageView[] {
  useSyncExternalStore(subscribe, () => version);
  const views = partId == null ? undefined : index.get(partId);
  return IMAGE_VIEWS.map((v) => v.view).filter((v) => views?.has(v));
}

/** La foto (data URL); null si no hay; undefined mientras se trae. */
export function useConnectorImage(partId: number | null | undefined, view: ImageView): string | null | undefined {
  const current = useSyncExternalStore(subscribe, () => version);
  const present = partId != null && (index.get(partId)?.has(view) ?? false);
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!present || partId == null) return;
    let cancelled = false;
    void fetchImage(partId, view).then((data) => {
      if (!cancelled) setSrc(data);
    });
    return () => {
      cancelled = true;
    };
  }, [partId, view, present, current]);
  return present ? src : null;
}
