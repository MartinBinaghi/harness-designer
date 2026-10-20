import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettled } from "./useBackedState";
import type { CavityAssignment, ConnectorInstance, ProjectData, Selection, WireInstance } from "./types";
import type { CostReport } from "./costTypes";
import { devicePinName, partLabel, type Library } from "./libraryTypes";
import { TrashIcon } from "./icons";
import {
  BLANK_END,
  addWireAtCavity,
  cavitiesFromDef,
  changeConnectorPart,
  deleteWire,
  endChoices,
  endLabel,
  nextId,
  otherEnd,
  parseEnd,
  patchItem,
  setOtherEnd,
  wireCategoryPatch,
  wiresAtCavity,
} from "./projectEdit";
import { ConnectorPartSelect } from "./Inspector";
import { terminatesAt, wireNets } from "./sheets";

/**
 * Conectores con su pinout: la lista a la izquierda y, del elegido, sus datos y
 * una fila por vía para cargar a qué va cada pin (función, destino, cable,
 * color). Un pin puede tener varios cables (sub-filas). El largo sale del
 * recorrido; el detalle del cable (recorrido, largo a mano, trenzado) está en
 * el Inspector al tocar la fila.
 */

interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData) => void;
  library: Library;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export default function Conectores({ project, setProject, library, selection, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<CostReport | null>(null);

  // Un conector elegido en el árbol, el diagrama o Checks se abre acá.
  useEffect(() => {
    if (selection?.kind === "connector") setCurrentId(selection.id);
  }, [selection]);

  // Largos de corte: los calcula el backend, como en Costs y Print.
  const calc = useSettled(project);
  useEffect(() => {
    if (!calc) return;
    let cancelled = false;
    void invoke<CostReport>("compute_costs", { project: calc, library }).then((r) => {
      if (!cancelled) setReport(r);
    });
    return () => {
      cancelled = true;
    };
  }, [calc, library]);

  if (!project) return <p>Open or load a project first (Topology tab).</p>;

  const connector = project.connector_instances.find((c) => c.id === currentId) ?? project.connector_instances[0] ?? null;
  const visible = project.connector_instances.filter((c) =>
    [c.short_id, c.name, partLabel(library, c.library_part_id)].join(" ").toLowerCase().includes(search.toLowerCase()),
  );

  function apply(result: ProjectData | string) {
    if (typeof result === "string") setNotice(result);
    else {
      setNotice(null);
      setProject(result);
    }
  }

  function pick(c: ConnectorInstance) {
    setCurrentId(c.id);
    onSelect({ kind: "connector", id: c.id });
  }

  function add() {
    if (!project) return;
    const def = library.connector_defs[0];
    if (!def) {
      setNotice("Add at least one connector in Library → Connectors first.");
      return;
    }
    const id = nextId(project.connector_instances.map((c) => c.id));
    // Un extremo de conector libre de la topología o, si no hay, uno nuevo
    // suelto (se conecta después en Topology o en el diagrama).
    const free = project.nodes.find((n) => n.kind === "connector_end" && !project.connector_instances.some((c) => c.node_id === n.id));
    const nodeId = free?.id ?? nextId(project.nodes.map((n) => n.id));
    const nodes = free
      ? project.nodes
      : [...project.nodes, { id: nodeId, kind: "connector_end" as const, termination: null, termination_library_part_id: null, diagram_x: null, diagram_y: null, adhesive_heatshrink_length_mm: null }];
    const created: ConnectorInstance = {
      id,
      short_id: `X${id}`,
      name: "",
      library_part_id: def.part_id,
      device_connector_id: null,
      node_id: nodeId,
      termination: null,
      termination_library_part_id: null,
      backshell_library_part_id: null,
      status: "pending",
      is_interconnect: false,
      mates_with: null,
      cavities: cavitiesFromDef(project, def.part_id, library),
    };
    setProject({ ...project, nodes, connector_instances: [...project.connector_instances, created] });
    setCurrentId(id);
  }

  // Borrar un conector deja sus cables con ese extremo sin destino (siguen en Wires, incompletos).
  function remove(c: ConnectorInstance) {
    if (!project) return;
    const gone = new Set(c.cavities.map((cav) => cav.id));
    const loose = (end: WireInstance["end_a"]) => (end.kind === "cavity" && end.cavity_assignment_id != null && gone.has(end.cavity_assignment_id) ? BLANK_END : end);
    setProject({
      ...project,
      connector_instances: project.connector_instances.filter((x) => x.id !== c.id),
      wire_instances: project.wire_instances.map((w) => ({ ...w, end_a: loose(w.end_a), end_b: loose(w.end_b) })),
    });
    setCurrentId(null);
  }

  const usedCount = (c: ConnectorInstance) => c.cavities.filter((cav) => wiresAtCavity(project, cav.id).length > 0).length;

  return (
    <div className="cn-layout">
      <aside className="cn-list">
        <div className="cn-list-search">
          <input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search connectors" aria-label="Search connectors" />
        </div>
        <div className="cn-list-rows">
          {visible.map((c) => {
            const used = usedCount(c);
            return (
              <button key={c.id} className={c.id === connector?.id ? "cn-list-row selected" : "cn-list-row"} onClick={() => pick(c)}>
                <span className="cn-list-name">
                  <span className="cn-id">{c.short_id}</span> {c.name || <span className="hint">(no name)</span>}
                </span>
                <span className={c.status === "pending" ? "cn-count pending" : "cn-count"} title={`${used} of ${c.cavities.length} pins used`}>
                  {c.status === "pending" ? "pending" : `${used}/${c.cavities.length}`}
                </span>
                <span className="cn-list-part">{partLabel(library, c.library_part_id)}</span>
              </button>
            );
          })}
        </div>
        <div className="cn-list-footer">
          <button className="button-ghost-accent" onClick={add}>+ New connector</button>
        </div>
      </aside>

      {connector ? (
        <ConnectorEditor
          key={connector.id}
          project={project}
          library={library}
          connector={connector}
          report={report}
          selection={selection}
          onSelect={onSelect}
          setProject={setProject}
          apply={apply}
          onDelete={() => remove(connector)}
          notice={notice}
        />
      ) : (
        <div className="cn-main">
          <p className="hint">No connectors yet. Use “+ New connector”.</p>
          {notice && <p className="diagram-notice">{notice}</p>}
        </div>
      )}
    </div>
  );
}

function ConnectorEditor({ project, library, connector: c, report, selection, onSelect, setProject, apply, onDelete, notice }: {
  project: ProjectData;
  library: Library;
  connector: ConnectorInstance;
  report: CostReport | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
  setProject: (p: ProjectData) => void;
  apply: (r: ProjectData | string) => void;
  onDelete: () => void;
  notice: string | null;
}) {
  const set = (patch: Partial<ConnectorInstance>) => setProject(patchItem(project, "connector_instances", c.id, patch));
  // A dónde termina cada pin cuando pasa por un splice ("→ X1:NN, X1:PP (via SP1)").
  const nets = wireNets(project);
  const netOf = (id: number) => nets.get(id) ?? [id];
  const setCavity = (cavityId: number, patch: Partial<CavityAssignment>) =>
    set({ cavities: c.cavities.map((cav) => (cav.id === cavityId ? { ...cav, ...patch } : cav)) });
  const setWire = (w: WireInstance, patch: Partial<WireInstance>) => setProject(patchItem(project, "wire_instances", w.id, patch));
  const def = library.connector_defs.find((d) => d.part_id === c.library_part_id);
  const showExternal = c.is_interconnect || c.cavities.some((cav) => cav.external_reference);
  const choices = endChoices(project, library);
  const datalistId = `goes-to-${c.id}`;

  function newWire(cavityId: number, patch: Partial<WireInstance> = {}) {
    const result = addWireAtCavity(project, library, cavityId);
    if (typeof result === "string") return apply(result);
    apply(patchItem(result.project, "wire_instances", result.wireId, patch));
    onSelect({ kind: "wire", id: result.wireId });
  }

  return (
    <div className="cn-main">
      <section className="cn-header">
        <label className="cn-field cn-field-id">
          <span className="field-label">ID</span>
          <input value={c.short_id} onChange={(e) => set({ short_id: e.currentTarget.value })} />
        </label>
        <label className="cn-field cn-field-grow">
          <span className="field-label">Name (label)</span>
          <input value={c.name} onChange={(e) => set({ name: e.currentTarget.value })} placeholder="e.g. Fuel pump" />
        </label>
        <label className="cn-field cn-field-grow">
          <span className="field-label">Part</span>
          <ConnectorPartSelect
            library={library}
            partId={c.library_part_id}
            deviceConnectorId={c.device_connector_id}
            onChange={(choice) => setProject(changeConnectorPart(project, library, c.id, choice.partId, choice.deviceConnectorId))}
          />
        </label>
        <label className="cn-field">
          <span className="field-label">Node</span>
          <select value={c.node_id} onChange={(e) => set({ node_id: Number(e.currentTarget.value) })}>
            {project.nodes.map((n) => <option key={n.id} value={n.id}>node {n.id}</option>)}
          </select>
        </label>
        <label className="cn-field">
          <span className="field-label">Status</span>
          <select value={c.status} onChange={(e) => set({ status: e.currentTarget.value as ConnectorInstance["status"] })}>
            <option value="complete">Complete</option>
            <option value="pending">Pending</option>
          </select>
        </label>
        <label className="cn-field">
          <span className="field-label">Termination</span>
          <select value={c.termination ?? ""} onChange={(e) => set({ termination: e.currentTarget.value || null, termination_library_part_id: null })}>
            <option value="">—</option>
            <option value="boot_straight">Straight boot</option>
            <option value="boot_90">90° boot</option>
            <option value="adhesive_heatshrink">Adhesive heat-shrink</option>
            <option value="none">None</option>
          </select>
        </label>
        {(c.termination === "boot_straight" || c.termination === "boot_90") && (
          <label className="cn-field">
            <span className="field-label">Boot</span>
            <select value={c.termination_library_part_id ?? ""} onChange={(e) => set({ termination_library_part_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
              <option value="">—</option>
              {library.accessory_defs.map((ad) => <option key={ad.part_id} value={ad.part_id}>{partLabel(library, ad.part_id)}</option>)}
            </select>
          </label>
        )}
        {c.termination === "adhesive_heatshrink" && (
          <label className="cn-field">
            <span className="field-label">Covering</span>
            <select value={c.termination_library_part_id ?? ""} onChange={(e) => set({ termination_library_part_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
              <option value="">—</option>
              {library.covering_defs.map((cd) => <option key={cd.part_id} value={cd.part_id}>{partLabel(library, cd.part_id)}</option>)}
            </select>
          </label>
        )}
        <div className="cn-field">
          <span className="field-label">Interconnect</span>
          <span className="cn-interconnect">
            <input type="checkbox" checked={c.is_interconnect} onChange={(e) => set({ is_interconnect: e.currentTarget.checked })} aria-label="Interconnect" />
            {c.is_interconnect && <input value={c.mates_with ?? ""} onChange={(e) => set({ mates_with: e.currentTarget.value || null })} placeholder="mates with…" />}
          </span>
        </div>
        <button className="icon-button cn-delete" onClick={onDelete} title="Delete connector" aria-label="Delete connector">
          <TrashIcon />
        </button>
      </section>

      {notice && <p className="diagram-notice">{notice}</p>}

      <div className="cn-table-box">
        <datalist id={datalistId}>
          {choices.map((ch) => <option key={ch.label} value={ch.label} />)}
        </datalist>
        <table className="cn-pinout">
          <thead>
            <tr>
              <th className="cn-col-pin">Pin</th>
              <th>Function</th>
              <th className="cn-col-cat">Category</th>
              <th>Goes to</th>
              <th className="cn-col-wire">Wire</th>
              <th className="cn-col-color">Color</th>
              <th className="cn-col-len">Length</th>
              {showExternal && <th>External reference</th>}
              <th className="cn-col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {c.cavities.flatMap((cav) => {
              const wires = wiresAtCavity(project, cav.id);
              const pinName = devicePinName(library, c.device_connector_id, cav.cavity_id);
              const lines: (WireInstance | null)[] = wires.length > 0 ? wires : [null];
              return lines.map((w, i) => {
                const cut = w ? report?.cut_list.find((x) => x.wire_id === w.id) : undefined;
                const selected = w != null && selection?.kind === "wire" && selection.id === w.id;
                return (
                  // La clave es la vía + la posición: al escribir en un pin vacío se crea el cable y el campo no pierde el foco.
                  <tr key={`${cav.id}-${i}`} className={`${selected ? "selected-row " : ""}${i > 0 ? "cn-subrow" : ""}`} onClick={() => w && onSelect({ kind: "wire", id: w.id })}>
                    <td className="cn-col-pin">
                      {i === 0 ? cav.cavity_id : "↳"}
                      {i === 0 && pinName && <span className="cn-pin-name">{pinName}</span>}
                    </td>
                    <td>
                      <input
                        className="cn-cell"
                        value={w?.specific_name ?? ""}
                        placeholder={w ? "" : "n/c"}
                        aria-label={`Pin ${cav.cavity_id} function`}
                        onChange={(e) => {
                          const v = e.currentTarget.value || null;
                          if (w) setWire(w, { specific_name: v });
                          else if (v) newWire(cav.id, { specific_name: v });
                        }}
                      />
                    </td>
                    <td className="cn-col-cat">
                      {w && (
                        <select className="cn-cell" value={w.signal_type_id ?? ""} onChange={(e) => setWire(w, wireCategoryPatch(library, w, e.currentTarget.value ? Number(e.currentTarget.value) : null))} aria-label="Category">
                          <option value="">—</option>
                          {library.signal_types.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      <GoesToInput
                        key={w ? `${w.id}-${endLabel(project, otherEnd(w, cav.id))}` : "new"}
                        list={datalistId}
                        initial={w ? endLabel(project, otherEnd(w, cav.id)).replace(/^—$/, "") : ""}
                        onCommit={(text) => {
                          if (!text && !w) return;
                          const end = text ? parseEnd(project, library, text) : BLANK_END;
                          if (!end) return apply(`"${text}" isn't a pin, splice, ground or component of this project.`);
                          if (w) return apply(setOtherEnd(project, w.id, cav.id, end));
                          const created = addWireAtCavity(project, library, cav.id);
                          if (typeof created === "string") return apply(created);
                          apply(setOtherEnd(created.project, created.wireId, cav.id, end));
                          onSelect({ kind: "wire", id: created.wireId });
                        }}
                      />
                      {i === 0 && wires.some((x) => otherEnd(x, cav.id).kind === "splice") && (
                        <span className="cn-final" title="Where this pin ends, through the splice">→ {terminatesAt(project, library, cav.id, netOf)}</span>
                      )}
                    </td>
                    <td className="cn-col-wire">
                      {w && (
                        <select className="cn-cell" value={w.library_part_id} onChange={(e) => setWire(w, { library_part_id: Number(e.currentTarget.value) })} aria-label="Wire type">
                          {!library.wire_defs.some((d) => d.part_id === w.library_part_id) && <option value={w.library_part_id}>{partLabel(library, w.library_part_id)}</option>}
                          {library.wire_defs.map((d) => <option key={d.part_id} value={d.part_id}>{d.gauge}{d.spec ? ` · ${d.spec}` : ""}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="cn-col-color">
                      {w && <input className="cn-cell" value={w.color ?? ""} onChange={(e) => setWire(w, { color: e.currentTarget.value || null })} placeholder="—" aria-label="Color" />}
                    </td>
                    <td className="cn-col-len">
                      {w && (cut ? (
                        <>
                          {cut.cut_length_mm.toFixed(0)}
                          <span className={cut.manual ? "cn-len-tag manual" : "cn-len-tag"}>{cut.manual ? "manual" : "auto"}</span>
                        </>
                      ) : (
                        <span className="hint" title="No route yet: set where it goes, or a length by hand in the Inspector">—</span>
                      ))}
                    </td>
                    {showExternal && (
                      <td>
                        {i === 0 && (
                          <input className="cn-cell" value={cav.external_reference ?? ""} onChange={(e) => setCavity(cav.id, { external_reference: e.currentTarget.value || null })} placeholder="what's on the other side" aria-label="External reference" />
                        )}
                      </td>
                    )}
                    <td className="cn-col-actions">
                      {w && (
                        <>
                          {i === 0 && (
                            <button className="link-button" onClick={(e) => { e.stopPropagation(); newWire(cav.id); }} title="Another wire from this pin">
                              + wire
                            </button>
                          )}
                          <button className="icon-button" onClick={(e) => { e.stopPropagation(); setProject(deleteWire(project, w.id)); }} title="Delete wire" aria-label="Delete wire">
                            <TrashIcon />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <p className="hint cn-footnote">
        Contact {def?.contact_part_id != null ? partLabel(library, def.contact_part_id) : "not set"} and seal plug{" "}
        {def?.seal_plug_part_id != null ? partLabel(library, def.seal_plug_part_id) : "not set"} from the part in the Library · Length = route through the
        segments + margin; click a row to see the route or set a length by hand (Inspector).
      </p>
    </div>
  );
}

/** "Goes to": texto libre con autocompletado; se confirma con Enter o al salir. */
export function GoesToInput({ initial, list, onCommit }: { initial: string; list: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const commit = () => {
    if (text.trim() !== initial) onCommit(text.trim());
  };
  return (
    <input
      className="cn-cell cn-mono"
      list={list}
      value={text}
      placeholder="X4:2, SP1, G1, PDM30 OUT11…"
      aria-label="Goes to"
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setText(initial);
      }}
    />
  );
}
