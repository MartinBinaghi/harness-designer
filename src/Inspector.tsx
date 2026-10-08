import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CostReport, WireCutLength } from "./costTypes";
import { changeConnectorPart, patchItem, wireCategoryPatch } from "./projectEdit";
import type { ConnectorInstance, Node, ProjectData, Selection, SpliceInstance, WireInstance } from "./types";
import { choiceKey, CONNECTOR_VIEWS, connectorChoices, partLabel, type ConnectorChoice, type Library } from "./libraryTypes";
import { EndEditor } from "./Cables";
import { ConnectorFaceView } from "./ConnectorFaceView";
import { NODE_KINDS, NODE_KIND_LABELS, TERMINATIONS, TERMINATION_LABELS as NODE_TERMINATION_LABELS } from "./Topologia";

/**
 * Panel de detalle del elemento seleccionado (en cualquier pantalla). Todo lo
 * que muestra se edita acá mismo: cambia el proyecto igual que las tablas, así
 * que árbol, tablas, diagrama, esquema y chequeos se actualizan solos.
 */

const CONNECTOR_TERMINATIONS: Record<string, string> = {
  boot_straight: "Straight boot",
  boot_90: "90° boot",
  adhesive_heatshrink: "Adhesive heat-shrink",
  none: "None",
};

const numOrNull = (v: string) => (v === "" ? null : Number(v));

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inspector-field">
      <div className="field-label">{label}</div>
      <div className="inspector-field-value">{children}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="inspector-input inspector-input-wide" value={value} placeholder={placeholder} onChange={(e) => onChange(e.currentTarget.value)} />;
}

/**
 * Número: confirma con Enter o al salir del campo (un solo paso de undo), Esc
 * vuelve al valor guardado. `nullable` permite dejarlo vacío (= valor por
 * defecto); si no, un vacío o un valor fuera de rango se descarta.
 */
function NumberInput({ value, onCommit, unit, nullable, placeholder, min = 0 }: {
  value: number | null;
  onCommit: (v: number | null) => void;
  unit?: string;
  nullable?: boolean;
  placeholder?: string;
  min?: number;
}) {
  const commit = (text: string) => {
    const next = numOrNull(text);
    if (next === null ? !nullable : !(next >= min)) return;
    if (next !== value) onCommit(next);
  };
  return (
    <span className="inspector-input-row">
      <input
        key={value ?? "empty"}
        className="inspector-input"
        type="number"
        min={min}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.currentTarget.value);
          if (e.key === "Escape") e.currentTarget.value = value === null ? "" : String(value);
        }}
      />
      {unit}
    </span>
  );
}

