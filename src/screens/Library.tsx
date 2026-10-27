import { useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import type {
  AccessoryDef,
  AccessoryDefConnectorMatch,
  ComponentDef,
  ConnectorDef,
  ContactDef,
  CoveringDef,
  DeviceDef,
  DeviceDefConnector,
  Library,
  Part,
  PartCategory,
  SealPlugDef,
  SignalType,
  SpliceDef,
  TMoldDef,
  TMoldLeg,
  WireDef,
} from "./libraryTypes";
import { FolderIcon, PencilIcon, TrashIcon } from "./icons";
import { fileName, pickFileToOpen, pickFileToSave } from "./fileDialogs";
import { readImageAsDataUrl } from "./imageFile";
import { partLabel } from "./libraryTypes";
import { IMAGE_VIEWS, setConnectorImage, useConnectorImage, type ImageView } from "./connectorImages";
import type { ProjectData } from "./types";
import milStd1560 from "./data/mil-std-1560.json";
import { connectorFace, type MilArrangements } from "./connectorFace";
import { ConnectorFaceView } from "./ConnectorFaceView";
import { nextId } from "./projectEdit";
import { applyPaste, devicePinRows, guessRoles, nextDeviceId, parsePinout, previewPaste, setDevicePin, type ColumnRole, type PasteRow } from "./devicePins";

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
function addPart<K extends keyof Library>(
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

function removePart<K extends keyof Library>(library: Library, subtypeKey: K, partId: number): Library {
  return {
    ...library,
    parts: library.parts.filter((p) => p.id !== partId),
    [subtypeKey]: (library[subtypeKey] as { part_id: number }[]).filter((s) => s.part_id !== partId) as Library[K],
  };
}

function updatePart(library: Library, partId: number, patch: Partial<Part>): Library {
  return { ...library, parts: library.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)) };
}

