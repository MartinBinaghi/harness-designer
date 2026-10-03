import { useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AccessoryDef,
  AccessoryDefConnectorMatch,
  ComponentDef,
  ConnectorDef,
  ContactDef,
  CoveringDef,
  DeviceDef,
  DeviceDefConnector,
  DeviceDefPin,
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
import { FolderIcon, PencilIcon, SaveIcon, TrashIcon } from "./icons";
import milStd1560 from "./data/mil-std-1560.json";

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

function nextId(ids: number[]): number {
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

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
}

export default function LibraryScreen({ library, setLibrary, loadLibrary, cancelLibraryEdits, flushLibraryEdits, filePath, setFilePath }: ScreenProps) {
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<Tab>("Connectors");

  async function openLibrary() {
    cancelLibraryEdits();
    try {
      const data = await invoke<Library>("open_library", { path: filePath });
      loadLibrary(data);
      setStatus(`Opened: ${filePath}`);
    } catch (err) {
      setStatus(`Error opening file: ${err}`);
    }
  }

  async function saveLibrary() {
    try {
      await flushLibraryEdits();
      await invoke("save_library", { path: filePath });
      setStatus(`Saved: ${filePath}`);
    } catch (err) {
      setStatus(`Error saving file: ${err}`);
    }
  }

  async function loadDemo() {
    cancelLibraryEdits();
    const data = await invoke<Library>("demo_library");
    loadLibrary(data);
    setStatus("Sample library loaded (not saved to disk yet).");
  }

  // Suma las partes estandarizadas que falten (DT/DTM/DTP, Superseal, M22759/32) como
  // una edición más: se puede deshacer, y no toca lo que ya estaba cargado.
  async function addBaseParts() {
    const merged = await invoke<Library>("merge_base_library", { library });
    const added = merged.parts.length - library.parts.length;
    setLibrary(merged);
    setStatus(added > 0 ? `Added ${added} standard parts (connectors unverified — check each datasheet).` : "Standard parts already in the library.");
  }

  function partById(partId: number): Part | undefined {
    return library.parts.find((p) => p.id === partId);
  }

  return (
    <>
      <section className="toolbar">
        <input value={filePath} onChange={(e) => setFilePath(e.currentTarget.value)} placeholder="file path" />
        <button className="icon-button" onClick={openLibrary} title="Open" aria-label="Open library file">
          <FolderIcon />
        </button>
        <button className="icon-button" onClick={saveLibrary} title="Save" aria-label="Save library file">
          <SaveIcon />
        </button>
        <button onClick={loadDemo}>Load sample</button>
        <button onClick={() => void addBaseParts()} title="Deutsch DT/DTM/DTP and TE Superseal 1.5 housings, M22759/32 wire 26–12 AWG. No prices.">
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
        <ConnectorDefsTab library={library} setLibrary={setLibrary} partById={partById} />
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

/** Arreglos de inserto MIL-DTL-38999 (MIL-STD-1560): "13-35" -> [[id, tamaño], ...]. */
const MIL_INSERTS: Record<string, string[][]> = milStd1560.arrangements;

function insertLabel(code: string): string {
  const counts = new Map<string, number>();
  for (const [, size] of MIL_INSERTS[code]) counts.set(size, (counts.get(size) ?? 0) + 1);
  return `${code} · ${[...counts].map(([size, n]) => `${n} × ${size}`).join(", ")}`;
}

/**
 * Vías del conector: un generador (cantidad + numeración + tamaño de contacto)
 * para el caso normal, un arreglo de inserto MIL-STD-1560 para los circulares
 * militares, y edición una por una solo para conectores mixtos.
 */
function generatorDefaults(cavities: ConnectorDef["cavities"]) {
  const first = cavities[0]?.cavity_id ?? "";
  return {
    count: cavities.length || 1,
    numbering: (/^[A-Z]$/.test(first) ? "upper" : /^[a-z]$/.test(first) ? "lower" : "numbers") as Numbering,
    size: cavities[0]?.contact_size ?? "",
  };
}

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
      <div className="field-label">Cavities</div>
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
                    cavities: MIL_INSERTS[code].map(([id, size]) => ({ cavity_id: id, contact_size: size })),
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

function ConnectorDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState("");

  function updateCd(partId: number, patch: Partial<ConnectorDef>) {
    setLibrary(updateSubtype<"connector_defs", ConnectorDef>(library, "connector_defs", partId, patch));
  }

  const visible = library.connector_defs.filter((cd) => {
    if (genderFilter && cd.gender !== genderFilter) return false;
    const part = partById(cd.part_id);
    return matchesSearch(search, [part?.part_number, part?.manufacturer, cd.series, cd.shell_size]);
  });

  return (
    <section>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search part number, manufacturer, series…" count={visible.length} total={library.connector_defs.length}>
        <select value={genderFilter} onChange={(e) => setGenderFilter(e.currentTarget.value)}>
          <option value="">All genders</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </FilterBar>
      {visible.map((cd) => {
        const part = partById(cd.part_id);
        if (!part) return null;
        return (
          <div key={cd.part_id} className="query-result" style={{ marginBottom: "1rem" }}>
            <table>
              <thead>
                <tr><th>Part number</th><th>Manufacturer</th><th>USD</th><th>Gender</th><th>Series</th><th>Shell size</th><th title="Rear of the connector, where adhesive heat-shrink has to pass over">Back (mm)</th><th>Suggested termination</th><th></th></tr>
              </thead>
              <tbody>
                <tr>
                  <PartFields part={part} onChange={(patch) => setLibrary(updatePart(library, part.id, patch))} />
                  <td>
                    <select value={cd.gender} onChange={(e) => updateCd(cd.part_id, { gender: e.currentTarget.value as ConnectorDef["gender"] })}>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </td>
                  <td><input value={cd.series ?? ""} onChange={(e) => updateCd(cd.part_id, { series: e.currentTarget.value || null })} placeholder="e.g. DT, DTM, DTP, Metri-Pack" /></td>
                  <td><input value={cd.shell_size ?? ""} onChange={(e) => updateCd(cd.part_id, { shell_size: e.currentTarget.value || null })} placeholder="e.g. 12, 20" /></td>
                  <td>
                    <BackSizeFields cd={cd} onChange={(patch) => updateCd(cd.part_id, patch)} />
                  </td>
                  <td>
                    <select
                      value={cd.suggested_termination ?? ""}
                      onChange={(e) => updateCd(cd.part_id, { suggested_termination: (e.currentTarget.value || null) as ConnectorDef["suggested_termination"] })}
                    >
                      <option value="">—</option>
                      <option value="boot">Boot</option>
                      <option value="adhesive_heatshrink">Adhesive heat-shrink</option>
                      <option value="none">None</option>
                    </select>
                  </td>
                  <td>
                    <button className="icon-button" onClick={() => setLibrary(removePart(library, "connector_defs", cd.part_id))} title="Delete" aria-label="Delete connector">
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <CavityEditor cd={cd} onChange={(patch) => updateCd(cd.part_id, patch)} />
          </div>
        );
      })}
      <button
        onClick={() =>
          setLibrary(
            addPart(library, "connector", "connector_defs", (partId) => ({
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
              image_side_path: null,
              image_front_path: null,
              image_back_path: null,
              cavities: [],
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

function DeviceDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");

  function updateDd(partId: number, patch: Partial<DeviceDef>) {
    setLibrary(updateSubtype<"device_defs", DeviceDef>(library, "device_defs", partId, patch));
  }

  function addConnector(dd: DeviceDef) {
    const id = nextId(library.connector_defs.length === 0 ? [] : dd.connectors.map((c) => c.id));
    const anyConnectorDef = library.connector_defs[0];
    if (!anyConnectorDef) {
      setStatusNoConnectorDefs();
      return;
    }
    const newConnector: DeviceDefConnector = { id, label: "", connector_def_id: anyConnectorDef.part_id, pins: [] };
    updateDd(dd.part_id, { connectors: [...dd.connectors, newConnector] });
  }
  function setStatusNoConnectorDefs() {
    alert("Add at least one connector in the Connectors tab before adding connectors to the device.");
  }
  function updateConnector(dd: DeviceDef, connectorId: number, patch: Partial<DeviceDefConnector>) {
    updateDd(dd.part_id, { connectors: dd.connectors.map((c) => (c.id === connectorId ? { ...c, ...patch } : c)) });
  }
  function removeConnector(dd: DeviceDef, connectorId: number) {
    updateDd(dd.part_id, { connectors: dd.connectors.filter((c) => c.id !== connectorId) });
  }

  function addPin(dd: DeviceDef, connector: DeviceDefConnector) {
    const allPinIds = dd.connectors.flatMap((c) => c.pins.map((p) => p.id));
    const id = nextId(allPinIds);
    const newPin: DeviceDefPin = { id, cavity_id: "", name: "", function: null };
    updateConnector(dd, connector.id, { pins: [...connector.pins, newPin] });
  }
  function updatePin(dd: DeviceDef, connector: DeviceDefConnector, pinId: number, patch: Partial<DeviceDefPin>) {
    updateConnector(dd, connector.id, { pins: connector.pins.map((p) => (p.id === pinId ? { ...p, ...patch } : p)) });
  }
  function removePin(dd: DeviceDef, connector: DeviceDefConnector, pinId: number) {
    updateConnector(dd, connector.id, { pins: connector.pins.filter((p) => p.id !== pinId) });
    updateDd(dd.part_id, { pin_groups: dd.pin_groups.map((g) => ({ ...g, pin_ids: g.pin_ids.filter((id) => id !== pinId) })) });
  }

  function addPinGroup(dd: DeviceDef) {
    const id = nextId(dd.pin_groups.map((g) => g.id));
    updateDd(dd.part_id, { pin_groups: [...dd.pin_groups, { id, name: "", pin_ids: [] }] });
  }
  function updatePinGroupName(dd: DeviceDef, groupId: number, name: string) {
    updateDd(dd.part_id, { pin_groups: dd.pin_groups.map((g) => (g.id === groupId ? { ...g, name } : g)) });
  }
  function togglePinInGroup(dd: DeviceDef, groupId: number, pinId: number) {
    updateDd(dd.part_id, {
      pin_groups: dd.pin_groups.map((g) =>
        g.id === groupId
          ? { ...g, pin_ids: g.pin_ids.includes(pinId) ? g.pin_ids.filter((id) => id !== pinId) : [...g.pin_ids, pinId] }
          : g,
      ),
    });
  }
  function removePinGroup(dd: DeviceDef, groupId: number) {
    updateDd(dd.part_id, { pin_groups: dd.pin_groups.filter((g) => g.id !== groupId) });
  }

  const visible = library.device_defs.filter((dd) => {
    const part = partById(dd.part_id);
    return matchesSearch(search, [part?.part_number, part?.manufacturer]);
  });

  return (
    <section>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search part number, manufacturer…" count={visible.length} total={library.device_defs.length} />
      {visible.map((dd) => {
        const part = partById(dd.part_id);
        if (!part) return null;
        const allPins = dd.connectors.flatMap((c) => c.pins);
        return (
          <div key={dd.part_id} className="query-result" style={{ marginBottom: "1rem" }}>
            <table>
              <thead><tr><th>Part number</th><th>Manufacturer</th><th>USD</th><th></th></tr></thead>
              <tbody>
                <tr>
                  <PartFields part={part} onChange={(patch) => setLibrary(updatePart(library, part.id, patch))} />
                  <td>
                    <button className="icon-button" onClick={() => setLibrary(removePart(library, "device_defs", dd.part_id))} title="Delete" aria-label="Delete device">
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            {dd.connectors.map((connector) => (
              <div key={connector.id} style={{ marginLeft: "1rem", marginTop: "0.5rem" }}>
                <div className="toolbar">
                  <strong>Connector</strong>
                  <input
                    value={connector.label}
                    placeholder="e.g. A"
                    onChange={(e) => updateConnector(dd, connector.id, { label: e.currentTarget.value })}
                  />
                  <select
                    value={connector.connector_def_id}
                    onChange={(e) => updateConnector(dd, connector.id, { connector_def_id: Number(e.currentTarget.value) })}
                  >
                    {library.connector_defs.map((cd) => {
                      const cp = partById(cd.part_id);
                      return <option key={cd.part_id} value={cd.part_id}>{cp?.part_number || `#${cd.part_id}`}</option>;
                    })}
                  </select>
                  <button className="icon-button" onClick={() => removeConnector(dd, connector.id)} title="Delete" aria-label="Delete device connector">
                    <TrashIcon />
                  </button>
                </div>

                <table>
                  <thead><tr><th>Cavity</th><th>Name</th><th>Function</th><th></th></tr></thead>
                  <tbody>
                    {connector.pins.map((pin) => (
                      <tr key={pin.id}>
                        <td><input value={pin.cavity_id} onChange={(e) => updatePin(dd, connector, pin.id, { cavity_id: e.currentTarget.value })} /></td>
                        <td><input value={pin.name} onChange={(e) => updatePin(dd, connector, pin.id, { name: e.currentTarget.value })} /></td>
                        <td><input value={pin.function ?? ""} onChange={(e) => updatePin(dd, connector, pin.id, { function: e.currentTarget.value || null })} /></td>
                        <td>
                          <button className="icon-button" onClick={() => removePin(dd, connector, pin.id)} title="Delete" aria-label="Delete pin">
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={() => addPin(dd, connector)}>+ pin</button>
              </div>
            ))}
            <button onClick={() => addConnector(dd)}>+ device connector</button>

            <div style={{ marginTop: "0.75rem" }}>
              <strong>Parallel pins</strong>
              {dd.pin_groups.map((group) => (
                <div key={group.id} className="toolbar">
                  <input value={group.name} placeholder="e.g. OUT1" onChange={(e) => updatePinGroupName(dd, group.id, e.currentTarget.value)} />
                  {allPins.map((pin) => (
                    <label key={pin.id} style={{ fontSize: "0.9em" }}>
                      <input
                        type="checkbox"
                        checked={group.pin_ids.includes(pin.id)}
                        onChange={() => togglePinInGroup(dd, group.id, pin.id)}
                      />
                      {pin.name || `#${pin.id}`}
                    </label>
                  ))}
                  <button className="icon-button" onClick={() => removePinGroup(dd, group.id)} title="Delete" aria-label="Delete pin group">
                    <TrashIcon />
                  </button>
                </div>
              ))}
              <button onClick={() => addPinGroup(dd)}>+ pin group</button>
            </div>
          </div>
        );
      })}
      <button
        onClick={() =>
          setLibrary(addPart(library, "device", "device_defs", (partId) => ({ part_id: partId, connectors: [], pin_groups: [] })))
        }
        className="button-ghost-accent"
      >
        + New
      </button>
    </section>
  );
}