function Select<T extends string | number>({ value, options, onChange, empty }: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T | null) => void;
  /** Texto de la opción "ninguno"; sin esto no se puede dejar vacío. */
  empty?: string;
}) {
  // Si el valor actual no está entre las opciones (p. ej. parte que no está en la biblioteca), se muestra igual.
  const missing = value !== null && !options.some((o) => o.value === value);
  return (
    <select
      className="inspector-input inspector-input-wide"
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        if (raw === "") return onChange(null);
        const match = options.find((o) => String(o.value) === raw);
        onChange(match ? match.value : (raw as T));
      }}
    >
      {(empty !== undefined || value === null) && <option value="">{empty ?? "—"}</option>}
      {missing && <option value={value}>{String(value)} (missing)</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

/**
 * Cara dibujada del conector (con las vías usadas resaltadas) y las imágenes
 * cargadas en la biblioteca para su parte (frontal primero).
 */
export function ConnectorViews({ library, partId, only, used }: { library: Library; partId: number; only?: "image_front"; used?: Set<string> }) {
  const def = library.connector_defs.find((d) => d.part_id === partId);
  const views = CONNECTOR_VIEWS.filter((v) => (!only || v.key === only) && def?.[v.key]);
  if (!def) return null;
  return (
    <div className="connector-views">
      <ConnectorFaceView def={def} used={used} />
      {views.map(({ key, label }) => (
        <figure key={key}>
          <img src={def[key]!} alt={`${label} view`} />
          <figcaption className="field-label">{label} view</figcaption>
        </figure>
      ))}
    </div>
  );
}

/**
 * Parte de un conector del proyecto: los conectores de dispositivos (PDM30 · A,
 * con los nombres de sus pines) y las carcasas de la biblioteca.
 */
export function ConnectorPartSelect({ library, partId, deviceConnectorId, onChange, placeholder, className }: {
  library: Library;
  partId: number | null;
  deviceConnectorId: number | null;
  onChange: (choice: ConnectorChoice) => void;
  placeholder?: string;
  className?: string;
}) {
  const choices = connectorChoices(library);
  const value = partId == null ? "" : choiceKey(partId, deviceConnectorId);
  const group = (devices: boolean) =>
    choices.filter((c) => (c.deviceConnectorId != null) === devices).map((c) => <option key={c.key} value={c.key}>{c.label}</option>);
  return (
    <select
      className={className}
      value={value}
      onChange={(e) => {
        const choice = choices.find((c) => c.key === e.currentTarget.value);
        if (choice) onChange(choice);
      }}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {value && !choices.some((c) => c.key === value) && <option value={value}>{partLabel(library, partId)} (missing)</option>}
      {library.device_defs.length > 0 && <optgroup label="Device connectors">{group(true)}</optgroup>}
      <optgroup label="Connectors">{group(false)}</optgroup>
    </select>
  );
}

/** Vías del conector que tienen al menos un cable. */
export function usedCavities(project: ProjectData, connector: ConnectorInstance): Set<string> {
  const ends = new Set(project.wire_instances.flatMap((w) => [w.end_a.cavity_assignment_id, w.end_b.cavity_assignment_id]));
  return new Set(connector.cavities.filter((cav) => ends.has(cav.id)).map((cav) => cav.cavity_id));
}

/**
 * Recorrido y largo de un cable: los segmentos por los que pasa, el largo con
 * trenzado, el margen y el de corte (o el puesto a mano). Lo calcula el backend.
 */
function WireLength({ project, library, wire }: { project: ProjectData; library: Library; wire: WireInstance }) {
  const [info, setInfo] = useState<{ route: number[] | null; cut: WireCutLength | undefined } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      invoke<number[] | null>("wire_route", { project, wireId: wire.id }),
      invoke<CostReport>("compute_costs", { project, library }),
    ]).then(([route, report]) => {
      if (!cancelled) setInfo({ route, cut: report.cut_list.find((c) => c.wire_id === wire.id) });
    });
    return () => {
      cancelled = true;
    };
  }, [project, library, wire.id]);
  if (!info) return <span className="hint">…</span>;
  const segments = (info.route ?? []).map((id) => project.segments.find((s) => s.id === id)).filter((s) => s !== undefined);
  return (
    <div className="inspector-length">
      {info.route === null ? (
        <span className="hint">No route: both ends need a place in the topology.</span>
      ) : (
        <span>{segments.map((s) => `S${s.id} ${s.length_mm.toFixed(0)}`).join(" → ") || "same node"} = {segments.reduce((t, s) => t + s.length_mm, 0).toFixed(0)} mm</span>
      )}
      {info.cut && (
        <span>
          {info.cut.manual
            ? `Cut ${info.cut.cut_length_mm.toFixed(0)} mm, set by hand`
            : `With twist ${info.cut.length_with_twist_mm.toFixed(0)} mm + ${info.cut.margin_pct.toFixed(0)}% → cut ${info.cut.cut_length_mm.toFixed(0)} mm`}
        </span>
      )}
    </div>
  );
}

interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData) => void;
  library: Library;
  selection: Selection;
}

