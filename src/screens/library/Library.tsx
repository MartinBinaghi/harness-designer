import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Library, Part } from "../../model/library";
import { FolderIcon } from "../../components/icons";
import { fileName, pickFileToOpen, pickFileToSave } from "../../platform/fileDialogs";
import type { ProjectData } from "../../model/project";
import { ConnectorDefsTab } from "./ConnectorsTab";
import { DeviceDefsTab } from "./DevicesTab";
import { AccessoryDefsTab, ComponentDefsTab, ContactDefsTab, CoveringDefsTab, SealPlugDefsTab, SpliceDefsTab, TMoldDefsTab, WireDefsTab } from "./PartTabs";
import { SignalTypesTab } from "./SignalTypesTab";

const TABS = [
  "Connectors",
  "Devices",
  "Contacts",
  "Seal plugs",
  "Wires",
  "Splices",
  "Components",
  "Coverings",
  "Boots",
  "T-molds",
  "Color code",
] as const;
type Tab = (typeof TABS)[number];

interface ScreenProps {
  library: Library;
  setLibrary: (l: Library) => void;
  /** El backend ya tiene la biblioteca nueva (open_library/demo_library); esto solo refleja el espejo local. */
  loadLibrary: (l: Library) => void;
  /** Descarta cualquier edición pendiente antes de reemplazar el documento entero. */
  cancelLibraryEdits: () => void;
  /** Manda cualquier edición pendiente al backend ya, sin esperar la pausa de tipeo. */
  flushLibraryEdits: () => Promise<void>;
  filePath: string;
  setFilePath: (p: string) => void;
  /** Proyecto abierto, para mostrar dónde se usa cada conector. */
  project: ProjectData | null;
}

export default function LibraryScreen({ library, setLibrary, loadLibrary, cancelLibraryEdits, flushLibraryEdits, filePath, setFilePath, project }: ScreenProps) {
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<Tab>("Connectors");

  async function openLibrary() {
    const path = await pickFileToOpen("library");
    if (!path) return;
    cancelLibraryEdits();
    try {
      const data = await invoke<Library>("open_library", { path });
      loadLibrary(data);
      setFilePath(path);
      setStatus(`Opened ${fileName(path)}`);
    } catch (err) {
      setStatus(`Error opening file: ${err}`);
    }
  }

  // Los cambios se guardan solos en el archivo abierto; "Save as" lo copia a
  // otro archivo, que pasa a ser el de la biblioteca (y el que se abre al iniciar).
  async function saveLibraryAs() {
    const path = await pickFileToSave("library", "library.db");
    if (!path) return;
    try {
      await flushLibraryEdits();
      await invoke("save_library", { path });
      setFilePath(path);
      setStatus(`Saved ${fileName(path)}`);
    } catch (err) {
      setStatus(`Error saving file: ${err}`);
    }
  }

  // Suma las partes estandarizadas que falten (DT/DTM/DTP con contactos y tapones, Superseal, M22759/32, termos) como
  // una edición más: se puede deshacer, y no toca lo que ya estaba cargado.
  async function addBaseParts() {
    const merged = await invoke<Library>("merge_base_library", { library });
    const added = merged.parts.length - library.parts.length;
    setLibrary(merged);
    setStatus(added > 0 ? `Added ${added} standard parts (unverified — check each datasheet).` : "Standard parts already in the library.");
  }

  function partById(partId: number): Part | undefined {
    return library.parts.find((p) => p.id === partId);
  }

  return (
    <>
      <section className="toolbar">
        <span className="file-name" title={filePath ? `${filePath} — changes are saved automatically` : undefined}>{filePath ? fileName(filePath) : "No library file"}</span>
        <span className="hint" style={{ margin: 0 }}>Saved automatically</span>
        <button className="icon-button" onClick={() => void openLibrary()} title="Open another library…" aria-label="Open library file">
          <FolderIcon />
        </button>
        <button onClick={() => void saveLibraryAs()}>Save as…</button>
        <button onClick={() => void addBaseParts()} title="Deutsch DT/DTM/DTP housings with their contacts and sealing plugs, TE Superseal 1.5 housings, M22759/32 wire 26–12 AWG, Raychem DR-25 and ATUM heat-shrink. No prices.">
          Add standard parts
        </button>
        {status && <span className="status">{status}</span>}
      </section>

      <section className="tabs">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} disabled={t === tab}>{t}</button>
        ))}
      </section>

      {tab === "Connectors" && (
        <ConnectorDefsTab library={library} setLibrary={setLibrary} partById={partById} project={project} />
      )}
      {tab === "Devices" && (
        <DeviceDefsTab library={library} setLibrary={setLibrary} partById={partById} />
      )}
      {tab === "Contacts" && (
        <ContactDefsTab library={library} setLibrary={setLibrary} partById={partById} />
      )}
      {tab === "Seal plugs" && (
        <SealPlugDefsTab library={library} setLibrary={setLibrary} partById={partById} />
      )}
      {tab === "Wires" && (
        <WireDefsTab library={library} setLibrary={setLibrary} partById={partById} />
      )}
      {tab === "Splices" && (
        <SpliceDefsTab library={library} setLibrary={setLibrary} partById={partById} />
      )}
      {tab === "Components" && (
        <ComponentDefsTab library={library} setLibrary={setLibrary} partById={partById} />
      )}
      {tab === "Coverings" && (
        <CoveringDefsTab library={library} setLibrary={setLibrary} partById={partById} />
      )}
      {tab === "Boots" && (
        <AccessoryDefsTab library={library} setLibrary={setLibrary} partById={partById} />
      )}
      {tab === "T-molds" && (
        <TMoldDefsTab library={library} setLibrary={setLibrary} partById={partById} />
      )}
      {tab === "Color code" && <SignalTypesTab library={library} setLibrary={setLibrary} />}
    </>
  );
}
