/**
 * Diálogos nativos para elegir dónde abrir/guardar un proyecto, la
 * biblioteca o una exportación (plugin dialog de Tauri: explorador de
 * Windows, Finder en Mac).
 */
import { open, save } from "@tauri-apps/plugin-dialog";

type FileKind = "project" | "library" | "csv";

const FILTERS: Record<FileKind, { name: string; extensions: string[] }[]> = {
  project: [{ name: "Harness project", extensions: ["db"] }],
  library: [{ name: "Parts library", extensions: ["db"] }],
  csv: [{ name: "CSV (Excel, label printer software)", extensions: ["csv"] }],
};

/** Una ruta elegida en un diálogo (o guardada antes): se puede guardar ahí sin preguntar. */
export function isChosenPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export async function pickFileToOpen(kind: FileKind): Promise<string | null> {
  const picked = await open({ multiple: false, directory: false, filters: FILTERS[kind] });
  return typeof picked === "string" ? picked : null;
}

export async function pickFileToSave(kind: FileKind, suggestedName: string): Promise<string | null> {
  return save({ filters: FILTERS[kind], defaultPath: suggestedName });
}