export default function Inspector({ project, setProject, library, selection }: Props) {
  if (!project || !selection) {
    return (
      <div className="inspector-panel">
        <div className="tree-panel-title">Inspector</div>
        <p className="hint">Select a row in a table, or an item in the tree or a diagram, to see and edit it here.</p>
      </div>
    );
  }

  const nodeOptions = project.nodes.map((n) => ({ value: n.id, label: `node ${n.id} · ${NODE_KIND_LABELS[n.kind]}` }));
  const parts = (defs: { part_id: number }[]) => defs.map((d) => ({ value: d.part_id, label: partLabel(library, d.part_id) }));

  let title = "";
  let fields: ReactNode = null;

  if (selection.kind === "node") {
    const node = project.nodes.find((n) => n.id === selection.id);
    if (node) {
      const set = (patch: Partial<Node>) => setProject(patchItem(project, "nodes", node.id, patch));
      title = `Node ${node.id}`;
      fields = (
        <>
          <Field label="Kind">
            <Select value={node.kind} options={NODE_KINDS.map((k) => ({ value: k, label: NODE_KIND_LABELS[k] }))} onChange={(v) => v && set({ kind: v })} />
          </Field>
          <Field label="Termination">
            <Select
              value={node.termination}
              empty="—"
              options={TERMINATIONS.map((t) => ({ value: t, label: NODE_TERMINATION_LABELS[t] }))}
              onChange={(v) => set({ termination: v, termination_library_part_id: null })}
            />
          </Field>
          {node.termination === "t_mold" && (
            <Field label="T-mold">
              <Select value={node.termination_library_part_id} empty="—" options={parts(library.t_mold_defs)} onChange={(v) => set({ termination_library_part_id: v })} />
            </Field>
          )}
          {node.termination === "adhesive_heatshrink" && (
            <Field label="Covering">
              <Select value={node.termination_library_part_id} empty="—" options={parts(library.covering_defs)} onChange={(v) => set({ termination_library_part_id: v })} />
            </Field>
          )}
        </>
      );
    }
  } else if (selection.kind === "segment") {
    const seg = project.segments.find((s) => s.id === selection.id);
    if (seg) {
      const set = (patch: Partial<typeof seg>) => setProject(patchItem(project, "segments", seg.id, patch));
      title = `Segment S${seg.id}`;
      fields = (
        <>
          <Field label="From">
            <Select value={seg.node_a_id} options={nodeOptions} onChange={(v) => v !== null && set({ node_a_id: v })} />
          </Field>
          <Field label="To">
            <Select value={seg.node_b_id} options={nodeOptions} onChange={(v) => v !== null && set({ node_b_id: v })} />
          </Field>
          <Field label="Length">
            <NumberInput value={seg.length_mm} min={1} unit="mm" onCommit={(v) => v !== null && set({ length_mm: v })} />
          </Field>
          <Field label="Twist pitch">
            <NumberInput value={seg.twist_pitch_mm} nullable min={1} unit="mm" placeholder="project default" onCommit={(v) => set({ twist_pitch_mm: v })} />
          </Field>
          <Field label="Covering">
            <Select value={seg.covering_library_part_id} empty="—" options={parts(library.covering_defs)} onChange={(v) => set({ covering_library_part_id: v })} />
          </Field>
        </>
      );
    }
  } else if (selection.kind === "connector") {
    const c = project.connector_instances.find((x) => x.id === selection.id);
    if (c) {
      const set = (patch: Partial<ConnectorInstance>) => setProject(patchItem(project, "connector_instances", c.id, patch));
      const isBoot = c.termination === "boot_straight" || c.termination === "boot_90";
      title = c.short_id || "Connector";
      fields = (
        <>
          <ConnectorViews library={library} partId={c.library_part_id} used={usedCavities(project, c)} />
          <Field label="ID"><TextInput value={c.short_id} onChange={(v) => set({ short_id: v })} placeholder="X1" /></Field>
          <Field label="Name"><TextInput value={c.name} onChange={(v) => set({ name: v })} placeholder="descriptive name (label)" /></Field>
          <Field label="Part">
            <ConnectorPartSelect
              className="inspector-input inspector-input-wide"
              library={library}
              partId={c.library_part_id}
              deviceConnectorId={c.device_connector_id}
              onChange={(choice) => setProject(changeConnectorPart(project, library, c.id, choice.partId, choice.deviceConnectorId))}
            />
          </Field>
          <Field label="Node"><Select value={c.node_id} options={nodeOptions} onChange={(v) => v !== null && set({ node_id: v })} /></Field>
          <Field label="Status">
            <Select value={c.status} options={[{ value: "complete", label: "Complete" }, { value: "pending", label: "Pending" }]} onChange={(v) => v && set({ status: v as ConnectorInstance["status"] })} />
          </Field>
          <Field label="Termination">
            <Select
              value={c.termination}
              empty="—"
              options={Object.entries(CONNECTOR_TERMINATIONS).map(([value, label]) => ({ value, label }))}
              onChange={(v) => set({ termination: v, termination_library_part_id: null })}
            />
          </Field>
          {isBoot && (
            <Field label="Boot">
              <Select value={c.termination_library_part_id} empty="—" options={parts(library.accessory_defs)} onChange={(v) => set({ termination_library_part_id: v })} />
            </Field>
          )}
          {c.termination === "adhesive_heatshrink" && (
            <Field label="Covering">
              <Select value={c.termination_library_part_id} empty="—" options={parts(library.covering_defs)} onChange={(v) => set({ termination_library_part_id: v })} />
            </Field>
          )}
          <Field label="Interconnect">
            <label className="inspector-check">
              <input type="checkbox" checked={c.is_interconnect} onChange={(e) => set({ is_interconnect: e.currentTarget.checked })} /> between harnesses
            </label>
          </Field>
          {c.is_interconnect && (
            <Field label="Mates with"><TextInput value={c.mates_with ?? ""} onChange={(v) => set({ mates_with: v || null })} placeholder="other harness / connector" /></Field>
          )}
          <p className="hint inspector-hint">Its pinout (wires per pin) and external references: Connectors tab.</p>
        </>
      );
    }
  } else if (selection.kind === "ground") {
    const g = project.ground_points.find((x) => x.id === selection.id);
    if (g) {
      const set = (patch: Partial<typeof g>) => setProject(patchItem(project, "ground_points", g.id, patch));
      // Los terminales (ojales, AMP 6.3…) se cargan como conectores de una sola cavidad (plan 4.1).
      const terminals = library.connector_defs.filter((d) => d.cavities.length === 1);
      title = g.short_id || "Ground";
      fields = (
        <>
          <Field label="ID"><TextInput value={g.short_id} onChange={(v) => set({ short_id: v })} placeholder="G1" /></Field>
          <Field label="Name"><TextInput value={g.name} onChange={(v) => set({ name: v })} placeholder="e.g. Chassis ground" /></Field>
          <Field label="Node"><Select value={g.node_id} options={nodeOptions} onChange={(v) => v !== null && set({ node_id: v })} /></Field>
          <Field label="Terminal">
            <Select value={g.terminal_library_part_id} empty="—" options={parts(terminals)} onChange={(v) => set({ terminal_library_part_id: v })} />
          </Field>
        </>
      );
    }
  } else if (selection.kind === "splice") {
    const s = project.splice_instances.find((x) => x.id === selection.id);
    if (s) {
      const set = (patch: Partial<SpliceInstance>) => setProject(patchItem(project, "splice_instances", s.id, patch));
      const onSegment = s.segment_id !== null;
      const seg = onSegment ? project.segments.find((x) => x.id === s.segment_id) : undefined;
      title = s.short_id || "Splice";
      fields = (
        <>
          <Field label="ID"><TextInput value={s.short_id} onChange={(v) => set({ short_id: v })} placeholder="SP1" /></Field>
          <Field label="Part"><Select value={s.library_part_id} options={parts(library.splice_defs)} onChange={(v) => v !== null && set({ library_part_id: v })} /></Field>
          <Field label="Location">
            <Select
              value={onSegment ? "segment" : "node"}
              options={[{ value: "node", label: "At a node" }, { value: "segment", label: "On a segment" }]}
              onChange={(v) => {
                if (v === "node") set({ node_id: project.nodes[0]?.id ?? null, segment_id: null, offset_from_end_mm: null, offset_from_node_id: null });
                else if (v === "segment" && project.segments[0]) {
                  const first = project.segments[0];
                  set({ node_id: null, segment_id: first.id, offset_from_node_id: first.node_a_id, offset_from_end_mm: 0 });
                }
              }}
            />
          </Field>
          {!onSegment && (
            <Field label="Node"><Select value={s.node_id} options={nodeOptions} onChange={(v) => v !== null && set({ node_id: v })} /></Field>
          )}
          {onSegment && (
            <>
              <Field label="Segment">
                <Select
                  value={s.segment_id}
                  options={project.segments.map((x) => ({ value: x.id, label: `S${x.id} · ${x.node_a_id}–${x.node_b_id} · ${x.length_mm} mm` }))}
                  onChange={(v) => {
                    const next = project.segments.find((x) => x.id === v);
                    if (next) set({ segment_id: next.id, offset_from_node_id: next.node_a_id });
                  }}
                />
              </Field>
              <Field label="Distance">
                <NumberInput value={s.offset_from_end_mm} unit="mm" onCommit={(v) => v !== null && set({ offset_from_end_mm: v })} />
              </Field>
              {seg && (
                <Field label="From node">
                  <Select
                    value={s.offset_from_node_id}
                    options={[seg.node_a_id, seg.node_b_id].map((id) => ({ value: id, label: `node ${id}` }))}
                    onChange={(v) => v !== null && set({ offset_from_node_id: v })}
                  />
                </Field>
              )}
            </>
          )}
        </>
      );
    }
  } else if (selection.kind === "wire") {
    const w = project.wire_instances.find((x) => x.id === selection.id);
    if (w) {
      const set = (patch: Partial<typeof w>) => setProject(patchItem(project, "wire_instances", w.id, patch));
      title = w.short_id || "Wire";
      fields = (
        <>
          <Field label="ID"><TextInput value={w.short_id} onChange={(v) => set({ short_id: v })} placeholder="W001" /></Field>
          <Field label="Name"><TextInput value={w.specific_name ?? ""} onChange={(v) => set({ specific_name: v || null })} placeholder="e.g. Brake Press Rear" /></Field>
          <Field label="Category">
            <Select
              value={w.signal_type_id}
              empty="—"
              options={library.signal_types.map((st) => ({ value: st.id, label: st.name }))}
              onChange={(v) => set(wireCategoryPatch(library, w, v))}
            />
          </Field>
          <Field label="Color">
            <span className="inspector-input-row">
              <span className="swatch" style={{ background: w.color || "transparent" }} />
              <TextInput value={w.color ?? ""} onChange={(v) => set({ color: v || null })} placeholder="e.g. violet" />
            </span>
          </Field>
          <Field label="Wire">
            <Select
              value={w.library_part_id}
              options={library.wire_defs.map((wd) => ({ value: wd.part_id, label: `${partLabel(library, wd.part_id)} · ${wd.gauge}` }))}
              onChange={(v) => v !== null && set({ library_part_id: v })}
            />
          </Field>
          <Field label="From"><EndEditor end={w.end_a} project={project} onChange={(end_a) => set({ end_a })} /></Field>
          <Field label="To"><EndEditor end={w.end_b} project={project} onChange={(end_b) => set({ end_b })} /></Field>
          <Field label="Length"><WireLength project={project} library={library} wire={w} /></Field>
          <Field label="Cut length by hand">
            <NumberInput value={w.manual_length_mm} nullable unit="mm" placeholder="from the route" onCommit={(v) => set({ manual_length_mm: v })} />
          </Field>
          <Field label="Cut margin">
            <NumberInput value={w.manual_cut_margin_pct} nullable unit="%" placeholder="default" onCommit={(v) => set({ manual_cut_margin_pct: v })} />
          </Field>
          <Field label="Twist group">
            <Select
              value={project.twist_groups.find((g) => g.wire_instance_ids.includes(w.id))?.id ?? null}
              empty="—"
              options={project.twist_groups.map((g) => ({ value: g.id, label: g.name }))}
              onChange={(v) =>
                setProject({
                  ...project,
                  twist_groups: project.twist_groups.map((g) => ({
                    ...g,
                    wire_instance_ids: g.id === v ? [...g.wire_instance_ids.filter((id) => id !== w.id), w.id] : g.wire_instance_ids.filter((id) => id !== w.id),
                  })),
                })
              }
            />
          </Field>
          <Field label="Label"><TextInput value={w.label ?? ""} onChange={(v) => set({ label: v || null })} placeholder="optional wire label" /></Field>
        </>
      );
    }
  }

  if (!title) {
    return (
      <div className="inspector-panel">
        <div className="tree-panel-title">Inspector</div>
        <p className="hint">Selected item no longer exists.</p>
      </div>
    );
  }

  return (
    <div className="inspector-panel">
      <div className="inspector-header">{title}</div>
      <div className="inspector-body">{fields}</div>
    </div>
  );
}
