import { useState } from "react";
import type { AccessoryDef, AccessoryDefConnectorMatch, ComponentDef, ContactDef, CoveringDef, SealPlugDef, SpliceDef, TMoldDef, TMoldLeg, WireDef } from "../../model/library";
import { TrashIcon } from "../../components/icons";
import { addPart, removePart, updatePart, updateSubtype } from "../../logic/libraryEdit";
import { FilterBar, matchesSearch, PartFields, type TabProps } from "./shared";

/**
 * Pestañas de la biblioteca que son una tabla editable por tipo de parte:
 * contactos, tapones, cables, splices, componentes, coberturas, accesorios y
 * moldes en T.
 */

export function ContactDefsTab({ library, setLibrary, partById }: TabProps) {
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

export function SealPlugDefsTab({ library, setLibrary, partById }: TabProps) {
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

export function WireDefsTab({ library, setLibrary, partById }: TabProps) {
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

export function SpliceDefsTab({ library, setLibrary, partById }: TabProps) {
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

export function ComponentDefsTab({ library, setLibrary, partById }: TabProps) {
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

export function CoveringDefsTab({ library, setLibrary, partById }: TabProps) {
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

export function AccessoryDefsTab({ library, setLibrary, partById }: TabProps) {
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

export function TMoldDefsTab({ library, setLibrary, partById }: TabProps) {
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