function updateSubtype<K extends keyof Library, T extends { part_id: number }>(
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

function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

/** Search box + result count, shared look across every library tab. */
function FilterBar({ search, setSearch, placeholder, count, total, children }: {
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
function PartFields({ part, onChange }: { part: Part; onChange: (patch: Partial<Part>) => void }) {
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

interface TabProps {
  library: Library;
  setLibrary: (l: Library) => void;
  partById: (partId: number) => Part | undefined;
}

function ContactDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState("");

  const visible = library.contact_defs.filter((cd) => {
    if (genderFilter && cd.gender !== genderFilter) return false;
    const part = partById(cd.part_id);
    return matchesSearch(search, [part?.part_number, part?.manufacturer, cd.contact_size]);
  });

  return (
    <section>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search part number, manufacturer, size…" count={visible.length} total={library.contact_defs.length}>
        <select value={genderFilter} onChange={(e) => setGenderFilter(e.currentTarget.value)}>
          <option value="">All genders</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </FilterBar>
      <table>
        <thead>
          <tr><th>Part number</th><th>Manufacturer</th><th>USD</th><th>Gender</th><th>Contact size</th><th>Min. gauge</th><th>Max. gauge</th><th></th></tr>
        </thead>
        <tbody>
          {visible.map((cd) => {
            const part = partById(cd.part_id);
            if (!part) return null;
            return (
              <tr key={cd.part_id}>
                <PartFields part={part} onChange={(patch) => setLibrary(updatePart(library, part.id, patch))} />
                <td>
                  <select value={cd.gender} onChange={(e) => setLibrary(updateSubtype<"contact_defs", ContactDef>(library, "contact_defs", cd.part_id, { gender: e.currentTarget.value as ContactDef["gender"] }))}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </td>
                <td><input value={cd.contact_size} onChange={(e) => setLibrary(updateSubtype<"contact_defs", ContactDef>(library, "contact_defs", cd.part_id, { contact_size: e.currentTarget.value }))} /></td>
                <td><input value={cd.gauge_min ?? ""} onChange={(e) => setLibrary(updateSubtype<"contact_defs", ContactDef>(library, "contact_defs", cd.part_id, { gauge_min: e.currentTarget.value || null }))} /></td>
                <td><input value={cd.gauge_max ?? ""} onChange={(e) => setLibrary(updateSubtype<"contact_defs", ContactDef>(library, "contact_defs", cd.part_id, { gauge_max: e.currentTarget.value || null }))} /></td>
                <td>
                  <button className="icon-button" onClick={() => setLibrary(removePart(library, "contact_defs", cd.part_id))} title="Delete" aria-label="Delete contact">
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="button-ghost-accent" onClick={() => setLibrary(addPart(library, "contact", "contact_defs", (partId) => ({ part_id: partId, gender: "male", contact_size: "", gauge_min: null, gauge_max: null })))}>+ New</button>
    </section>
  );
}

function SealPlugDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");

  const visible = library.seal_plug_defs.filter((sp) => {
    const part = partById(sp.part_id);
    return matchesSearch(search, [part?.part_number, part?.manufacturer, sp.contact_size]);
  });

  return (
    <section>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search part number, manufacturer, size…" count={visible.length} total={library.seal_plug_defs.length} />
      <table>
        <thead>
          <tr><th>Part number</th><th>Manufacturer</th><th>USD</th><th>Contact size</th><th></th></tr>
        </thead>
        <tbody>
          {visible.map((sp) => {
            const part = partById(sp.part_id);
            if (!part) return null;
            return (
              <tr key={sp.part_id}>
                <PartFields part={part} onChange={(patch) => setLibrary(updatePart(library, part.id, patch))} />
                <td><input value={sp.contact_size} onChange={(e) => setLibrary(updateSubtype<"seal_plug_defs", SealPlugDef>(library, "seal_plug_defs", sp.part_id, { contact_size: e.currentTarget.value }))} /></td>
                <td>
                  <button className="icon-button" onClick={() => setLibrary(removePart(library, "seal_plug_defs", sp.part_id))} title="Delete" aria-label="Delete seal plug">
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="button-ghost-accent" onClick={() => setLibrary(addPart(library, "seal_plug", "seal_plug_defs", (partId) => ({ part_id: partId, contact_size: "" })))}>+ New</button>
    </section>
  );
}

function WireDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");
  const [gaugeFilter, setGaugeFilter] = useState("");
  const gauges = Array.from(new Set(library.wire_defs.map((wd) => wd.gauge))).sort();

  const visible = library.wire_defs.filter((wd) => {
    if (gaugeFilter && wd.gauge !== gaugeFilter) return false;
    const part = partById(wd.part_id);
    return matchesSearch(search, [part?.part_number, part?.manufacturer, wd.gauge, wd.spec, wd.color]);
  });

  return (
    <section>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search part number, manufacturer, spec, color…" count={visible.length} total={library.wire_defs.length}>
        <select value={gaugeFilter} onChange={(e) => setGaugeFilter(e.currentTarget.value)}>
          <option value="">All gauges</option>
          {gauges.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </FilterBar>
      <table>
        <thead>
          <tr><th>Part number</th><th>Manufacturer</th><th>USD</th><th>Gauge</th><th>Spec</th><th>Color</th><th>OD (mm)</th><th>Cut margin %</th><th></th></tr>
        </thead>
        <tbody>
          {visible.map((wd) => {
            const part = partById(wd.part_id);
            if (!part) return null;
            return (
              <tr key={wd.part_id}>
                <PartFields part={part} onChange={(patch) => setLibrary(updatePart(library, part.id, patch))} />
                <td><input value={wd.gauge} onChange={(e) => setLibrary(updateSubtype<"wire_defs", WireDef>(library, "wire_defs", wd.part_id, { gauge: e.currentTarget.value }))} /></td>
                <td><input value={wd.spec ?? ""} onChange={(e) => setLibrary(updateSubtype<"wire_defs", WireDef>(library, "wire_defs", wd.part_id, { spec: e.currentTarget.value || null }))} /></td>
                <td><input value={wd.color ?? ""} onChange={(e) => setLibrary(updateSubtype<"wire_defs", WireDef>(library, "wire_defs", wd.part_id, { color: e.currentTarget.value || null }))} /></td>
                <td>
                  <input
                    type="number"
                    value={wd.outer_diameter_mm}
                    onChange={(e) => setLibrary(updateSubtype<"wire_defs", WireDef>(library, "wire_defs", wd.part_id, { outer_diameter_mm: Number(e.currentTarget.value) }))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={wd.default_cut_margin_pct ?? ""}
                    placeholder="(project default)"
                    onChange={(e) => setLibrary(updateSubtype<"wire_defs", WireDef>(library, "wire_defs", wd.part_id, { default_cut_margin_pct: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) }))}
                  />
                </td>
                <td>
                  <button className="icon-button" onClick={() => setLibrary(removePart(library, "wire_defs", wd.part_id))} title="Delete" aria-label="Delete wire">
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        onClick={() =>
          setLibrary(
            addPart(library, "wire", "wire_defs", (partId) => ({
              part_id: partId,
              gauge: "",
              spec: null,
              color: null,
              outer_diameter_mm: 1,
              default_cut_margin_pct: null,
              conductors: [],
            })),
          )
        }
        className="button-ghost-accent"
      >
        + New
      </button>
    </section>
  );
}

function SpliceDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");

  const visible = library.splice_defs.filter((sd) => {
    const part = partById(sd.part_id);
    return matchesSearch(search, [part?.part_number, part?.manufacturer]);
  });

  return (
    <section>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search part number, manufacturer…" count={visible.length} total={library.splice_defs.length} />
      <table>
        <thead>
          <tr><th>Part number</th><th>Manufacturer</th><th>USD</th><th>Min. gauge</th><th>Max. gauge</th><th>Max. wires</th><th></th></tr>
        </thead>
        <tbody>
          {visible.map((sd) => {
            const part = partById(sd.part_id);
            if (!part) return null;
            return (
              <tr key={sd.part_id}>
                <PartFields part={part} onChange={(patch) => setLibrary(updatePart(library, part.id, patch))} />
                <td><input value={sd.gauge_min ?? ""} onChange={(e) => setLibrary(updateSubtype<"splice_defs", SpliceDef>(library, "splice_defs", sd.part_id, { gauge_min: e.currentTarget.value || null }))} /></td>
                <td><input value={sd.gauge_max ?? ""} onChange={(e) => setLibrary(updateSubtype<"splice_defs", SpliceDef>(library, "splice_defs", sd.part_id, { gauge_max: e.currentTarget.value || null }))} /></td>
                <td>
                  <input
                    type="number"
                    value={sd.max_wires}
                    onChange={(e) => setLibrary(updateSubtype<"splice_defs", SpliceDef>(library, "splice_defs", sd.part_id, { max_wires: Number(e.currentTarget.value) }))}
                  />
                </td>
                <td>
                  <button className="icon-button" onClick={() => setLibrary(removePart(library, "splice_defs", sd.part_id))} title="Delete" aria-label="Delete splice">
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="button-ghost-accent" onClick={() => setLibrary(addPart(library, "splice", "splice_defs", (partId) => ({ part_id: partId, gauge_min: null, gauge_max: null, max_wires: 2 })))}>+ New</button>
    </section>
  );
}

function ComponentDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const types = Array.from(new Set(library.component_defs.map((cd) => cd.component_type).filter(Boolean))).sort();

  const visible = library.component_defs.filter((cd) => {
    if (typeFilter && cd.component_type !== typeFilter) return false;
    const part = partById(cd.part_id);
    return matchesSearch(search, [part?.part_number, part?.manufacturer, cd.component_type, cd.value, cd.package]);
  });

  return (
    <section>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search part number, manufacturer, value…" count={visible.length} total={library.component_defs.length}>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.currentTarget.value)}>
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </FilterBar>
      <table>
        <thead>
          <tr><th>Part number</th><th>Manufacturer</th><th>USD</th><th>Type</th><th>Value</th><th>Package</th><th></th></tr>
        </thead>
        <tbody>
          {visible.map((cd) => {
            const part = partById(cd.part_id);
            if (!part) return null;
            return (
              <tr key={cd.part_id}>
                <PartFields part={part} onChange={(patch) => setLibrary(updatePart(library, part.id, patch))} />
                <td><input value={cd.component_type} onChange={(e) => setLibrary(updateSubtype<"component_defs", ComponentDef>(library, "component_defs", cd.part_id, { component_type: e.currentTarget.value }))} /></td>
                <td><input value={cd.value ?? ""} onChange={(e) => setLibrary(updateSubtype<"component_defs", ComponentDef>(library, "component_defs", cd.part_id, { value: e.currentTarget.value || null }))} /></td>
                <td><input value={cd.package ?? ""} onChange={(e) => setLibrary(updateSubtype<"component_defs", ComponentDef>(library, "component_defs", cd.part_id, { package: e.currentTarget.value || null }))} /></td>
                <td>
                  <button className="icon-button" onClick={() => setLibrary(removePart(library, "component_defs", cd.part_id))} title="Delete" aria-label="Delete component">
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="button-ghost-accent" onClick={() => setLibrary(addPart(library, "component", "component_defs", (partId) => ({ part_id: partId, component_type: "", value: null, package: null })))}>+ New</button>
    </section>
  );
}

function CoveringDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");

  const visible = library.covering_defs.filter((cd) => {
    const part = partById(cd.part_id);
    return matchesSearch(search, [part?.part_number, part?.manufacturer]);
  });

  return (
    <section>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search part number, manufacturer…" count={visible.length} total={library.covering_defs.length} />
      <table>
        <thead>
          <tr><th>Part number</th><th>Manufacturer</th><th>USD</th><th>Supplied (mm)</th><th>Shrunk (mm)</th><th>Wall (mm)</th><th>Adhesive</th><th></th></tr>
        </thead>
        <tbody>
          {visible.map((cd) => {
            const part = partById(cd.part_id);
            if (!part) return null;
            return (
              <tr key={cd.part_id}>
                <PartFields part={part} onChange={(patch) => setLibrary(updatePart(library, part.id, patch))} />
                <td><input type="number" value={cd.supplied_diameter_mm} onChange={(e) => setLibrary(updateSubtype<"covering_defs", CoveringDef>(library, "covering_defs", cd.part_id, { supplied_diameter_mm: Number(e.currentTarget.value) }))} /></td>
                <td><input type="number" value={cd.shrunk_diameter_mm} onChange={(e) => setLibrary(updateSubtype<"covering_defs", CoveringDef>(library, "covering_defs", cd.part_id, { shrunk_diameter_mm: Number(e.currentTarget.value) }))} /></td>
                <td><input type="number" value={cd.shrunk_wall_thickness_mm} onChange={(e) => setLibrary(updateSubtype<"covering_defs", CoveringDef>(library, "covering_defs", cd.part_id, { shrunk_wall_thickness_mm: Number(e.currentTarget.value) }))} /></td>
                <td><input type="checkbox" checked={cd.has_adhesive} onChange={(e) => setLibrary(updateSubtype<"covering_defs", CoveringDef>(library, "covering_defs", cd.part_id, { has_adhesive: e.currentTarget.checked }))} /></td>
                <td>
                  <button className="icon-button" onClick={() => setLibrary(removePart(library, "covering_defs", cd.part_id))} title="Delete" aria-label="Delete covering">
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        onClick={() =>
          setLibrary(
            addPart(library, "covering", "covering_defs", (partId) => ({
              part_id: partId,
              supplied_diameter_mm: 5,
              shrunk_diameter_mm: 2.5,
              shrunk_wall_thickness_mm: 0.3,
              has_adhesive: false,
            })),
          )
        }
        className="button-ghost-accent"
      >
        + New
      </button>
    </section>
  );
}

/** "AMP:CE, DT:06" ↔ compatible_connectors. Formato simple de texto en vez de un editor de lista aparte. */
function matchesText(matches: AccessoryDefConnectorMatch[]): string {
  return matches.map((m) => `${m.series}:${m.shell_size}`).join(", ");
}
function parseMatchesText(text: string): AccessoryDefConnectorMatch[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [series, shell_size] = s.split(":").map((p) => p.trim());
      return { series: series ?? "", shell_size: shell_size ?? "" };
    });
}

function AccessoryDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");

  const visible = library.accessory_defs.filter((ad) => {
    const part = partById(ad.part_id);
    return matchesSearch(search, [part?.part_number, part?.manufacturer, matchesText(ad.compatible_connectors)]);
  });

  return (
    <section>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search part number, manufacturer, series…" count={visible.length} total={library.accessory_defs.length} />
      <table>
        <thead>
          <tr><th>Part number</th><th>Manufacturer</th><th>USD</th><th>Orientation</th><th>Cable min (mm)</th><th>Cable max (mm)</th><th>Leg (mm)</th><th>Overlap (mm)</th><th>Compatible (series:shell, …)</th><th></th></tr>
        </thead>
        <tbody>
          {visible.map((ad) => {
            const part = partById(ad.part_id);
            if (!part) return null;
            return (
              <tr key={ad.part_id}>
                <PartFields part={part} onChange={(patch) => setLibrary(updatePart(library, part.id, patch))} />
                <td>
                  <select value={ad.orientation} onChange={(e) => setLibrary(updateSubtype<"accessory_defs", AccessoryDef>(library, "accessory_defs", ad.part_id, { orientation: e.currentTarget.value as AccessoryDef["orientation"] }))}>
                    <option value="straight">straight</option>
                    <option value="right_angle">right angle</option>
                  </select>
                </td>
                <td><input type="number" value={ad.cable_side_min_diameter_mm} onChange={(e) => setLibrary(updateSubtype<"accessory_defs", AccessoryDef>(library, "accessory_defs", ad.part_id, { cable_side_min_diameter_mm: Number(e.currentTarget.value) }))} /></td>
                <td><input type="number" value={ad.cable_side_max_diameter_mm} onChange={(e) => setLibrary(updateSubtype<"accessory_defs", AccessoryDef>(library, "accessory_defs", ad.part_id, { cable_side_max_diameter_mm: Number(e.currentTarget.value) }))} /></td>
                <td><input type="number" value={ad.leg_length_mm} onChange={(e) => setLibrary(updateSubtype<"accessory_defs", AccessoryDef>(library, "accessory_defs", ad.part_id, { leg_length_mm: Number(e.currentTarget.value) }))} /></td>
                <td><input type="number" value={ad.overlap_mm} onChange={(e) => setLibrary(updateSubtype<"accessory_defs", AccessoryDef>(library, "accessory_defs", ad.part_id, { overlap_mm: Number(e.currentTarget.value) }))} /></td>
                <td><input value={matchesText(ad.compatible_connectors)} onChange={(e) => setLibrary(updateSubtype<"accessory_defs", AccessoryDef>(library, "accessory_defs", ad.part_id, { compatible_connectors: parseMatchesText(e.currentTarget.value) }))} style={{ width: "10em" }} /></td>
                <td>
                  <button className="icon-button" onClick={() => setLibrary(removePart(library, "accessory_defs", ad.part_id))} title="Delete" aria-label="Delete boot">
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        onClick={() =>
          setLibrary(
            addPart(library, "accessory", "accessory_defs", (partId) => ({
              part_id: partId,
              orientation: "straight",
              cable_side_min_diameter_mm: 3,
              cable_side_max_diameter_mm: 8,
              leg_length_mm: 30,
              overlap_mm: 15,
              compatible_connectors: [],
            })),
          )
        }
        className="button-ghost-accent"
      >
        + New
      </button>
    </section>
  );
}

function blankLeg(): TMoldLeg {
  return { min_diameter_mm: 0, max_diameter_mm: 10, leg_length_mm: 30 };
}

function TMoldDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");

  function updateTd(partId: number, patch: Partial<TMoldDef>) {
    setLibrary(updateSubtype<"t_mold_defs", TMoldDef>(library, "t_mold_defs", partId, patch));
  }
  function updateLeg(td: TMoldDef, index: number, patch: Partial<TMoldLeg>) {
    updateTd(td.part_id, { legs: td.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)) });
  }

  const visible = library.t_mold_defs.filter((td) => {
    const part = partById(td.part_id);
    return matchesSearch(search, [part?.part_number, part?.manufacturer]);
  });

  return (
    <section>
      <p className="hint">
        Breakout T-mold: three legs, no fixed "inlet" leg in the catalog. Legs are matched to the breakout's
        segments by diameter, largest to largest, when checking fit.
      </p>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search part number, manufacturer…" count={visible.length} total={library.t_mold_defs.length} />
      {visible.map((td) => {
        const part = partById(td.part_id);
        if (!part) return null;
        return (
          <div key={td.part_id} className="query-result" style={{ marginBottom: "1rem" }}>
            <table>
              <thead><tr><th>Part number</th><th>Manufacturer</th><th>USD</th><th>Overlap (mm)</th><th></th></tr></thead>
              <tbody>
                <tr>
                  <PartFields part={part} onChange={(patch) => setLibrary(updatePart(library, part.id, patch))} />
                  <td><input type="number" value={td.overlap_mm} onChange={(e) => updateTd(td.part_id, { overlap_mm: Number(e.currentTarget.value) })} /></td>
                  <td>
                    <button className="icon-button" onClick={() => setLibrary(removePart(library, "t_mold_defs", td.part_id))} title="Delete" aria-label="Delete T-mold">
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <strong>Legs</strong>
            <table>
              <thead><tr><th>Min Ø (mm)</th><th>Max Ø (mm)</th><th>Length (mm)</th></tr></thead>
              <tbody>
                {td.legs.map((leg, i) => (
                  <tr key={i}>
                    <td><input type="number" value={leg.min_diameter_mm} onChange={(e) => updateLeg(td, i, { min_diameter_mm: Number(e.currentTarget.value) })} /></td>
                    <td><input type="number" value={leg.max_diameter_mm} onChange={(e) => updateLeg(td, i, { max_diameter_mm: Number(e.currentTarget.value) })} /></td>
                    <td><input type="number" value={leg.leg_length_mm} onChange={(e) => updateLeg(td, i, { leg_length_mm: Number(e.currentTarget.value) })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <button
        onClick={() =>
          setLibrary(
            addPart(library, "accessory", "t_mold_defs", (partId) => ({
              part_id: partId,
              overlap_mm: 20,
              legs: [blankLeg(), blankLeg(), blankLeg()],
            })),
          )
        }
        className="button-ghost-accent"
      >
        + New
      </button>
    </section>
  );
}

function SignalTypesTab({ library, setLibrary }: { library: Library; setLibrary: (l: Library) => void }) {
  const [search, setSearch] = useState("");

  function update(id: number, patch: Partial<SignalType>) {
    setLibrary({ ...library, signal_types: library.signal_types.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }
  function add() {
    const id = nextId(library.signal_types.map((s) => s.id));
    setLibrary({ ...library, signal_types: [...library.signal_types, { id, name: "", default_color: "" }] });
  }
  function remove(id: number) {
    setLibrary({ ...library, signal_types: library.signal_types.filter((s) => s.id !== id) });
  }

  const visible = library.signal_types.filter((st) => matchesSearch(search, [st.name, st.default_color]));

  return (
    <section>
      <p className="hint">
        The default wire color for each category (5V, GND, CAN, 12V…). Not just signal wires — any wire picks its
        suggested color from here based on what it carries.
      </p>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search category, color…" count={visible.length} total={library.signal_types.length} />
      <table>
        <thead>
          <tr><th>Category</th><th>Default color</th><th></th></tr>
        </thead>
        <tbody>
          {visible.map((st) => (
            <tr key={st.id}>
              <td><input value={st.name} onChange={(e) => update(st.id, { name: e.currentTarget.value })} placeholder="e.g. 5V, GND, CAN" /></td>
              <td><input value={st.default_color} onChange={(e) => update(st.id, { default_color: e.currentTarget.value })} placeholder="e.g. violet" /></td>
              <td>
                <button className="icon-button" onClick={() => remove(st.id)} title="Delete" aria-label="Delete color">
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="button-ghost-accent" onClick={add}>+ New</button>
    </section>
  );
}

const numberOrNull = (text: string) => (text === "" ? null : Number(text));

/** Parte trasera del conector: redonda (Ø) o rectangular (ancho × alto, el programa usa la diagonal). */
function BackSizeFields({ cd, onChange }: { cd: ConnectorDef; onChange: (patch: Partial<ConnectorDef>) => void }) {
  return (
    <span className="back-size">
      <select
        value={cd.back_shape ?? ""}
        onChange={(e) => onChange({ back_shape: (e.currentTarget.value || null) as ConnectorDef["back_shape"] })}
        aria-label="Back shape"
      >
        <option value="">—</option>
        <option value="round">Round</option>
        <option value="rectangular">Rect.</option>
      </select>
      {cd.back_shape === "round" && (
        <input type="number" value={cd.back_diameter_mm ?? ""} onChange={(e) => onChange({ back_diameter_mm: numberOrNull(e.currentTarget.value) })} placeholder="Ø" aria-label="Back diameter (mm)" />
      )}
      {cd.back_shape === "rectangular" && (
        <>
          <input type="number" value={cd.back_width_mm ?? ""} onChange={(e) => onChange({ back_width_mm: numberOrNull(e.currentTarget.value) })} placeholder="W" aria-label="Back width (mm)" />
          ×
          <input type="number" value={cd.back_height_mm ?? ""} onChange={(e) => onChange({ back_height_mm: numberOrNull(e.currentTarget.value) })} placeholder="H" aria-label="Back height (mm)" />
        </>
      )}
    </span>
  );
}

type Numbering = "numbers" | "upper" | "lower";
const NUMBERING_LABELS: Record<Numbering, string> = { numbers: "1, 2, 3…", upper: "A, B, C…", lower: "a, b, c…" };

// ponytail: letras solo A–Z / a–z (26 vías); conectores con más vías por letra
// (MIL que saltean I/O/Q, etc.) se cargan con "Edit individually".
function cavityIds(count: number, numbering: Numbering): string[] {
  return Array.from({ length: count }, (_, i) =>
    numbering === "numbers" ? String(i + 1) : String.fromCharCode((numbering === "upper" ? 65 : 97) + i),
  );
}

/** Resumen legible de tamaños de contacto: "20" si son todos iguales, "20 ×4, 16 ×2" si no. */
function contactSizeSummary(cavities: ConnectorDef["cavities"]): string {
  const counts = new Map<string, number>();
  for (const c of cavities) counts.set(c.contact_size || "—", (counts.get(c.contact_size || "—") ?? 0) + 1);
  if (counts.size === 1) return `contact size ${[...counts.keys()][0]}`;
  return `contact sizes ${[...counts].map(([size, n]) => `${size} ×${n}`).join(", ")}`;
}

/** Arreglos de inserto MIL-DTL-38999 (MIL-STD-1560): "13-35" -> [[id, tamaño, x, y], ...]. */
const MIL_INSERTS = milStd1560.arrangements as MilArrangements;

function insertLabel(code: string): string {
  const counts = new Map<string, number>();
  for (const [, size] of MIL_INSERTS[code]) counts.set(String(size), (counts.get(String(size)) ?? 0) + 1);
  return `${code} · ${[...counts].map(([size, n]) => `${n} × ${size}`).join(", ")}`;
}

/**
 * Fotos del conector (frontal con numeración de pines, lateral, trasera): se
 * achican (ver imageFile.ts) y se guardan en el archivo de la biblioteca, aparte
 * de la ficha (ver connectorImages.ts). No entran en deshacer, como un adjunto.
 */
function ConnectorImages({ partId }: { partId: number }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="connector-images">
      <div className="connector-images-row">
        {IMAGE_VIEWS.map(({ view, label }) => (
          <ImageSlot key={view} partId={partId} view={view} label={label} onError={setError} />
        ))}
      </div>
      {error && <p className="diagram-notice">{error}</p>}
    </div>
  );
}

function ImageSlot({ partId, view, label, onError }: { partId: number; view: ImageView; label: string; onError: (e: string | null) => void }) {
  const src = useConnectorImage(partId, view);
  async function load(file: File | undefined) {
    if (!file) return;
    try {
      onError(null);
      await setConnectorImage(partId, view, await readImageAsDataUrl(file));
    } catch (e) {
      onError(`Couldn't load ${file.name}: ${String(e)}`);
    }
  }
  async function remove() {
    if (!(await ask(`Remove the ${label.toLowerCase()} photo? This can't be undone.`, { kind: "warning" }))) return;
    try {
      onError(null);
      await setConnectorImage(partId, view, null);
    } catch (e) {
      onError(`Couldn't remove the photo: ${String(e)}`);
    }
  }
  return (
    <div className="connector-image-slot">
      <div className="connector-image-box">
        {src ? <img src={src} alt={`${label} view`} /> : <span className="hint">{src === undefined ? "…" : "no image"}</span>}
      </div>
      <div className="connector-image-actions">
        <span>{label}</span>
        <label className="link-button">
          {src ? "Replace…" : "Load…"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            hidden
            onChange={(e) => {
              void load(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </label>
        {src && (
          <button className="link-button" onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function generatorDefaults(cavities: ConnectorDef["cavities"]) {
  const first = cavities[0]?.cavity_id ?? "";
  return {
    count: cavities.length || 1,
    numbering: (/^[A-Z]$/.test(first) ? "upper" : /^[a-z]$/.test(first) ? "lower" : "numbers") as Numbering,
    size: cavities[0]?.contact_size ?? "",
  };
}

/**
 * Vías del conector: un generador (cantidad + numeración + tamaño de contacto)
 * para el caso normal, un arreglo de inserto MIL-STD-1560 para los circulares
 * militares, y edición una por una solo para conectores mixtos.
 */
function CavityEditor({ cd, onChange: onPatch }: { cd: ConnectorDef; onChange: (patch: Partial<ConnectorDef>) => void }) {
  const onChange = (cavities: ConnectorDef["cavities"]) => onPatch({ cavities });
  const initial = generatorDefaults(cd.cavities);
  const [count, setCount] = useState(initial.count);
  const [numbering, setNumbering] = useState<Numbering>(initial.numbering);
  const [size, setSize] = useState(initial.size);
  // Con vías ya cargadas se muestra solo el resumen; el lápiz abre la edición.
  const [editing, setEditing] = useState(false);
  const open = editing || cd.cavities.length === 0;
  const maxCount = numbering === "numbers" ? 200 : 26;

  function startEditing() {
    const d = generatorDefaults(cd.cavities);
    setCount(d.count);
    setNumbering(d.numbering);
    setSize(d.size);
    setEditing(true);
  }
  function generate() {
    onChange(cavityIds(Math.min(count, maxCount), numbering).map((id) => ({ cavity_id: id, contact_size: size })));
  }
  function updateCavity(index: number, patch: Partial<ConnectorDef["cavities"][number]>) {
    onChange(cd.cavities.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  return (
    <div className="cavity-editor">
      {cd.cavities.length > 0 && (
        <div className="cavity-summary">
          <span>
            {cd.cavities.length} cavit{cd.cavities.length === 1 ? "y" : "ies"} · {cd.cavities[0].cavity_id}–{cd.cavities[cd.cavities.length - 1].cavity_id} ·{" "}
            {contactSizeSummary(cd.cavities)}
          </span>
          {editing ? (
            <button className="link-button" onClick={() => setEditing(false)}>Done</button>
          ) : (
            <button className="icon-button" onClick={startEditing} title="Edit cavities" aria-label="Edit cavities">
              <PencilIcon />
            </button>
          )}
        </div>
      )}
      {open && (
        <>
          <div className="cavity-generator">
            <label>
              Ways <input type="number" min={1} max={maxCount} value={count} onChange={(e) => setCount(Math.max(1, Number(e.currentTarget.value) || 1))} />
            </label>
            <label>
              Numbering{" "}
              <select value={numbering} onChange={(e) => setNumbering(e.currentTarget.value as Numbering)}>
                {Object.entries(NUMBERING_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Contact size <input value={size} onChange={(e) => setSize(e.currentTarget.value)} placeholder="e.g. 20" />
            </label>
            <button onClick={generate} title={cd.cavities.length > 0 ? "Replaces the current cavity list (can be undone)" : undefined}>
              {cd.cavities.length > 0 ? "Regenerate" : "Generate"}
            </button>
            <label title="Circular MIL-DTL-38999 connectors: shell size + insert arrangement, from MIL-STD-1560C. Replaces the current cavity list.">
              or MIL-STD-1560 insert{" "}
              <select
                value=""
                onChange={(e) => {
                  const code = e.currentTarget.value;
                  if (!code) return;
                  onPatch({
                    shell_size: code.split("-")[0],
                    cavities: MIL_INSERTS[code].map(([id, size]) => ({ cavity_id: String(id), contact_size: String(size) })),
                  });
                }}
              >
                <option value="">choose…</option>
                {Object.keys(MIL_INSERTS).map((code) => (
                  <option key={code} value={code}>{insertLabel(code)}</option>
                ))}
              </select>
            </label>
          </div>
          {cd.cavities.length > 0 && (
            <>
              <table className="compact-table">
                <thead><tr><th>ID</th><th>Contact size</th><th></th></tr></thead>
                <tbody>
                  {cd.cavities.map((cav, i) => (
                    <tr key={i}>
                      <td><input value={cav.cavity_id} onChange={(e) => updateCavity(i, { cavity_id: e.currentTarget.value })} /></td>
                      <td><input value={cav.contact_size} onChange={(e) => updateCavity(i, { contact_size: e.currentTarget.value })} /></td>
                      <td>
                        <button className="icon-button" onClick={() => onChange(cd.cavities.filter((_, j) => j !== i))} title="Delete" aria-label="Delete cavity">
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => onChange([...cd.cavities, { cavity_id: "", contact_size: size }])}>+ cavity</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

const TERMINATION_OPTIONS: [ConnectorDef["suggested_termination"], string][] = [
  [null, "—"],
  ["boot", "Boot"],
  ["adhesive_heatshrink", "Adhesive heat-shrink"],
  ["none", "None"],
];

function blankConnectorDef(partId: number): ConnectorDef {
  return {
    part_id: partId,
    gender: "female",
    series: null,
    shell_size: null,
    counterpart_id: null,
    back_shape: null,
    back_diameter_mm: null,
    back_width_mm: null,
    back_height_mm: null,
    suggested_termination: null,
    contact_part_id: null,
    seal_plug_part_id: null,
    adhesive_heatshrink_length_mm: null,
    cavities: [],
  };
}

/** Datos que faltan y que algún cálculo o chequeo necesita (punto naranja en la lista). */
function missingData(cd: ConnectorDef, part: Part): string[] {
  const out: string[] = [];
  if (part.price_usd == null) out.push("no price");
  if (cd.cavities.length === 0) out.push("no cavities");
  if (cd.contact_part_id == null) out.push("no contact");
  const backKnown =
    cd.back_shape === "round"
      ? cd.back_diameter_mm != null
      : cd.back_shape === "rectangular" && cd.back_width_mm != null && cd.back_height_mm != null;
  if (cd.suggested_termination === "adhesive_heatshrink" && !backKnown) out.push("no back size");
  if (cd.suggested_termination === "adhesive_heatshrink" && cd.adhesive_heatshrink_length_mm == null) out.push("no adhesive HS length");
  return out;
}

/**
 * Contraparte en los dos sentidos: si A enchufa con B, B enchufa con A. Lo que
 * apuntaba a A o a B antes queda sin contraparte.
 */
function setCounterpart(library: Library, partId: number, counterpartId: number | null): Library {
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

/**
 * Conectores: lista compacta (buscador, filtro por serie y por datos faltantes)
 * a la izquierda y la ficha del elegido a la derecha, en bloques: parte,
 * terminación, vías con la cara dibujada, imágenes y dónde se usa.
 */
function ConnectorDefsTab({ library, setLibrary, partById, project }: TabProps & { project: ProjectData | null }) {
  const [search, setSearch] = useState("");
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const rows = library.connector_defs.flatMap((cd) => {
    const part = partById(cd.part_id);
    return part ? [{ cd, part, missing: missingData(cd, part) }] : [];
  });
  const seriesCounts = new Map<string, number>();
  for (const { cd } of rows) if (cd.series) seriesCounts.set(cd.series, (seriesCounts.get(cd.series) ?? 0) + 1);
  const visible = rows.filter(({ cd, part, missing }) => {
    if (seriesFilter && cd.series !== seriesFilter) return false;
    if (onlyMissing && missing.length === 0) return false;
    return matchesSearch(search, [part.part_number, part.manufacturer, cd.series, cd.shell_size]);
  });
  const selected = rows.find((r) => r.cd.part_id === selectedId) ?? visible[0] ?? null;

  function addConnector() {
    const next = addPart(library, "connector", "connector_defs", blankConnectorDef);
    setLibrary(next);
    setSelectedId(next.parts[next.parts.length - 1].id);
    setSeriesFilter(null);
    setOnlyMissing(false);
    setSearch("");
  }
  function deleteConnector(partId: number) {
    // Una carcasa que usa un dispositivo no se borra: el dispositivo quedaría sin conector.
    const usedBy = library.device_defs.filter((d) => d.connectors.some((c) => c.connector_def_id === partId));
    if (usedBy.length > 0) {
      alert(`This housing is used by ${usedBy.map((d) => partById(d.part_id)?.part_number || "a device").join(", ")} (Devices tab). Change or delete that device connector first.`);
      return;
    }
    const index = visible.findIndex((r) => r.cd.part_id === partId);
    setSelectedId((visible[index + 1] ?? visible[index - 1])?.cd.part_id ?? null);
    setLibrary(removePart(setCounterpart(library, partId, null), "connector_defs", partId));
  }

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} className={active ? "filter-chip active" : "filter-chip"} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <section className="lib-master-detail">
      <aside className="lib-list">
        <div className="lib-list-filters">
          <input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search part number, series…" aria-label="Search connectors" />
          <div className="filter-chips">
            {chip(`All ${rows.length}`, !seriesFilter && !onlyMissing, () => {
              setSeriesFilter(null);
              setOnlyMissing(false);
            })}
            {[...seriesCounts.keys()].map((series) => chip(series, seriesFilter === series, () => setSeriesFilter(seriesFilter === series ? null : series)))}
            {chip("Missing data", onlyMissing, () => setOnlyMissing(!onlyMissing))}
          </div>
        </div>
        <div className="lib-list-rows">
          {visible.map(({ cd, part, missing }) => (
            <button
              key={cd.part_id}
              className={cd.part_id === selected?.cd.part_id ? "lib-list-row selected" : "lib-list-row"}
              onClick={() => setSelectedId(cd.part_id)}
            >
              <span className="lib-list-pn">{part.part_number || "(no part number)"}</span>
              <span className="lib-gender">{cd.gender === "male" ? "M" : "F"}</span>
              <span className="lib-list-meta">
                {cd.series ?? "—"} · {cd.cavities.length}-way
                {cd.cavities.length > 0 && ` · size ${contactSizeSummary(cd.cavities).replace(/^contact sizes? /, "")}`}
              </span>
              {missing.length > 0 && <span className="lib-missing-dot" title={`Missing: ${missing.join(", ")}`} aria-label={`Missing: ${missing.join(", ")}`} />}
            </button>
          ))}
          {visible.length === 0 && <p className="hint lib-list-empty">No connectors match.</p>}
        </div>
        <div className="lib-list-footer">
          <button className="button-ghost-accent" onClick={addConnector}>+ New connector</button>
        </div>
      </aside>

      {selected ? (
        <ConnectorDetail
          key={selected.cd.part_id}
          library={library}
          project={project}
          cd={selected.cd}
          part={selected.part}
          missing={selected.missing}
          onPart={(patch) => setLibrary(updatePart(library, selected.part.id, patch))}
          onCd={(patch) => setLibrary(updateSubtype<"connector_defs", ConnectorDef>(library, "connector_defs", selected.cd.part_id, patch))}
          onCounterpart={(id) => setLibrary(setCounterpart(library, selected.cd.part_id, id))}
          onSelect={setSelectedId}
          onDelete={() => deleteConnector(selected.cd.part_id)}
        />
      ) : (
        <div className="lib-detail">
          <p className="hint">No connectors yet: “+ New connector” or “Add standard parts”.</p>
        </div>
      )}
    </section>
  );
}

function ConnectorDetail({ library, project, cd, part, missing, onPart, onCd, onCounterpart, onSelect, onDelete }: {
  library: Library;
  project: ProjectData | null;
  cd: ConnectorDef;
  part: Part;
  missing: string[];
  onPart: (patch: Partial<Part>) => void;
  onCd: (patch: Partial<ConnectorDef>) => void;
  onCounterpart: (id: number | null) => void;
  onSelect: (id: number) => void;
  onDelete: () => void;
}) {
  const usedIn = project?.connector_instances.filter((c) => c.library_part_id === cd.part_id) ?? [];
  const others = library.connector_defs.filter((d) => d.part_id !== cd.part_id);
  return (
    <div className="lib-detail">
      <div className="lib-detail-header">
        <input
          className="lib-detail-pn"
          value={part.part_number}
          onChange={(e) => onPart({ part_number: e.currentTarget.value })}
          placeholder="part number"
          aria-label="Part number"
        />
        <span className="lib-detail-sub">
          {cd.series ?? "no series"} · {cd.cavities.length}-way · {cd.gender}
          {cd.counterpart_id != null && (
            <>
              {" · mates with "}
              <button className="link-button" onClick={() => onSelect(cd.counterpart_id!)}>{partLabel(library, cd.counterpart_id)}</button>
            </>
          )}
        </span>
        <span className="lib-detail-spacer" />
        <button className="lib-delete" onClick={onDelete}>Delete</button>
      </div>
      {missing.length > 0 && <p className="lib-detail-missing">Missing: {missing.join(" · ")}</p>}

      <div className="lib-detail-cards">
        <section className="lib-card">
          <h3>Part</h3>
          <div className="lib-fields">
            <label>
              <span className="field-label">Manufacturer</span>
              <input value={part.manufacturer ?? ""} onChange={(e) => onPart({ manufacturer: e.currentTarget.value || null })} placeholder="—" />
            </label>
            <label>
              <span className="field-label">USD</span>
              <input type="number" value={part.price_usd ?? ""} onChange={(e) => onPart({ price_usd: numberOrNull(e.currentTarget.value) })} placeholder="—" />
            </label>
            <label>
              <span className="field-label">Gender</span>
              <select value={cd.gender} onChange={(e) => onCd({ gender: e.currentTarget.value as ConnectorDef["gender"] })}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <label>
              <span className="field-label">Series</span>
              <input value={cd.series ?? ""} onChange={(e) => onCd({ series: e.currentTarget.value || null })} placeholder="e.g. DT, DTM" />
            </label>
            <label>
              <span className="field-label">Shell size</span>
              <input value={cd.shell_size ?? ""} onChange={(e) => onCd({ shell_size: e.currentTarget.value || null })} placeholder="e.g. 12, 20" />
            </label>
            <label>
              <span className="field-label">Mates with</span>
              <select value={cd.counterpart_id ?? ""} onChange={(e) => onCounterpart(e.currentTarget.value ? Number(e.currentTarget.value) : null)}>
                <option value="">—</option>
                {others.map((d) => (
                  <option key={d.part_id} value={d.part_id}>{partLabel(library, d.part_id)}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label" title="Crimped on every wired cavity">Contact</span>
              <select value={cd.contact_part_id ?? ""} onChange={(e) => onCd({ contact_part_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
                <option value="">—</option>
                {library.contact_defs.map((c) => (
                  <option key={c.part_id} value={c.part_id}>
                    {partLabel(library, c.part_id)} · size {c.contact_size}
                    {c.gauge_min || c.gauge_max ? ` · ${c.gauge_min ?? "?"}–${c.gauge_max ?? "?"}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label" title="Goes in every unused cavity">Seal plug</span>
              <select value={cd.seal_plug_part_id ?? ""} onChange={(e) => onCd({ seal_plug_part_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
                <option value="">—</option>
                {library.seal_plug_defs.map((p) => (
                  <option key={p.part_id} value={p.part_id}>{partLabel(library, p.part_id)} · size {p.contact_size}</option>
                ))}
              </select>
            </label>
            <label className="lib-field-wide">
              <span className="field-label">Description</span>
              <input value={part.description ?? ""} onChange={(e) => onPart({ description: e.currentTarget.value || null })} placeholder="—" />
            </label>
          </div>
          <h3>Termination</h3>
          <div className="lib-fields">
            <div className="lib-field-wide">
              <span className="field-label" title="Rear of the connector, where adhesive heat-shrink has to pass over">Back (mm)</span>
              <BackSizeFields cd={cd} onChange={onCd} />
            </div>
            <label className="lib-field-wide">
              <span className="field-label">Suggested termination</span>
              <select
                value={cd.suggested_termination ?? ""}
                onChange={(e) => onCd({ suggested_termination: (e.currentTarget.value || null) as ConnectorDef["suggested_termination"] })}
              >
                {TERMINATION_OPTIONS.map(([value, label]) => (
                  <option key={label} value={value ?? ""}>{label}</option>
                ))}
              </select>
            </label>
            <label className="lib-field-wide">
              <span className="field-label" title="Length of the adhesive heat-shrink piece cut for this connector">Adhesive heat-shrink piece (mm)</span>
              <input
                type="number"
                min={0}
                value={cd.adhesive_heatshrink_length_mm ?? ""}
                placeholder="—"
                onChange={(e) => onCd({ adhesive_heatshrink_length_mm: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}
              />
            </label>
          </div>
        </section>

        <section className="lib-card">
          <h3>Cavities</h3>
          <CavityEditor cd={cd} onChange={onCd} />
          <ConnectorFaceView def={cd} />
        </section>

        <section className="lib-card">
          <h3>Images</h3>
          <ConnectorImages partId={cd.part_id} />
          <h3>Used in</h3>
          {!project ? (
            <p className="hint">No project open.</p>
          ) : usedIn.length === 0 ? (
            <p className="hint">Not used in the open project.</p>
          ) : (
            <ul className="lib-used-in">
              {usedIn.map((c) => (
                <li key={c.id}><span className="lib-used-id">{c.short_id}</span> {c.name}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Dispositivos (PDM, ECU, volante del cliente…): lista + ficha, como
 * Connectors. Cada conector del dispositivo es una carcasa del arnés (la que se
 * compra) con todas sus vías listadas: se escribe nombre y función de cada
 * pin, o se pega la tabla que mandó el cliente. La cara dibujada muestra el
 * nombre de cada pin. Lógica en devicePins.ts.
 */
function DeviceDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const rows = library.device_defs.flatMap((dd) => {
    const part = partById(dd.part_id);
    return part ? [{ dd, part }] : [];
  });
  const visible = rows.filter(({ part }) => matchesSearch(search, [part.part_number, part.manufacturer, part.description]));
  const selected = rows.find((r) => r.dd.part_id === selectedId) ?? visible[0] ?? null;

  function addDevice() {
    const next = addPart(library, "device", "device_defs", (partId) => ({ part_id: partId, connectors: [] }));
    setLibrary(next);
    setSelectedId(next.parts[next.parts.length - 1].id);
    setSearch("");
  }
  function deleteDevice(partId: number) {
    const index = visible.findIndex((r) => r.dd.part_id === partId);
    setSelectedId((visible[index + 1] ?? visible[index - 1])?.dd.part_id ?? null);
    setLibrary(removePart(library, "device_defs", partId));
  }

  return (
    <section className="lib-master-detail">
      <aside className="lib-list">
        <div className="lib-list-filters">
          <input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search devices" aria-label="Search devices" />
        </div>
        <div className="lib-list-rows">
          {visible.map(({ dd, part }) => {
            const { named, total } = pinCount(library, dd);
            return (
              <button key={dd.part_id} className={dd.part_id === selected?.dd.part_id ? "lib-list-row selected" : "lib-list-row"} onClick={() => setSelectedId(dd.part_id)}>
                <span className="lib-list-pn">{part.part_number || "(no part number)"}</span>
                <span className="lib-list-count">{named}/{total}</span>
                <span className="lib-list-meta">
                  {dd.connectors.length === 0 ? "no connectors" : `${dd.connectors.length} connector${dd.connectors.length === 1 ? "" : "s"} · ${dd.connectors.map((c) => c.label || "?").join(", ")}`}
                </span>
              </button>
            );
          })}
          {visible.length === 0 && <p className="hint lib-list-empty">{rows.length === 0 ? "No devices yet." : "No devices match."}</p>}
        </div>
        <div className="lib-list-footer">
          <button className="button-ghost-accent" onClick={addDevice}>+ New device</button>
        </div>
      </aside>

      {selected ? (
        <DeviceDetail
          key={selected.dd.part_id}
          library={library}
          dd={selected.dd}
          part={selected.part}
          onPart={(patch) => setLibrary(updatePart(library, selected.part.id, patch))}
          onDd={(patch) => setLibrary(updateSubtype<"device_defs", DeviceDef>(library, "device_defs", selected.dd.part_id, patch))}
          onDelete={() => deleteDevice(selected.dd.part_id)}
        />
      ) : (
        <div className="lib-detail">
          <p className="hint">No devices yet: “+ New device”, then add its connectors and their pin names.</p>
        </div>
      )}
    </section>
  );
}

/** Pines con nombre / vías de las carcasas, para la lista. */
function pinCount(library: Library, dd: DeviceDef): { named: number; total: number } {
  let named = 0;
  let total = 0;
  for (const c of dd.connectors) {
    const housing = library.connector_defs.find((d) => d.part_id === c.connector_def_id);
    const rows = devicePinRows(c, housing);
    total += rows.length;
    named += rows.filter((r) => r.name).length;
  }
  return { named, total };
}

function housingLabel(library: Library, cd: ConnectorDef): string {
  return `${partLabel(library, cd.part_id)} · ${cd.cavities.length}-way ${cd.gender}`;
}

function DeviceDetail({ library, dd, part, onPart, onDd, onDelete }: {
  library: Library;
  dd: DeviceDef;
  part: Part;
  onPart: (patch: Partial<Part>) => void;
  onDd: (patch: Partial<DeviceDef>) => void;
  onDelete: () => void;
}) {
  const [connectorId, setConnectorId] = useState<number | null>(dd.connectors[0]?.id ?? null);
  const [pickedCavity, setPickedCavity] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const connector = dd.connectors.find((c) => c.id === connectorId) ?? dd.connectors[0] ?? null;
  const housing = connector ? library.connector_defs.find((d) => d.part_id === connector.connector_def_id) : undefined;
  const { named, total } = pinCount(library, dd);

  function setConnector(next: DeviceDefConnector) {
    onDd({ connectors: dd.connectors.map((c) => (c.id === next.id ? next : c)) });
  }
  function addConnector() {
    const housingDef = library.connector_defs[0];
    if (!housingDef) {
      alert("Add at least one connector in Library → Connectors first: each device connector is one of those housings.");
      return;
    }
    const used = new Set(dd.connectors.map((c) => c.label));
    const label = [..."ABCDEFGHJKLMNPRSTUVWXYZ"].find((l) => !used.has(l)) ?? "";
    const id = nextDeviceId(library, "connectors");
    onDd({ connectors: [...dd.connectors, { id, label, connector_def_id: housingDef.part_id, pins: [] }] });
    setConnectorId(id);
    setPasting(false);
  }
  function removeConnector(id: number) {
    const rest = dd.connectors.filter((c) => c.id !== id);
    onDd({ connectors: rest });
    setConnectorId(rest[0]?.id ?? null);
    setPasting(false);
  }
  function pick(cavityId: string) {
    setPickedCavity(cavityId);
    document.getElementById(`dev-pin-${cavityId}`)?.focus();
  }

  const rows = connector ? devicePinRows(connector, housing) : [];
  const names = Object.fromEntries(rows.filter((r) => r.name).map((r) => [r.cavityId, r.name]));
  // Carcasas de serie desconocida (ej. la del PDM) no se dibujan: la tabla ocupa todo el ancho.
  const drawable = !!housing && connectorFace(housing, milStd1560.arrangements as MilArrangements) !== null;

  return (
    <div className="lib-detail dev-detail">
      <div className="lib-detail-header">
        <input className="lib-detail-pn" value={part.part_number} onChange={(e) => onPart({ part_number: e.currentTarget.value })} placeholder="part number" aria-label="Part number" />
        <span className="lib-detail-sub">{dd.connectors.length} connector{dd.connectors.length === 1 ? "" : "s"} · {named}/{total} pins named</span>
        <span className="lib-detail-spacer" />
        <button className="lib-delete" onClick={onDelete}>Delete</button>
      </div>

      <section className="lib-card">
        <div className="lib-fields dev-part-fields">
          <label>
            <span className="field-label">Manufacturer</span>
            <input value={part.manufacturer ?? ""} onChange={(e) => onPart({ manufacturer: e.currentTarget.value || null })} placeholder="—" />
          </label>
          <label>
            <span className="field-label">USD</span>
            <input type="number" value={part.price_usd ?? ""} onChange={(e) => onPart({ price_usd: numberOrNull(e.currentTarget.value) })} placeholder="—" />
          </label>
          <label className="lib-field-wide">
            <span className="field-label">Description</span>
            <input value={part.description ?? ""} onChange={(e) => onPart({ description: e.currentTarget.value || null })} placeholder="e.g. Power distribution module" />
          </label>
        </div>
      </section>

      <div className="dev-connector-chips" role="tablist" aria-label="Device connectors">
        {dd.connectors.map((c) => {
          const h = library.connector_defs.find((d) => d.part_id === c.connector_def_id);
          const r = devicePinRows(c, h);
          return (
            <button key={c.id} role="tab" aria-selected={c.id === connector?.id} className={c.id === connector?.id ? "filter-chip active" : "filter-chip"} onClick={() => { setConnectorId(c.id); setPasting(false); }}>
              {c.label || "?"} · {r.filter((x) => x.name).length}/{r.length}
            </button>
          );
        })}
        <button className="link-button" onClick={addConnector}>+ connector</button>
      </div>

      {connector && (
        <>
          <section className="lib-card dev-connector-head">
            <label className="dev-label">
              <span className="field-label">Label</span>
              <input value={connector.label} onChange={(e) => setConnector({ ...connector, label: e.currentTarget.value })} placeholder="A" />
            </label>
            <label className="dev-housing">
              <span className="field-label">Harness-side housing (what you buy)</span>
              <select value={connector.connector_def_id} onChange={(e) => setConnector({ ...connector, connector_def_id: Number(e.currentTarget.value) })}>
                {library.connector_defs.map((cd) => <option key={cd.part_id} value={cd.part_id}>{housingLabel(library, cd)}</option>)}
              </select>
            </label>
            <button onClick={() => setPasting(!pasting)} aria-pressed={pasting}>Paste pinout…</button>
            <button className="lib-delete" onClick={() => removeConnector(connector.id)}>Delete connector</button>
          </section>

          {pasting && (
            <PastePinout
              cavityIds={housing?.cavities.map((c) => c.cavity_id) ?? []}
              label={connector.label}
              housingName={housing ? partLabel(library, housing.part_id) : "the housing"}
              onCancel={() => setPasting(false)}
              onApply={(pasted, replace) => {
                setConnector(applyPaste(connector, pasted, replace, nextDeviceId(library, "pins")));
                setPasting(false);
              }}
            />
          )}

          <div className="dev-body">
            <section className="lib-card dev-pins">
              <table className="dev-pin-table">
                <thead><tr><th className="dev-col-cav">Cavity</th><th className="dev-col-name">Pin name</th><th>Function</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.cavityId} className={r.cavityId === pickedCavity ? "selected-row" : undefined}>
                      <td className="dev-col-cav">
                        {r.cavityId}
                        {!r.inHousing && <span className="dev-warn" title="This housing has no such cavity: clear it or pick the right housing"> not in housing</span>}
                      </td>
                      <td>
                        <span className="dev-name-cell">
                          <input
                            id={`dev-pin-${r.cavityId}`}
                            className="cn-cell cn-mono"
                            value={r.name}
                            placeholder="—"
                            aria-label={`Pin name of ${r.cavityId}`}
                            onFocus={() => setPickedCavity(r.cavityId)}
                            onChange={(e) => setConnector(setDevicePin(connector, r.cavityId, { name: e.currentTarget.value }, nextDeviceId(library, "pins")))}
                          />
                          {r.alsoOn.length > 0 && <span className="dev-also" title="Same name on another pin: one output split over several pins">also {r.alsoOn.join(", ")}</span>}
                        </span>
                      </td>
                      <td>
                        <input
                          className="cn-cell"
                          value={r.fn}
                          placeholder="—"
                          aria-label={`Function of ${r.cavityId}`}
                          onFocus={() => setPickedCavity(r.cavityId)}
                          onChange={(e) => setConnector(setDevicePin(connector, r.cavityId, { fn: e.currentTarget.value }, nextDeviceId(library, "pins")))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <p className="hint">The housing has no cavities yet: add them in Library → Connectors.</p>}
              <p className="hint dev-footnote">A name used on two pins (OUT1 on A1 and A10) is one output split over two pins: wire each one.</p>
            </section>
            {drawable && (
              <section className="lib-card dev-face">
                <ConnectorFaceView def={housing} names={names} selected={pickedCavity} onPick={pick} />
              </section>
            )}
          </div>
        </>
      )}
      {!connector && <p className="hint">Add the device's connectors (A, B…) with “+ connector”.</p>}
    </div>
  );
}

const ROLE_LABELS: Record<ColumnRole, string> = { cavity: "Cavity", name: "Pin name", function: "Function", ignore: "Ignore" };

/** Pegar la tabla del cliente (Excel o PDF): elegir qué columna es cada cosa, ver qué coincide con la carcasa y aplicar. */
function PastePinout({ cavityIds, label, housingName, onCancel, onApply }: {
  cavityIds: string[];
  label: string;
  housingName: string;
  onCancel: () => void;
  onApply: (rows: PasteRow[], replace: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [replace, setReplace] = useState(true);
  const cells = parsePinout(text);
  const columns = Math.max(0, ...cells.map((r) => r.length));
  const effectiveRoles = Array.from({ length: columns }, (_, i) => roles[i] ?? guessRoles(columns)[i]);
  const preview = previewPaste(cells, effectiveRoles, cavityIds, label);
  const matched = preview.filter((r) => r.match).length;
  const unmatched = preview.filter((r) => !r.match).map((r) => r.cavity || "(empty)");

  return (
    <section className="lib-card dev-paste">
      <label className="dev-paste-text">
        <span className="field-label">Paste the client's pinout (select the rows in their Excel or PDF, copy, paste here)</span>
        <textarea value={text} onChange={(e) => setText(e.currentTarget.value)} rows={8} placeholder={"A1\tOUT1\t20 A output\nA2\tOUT2\t20 A output"} autoFocus />
      </label>
      {cells.length > 0 && (
        <>
          <div className="dev-paste-preview">
            <table>
              <thead>
                <tr>
                  {effectiveRoles.map((role, i) => (
                    <th key={i}>
                      <select
                        value={role}
                        aria-label={`Column ${i + 1} is`}
                        onChange={(e) => setRoles(effectiveRoles.map((r, j) => (j === i ? (e.currentTarget.value as ColumnRole) : r)))}
                      >
                        {(Object.keys(ROLE_LABELS) as ColumnRole[]).map((k) => <option key={k} value={k}>{ROLE_LABELS[k]}</option>)}
                      </select>
                    </th>
                  ))}
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {cells.slice(0, 200).map((row, i) => (
                  <tr key={i} className={preview[i].match ? undefined : "dev-paste-skip"}>
                    {effectiveRoles.map((role, j) => <td key={j} className={role === "ignore" ? "dev-paste-ignored" : undefined}>{row[j] ?? ""}</td>)}
                    <td>{preview[i].match ? <span className="dev-ok">→ {preview[i].match}</span> : <span className="dev-warn">not in housing</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dev-paste-actions">
            <span>
              <strong>{cells.length} rows</strong> · {matched} match a cavity of {housingName}
              {unmatched.length > 0 && <span className="dev-warn"> · {unmatched.length} skipped ({unmatched.slice(0, 5).join(", ")}{unmatched.length > 5 ? "…" : ""})</span>}
            </span>
            <span className="lib-detail-spacer" />
            <label className="dev-replace"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.currentTarget.checked)} /> Replace names already typed</label>
            <button onClick={onCancel}>Cancel</button>
            <button className="button-primary" disabled={matched === 0} onClick={() => onApply(preview, replace)}>Apply {matched} pins</button>
          </div>
        </>
      )}
      {cells.length === 0 && (
        <div className="dev-paste-actions">
          <span className="hint">Columns are split by tabs (Excel) or by two or more spaces (PDF). You choose which column is which after pasting.</span>
          <span className="lib-detail-spacer" />
          <button onClick={onCancel}>Cancel</button>
        </div>
      )}
    </section>
  );
}
