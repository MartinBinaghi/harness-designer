// Arma el `latest.json` de una release: lo que la app consulta para saber si hay
// una versión nueva (plugin updater). Va como archivo de la release en GitHub,
// junto al instalador; la app lo busca en .../releases/latest/download/latest.json.
//
// Uso, después de `pnpm tauri build` (con la clave de firma cargada):
//   node tools/release/latest-json.mjs
// Lee la versión de package.json, las notas de docs/releases/v<versión>.md y la
// firma del instalador (.sig), y escribe src-tauri/target/release/bundle/nsis/latest.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "MartinBinaghi/harness-designer";
const root = join(import.meta.dirname, "..", "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const nsis = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const installer = `Harness Designer_${version}_x64-setup.exe`;

const signature = readFileSync(join(nsis, `${installer}.sig`), "utf8").trim();
const notes = readFileSync(join(root, "docs", "releases", `v${version}.md`), "utf8").trim();
// GitHub cambia los espacios del nombre de un archivo subido por puntos.
const url = `https://github.com/${REPO}/releases/download/v${version}/${installer.replaceAll(" ", ".")}`;

const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: { "windows-x86_64": { signature, url } },
};
writeFileSync(join(nsis, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
console.log(`latest.json for ${version} -> ${url}`);
