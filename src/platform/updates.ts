/**
 * Versión instalada y actualizaciones (plugin updater de Tauri). Las versiones
 * nuevas se publican en las releases de GitHub con un `latest.json` firmado
 * (ver tools/release/latest-json.mjs); el plugin solo instala lo firmado con la
 * clave del taller. En Windows instala en modo actualización: reemplaza la
 * versión anterior sin desinstalarla, conserva los datos y vuelve a abrir la app.
 */
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type { Update };

export const installedVersion = getVersion;

/** La versión nueva publicada, o null si la instalada es la última. Sin internet, falla. */
export function findUpdate(): Promise<Update | null> {
  return check();
}

/** Baja e instala la versión nueva. En Windows la app se cierra para instalarla y se vuelve a abrir. */
export async function installUpdate(update: Update, onProgress: (percent: number | null) => void): Promise<void> {
  let total = 0;
  let done = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    if (event.event === "Progress") {
      done += event.data.chunkLength;
      onProgress(total > 0 ? Math.round((done / total) * 100) : null);
    }
  });
}
