import { useState } from "react";
import { partLabel, type ConnectorDef, type Library, type Part } from "../../model/library";
import type { ProjectData } from "../../model/project";
import { ConnectorFaceView } from "../../components/ConnectorFaceView";
import { addPart, removePart, setCounterpart, updatePart, updateSubtype } from "../../logic/libraryEdit";
import { CavityEditor, contactSizeSummary } from "./CavityEditor";
import { ConnectorImages } from "./ConnectorImages";
import { matchesSearch, numberOrNull, type TabProps } from "./shared";

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
 * Conectores: lista compacta (buscador, filtro por serie y por datos faltantes)
 * a la izquierda y la ficha del elegido a la derecha, en bloques: parte,
 * terminación, vías con la cara dibujada, imágenes y dónde se usa.
 */
export function ConnectorDefsTab({ library, setLibrary, partById, project }: TabProps & { project: ProjectData | null }) {
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
