import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CostReport, WireCutLength } from "../model/calc";
import { changeConnectorPart, nextId, patchItem, usedCavities, wireCategoryPatch } from "../logic/projectEdit";
import type { ComponentInstance, ConnectorInstance, Finding, Node, ProjectData, Selection, SpliceInstance, WireInstance } from "../model/project";
import { partLabel, type Library } from "../model/library";
import { EndEditor } from "../components/EndEditor";
import { ConnectorViews } from "../components/ConnectorViews";
import { ConnectorPartSelect } from "../components/ConnectorPartSelect";
import { NODE_KINDS, NODE_KIND_LABELS, NODE_TERMINATIONS, NODE_TERMINATION_LABELS } from "../logic/nodeLabels";

type Placed = Pick<SpliceInstance, "node_id" | "segment_id" | "offset_from_end_mm" | "offset_from_node_id">;

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
 * Recorrido y largo de un cable: los segmentos por los que pasa, el largo con
 * trenzado, el margen y el de corte (o el puesto a mano). Lo calcula el backend.
 */
function WireLength({ project, wire, report, projectRevision }: { project: ProjectData; wire: WireInstance; report: CostReport | null; projectRevision: number }) {
  const [route, setRoute] = useState<number[] | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void invoke<number[] | null>("wire_route", { wireId: wire.id }).then((r) => {
      if (!cancelled) setRoute(r);
    });
    return () => {
      cancelled = true;
    };
  }, [projectRevision, wire.id]);
  if (route === undefined || !report) return <span className="hint">…</span>;
  const info: { route: number[] | null; cut: WireCutLength | undefined } = { route, cut: report.cut_list.find((c) => c.wire_id === wire.id) };
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

/** Diámetro del segmento (bundle y con coberturas) y el termo que sugiere el cálculo. */
function SegmentDiameter({ library, segmentId, report }: { library: Library; segmentId: number; report: CostReport | null }) {
  if (!report) return <span className="hint">…</span>;
  const info = report.segment_diameters.find((d) => d.segment_id === segmentId) ?? null;
  if (info === null) return <span className="hint">No wires in this segment.</span>;
  const suggested = info.covering_options.find((c) => c.fits);
  return (
    <div className="inspector-length">
      <span>Bundle Ø {info.bundle_diameter_mm.toFixed(1)} mm · final Ø {info.final_diameter_mm.toFixed(1)} mm</span>
      <span>Suggested heat-shrink: {suggested ? library.parts.find((p) => p.id === suggested.library_part_id)?.part_number ?? "—" : "none in library fits"}</span>
    </div>
  );
}

/** Dónde está un splice o componente: en un nodo, o sobre un segmento a X mm de uno de sus extremos (plan 4.2). */
function LocationFields({ project, item, nodeOptions, set }: {
  project: ProjectData;
  item: Placed;
  nodeOptions: { value: number; label: string }[];
  set: (patch: Partial<Placed>) => void;
}) {
  const onSegment = item.segment_id !== null;
  const seg = onSegment ? project.segments.find((x) => x.id === item.segment_id) : undefined;
  return (
    <>
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
        <Field label="Node"><Select value={item.node_id} options={nodeOptions} onChange={(v) => v !== null && set({ node_id: v })} /></Field>
      )}
      {onSegment && (
        <>
          <Field label="Segment">
            <Select
              value={item.segment_id}
              options={project.segments.map((x) => ({ value: x.id, label: `S${x.id} · ${x.node_a_id}–${x.node_b_id} · ${x.length_mm} mm` }))}
              onChange={(v) => {
                const next = project.segments.find((x) => x.id === v);
                if (next) set({ segment_id: next.id, offset_from_node_id: next.node_a_id });
              }}
            />
          </Field>
          <Field label="Distance">
            <NumberInput value={item.offset_from_end_mm} unit="mm" onCommit={(v) => v !== null && set({ offset_from_end_mm: v })} />
          </Field>
          {seg && (
            <Field label="From node">
              <Select
                value={item.offset_from_node_id}
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

interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData) => void;
  library: Library;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Los problemas de Checks: se muestran los de lo seleccionado. */
  findings: Finding[];
  /** Costos de la revisión actual, o null mientras se calculan. */
  report: CostReport | null;
  /** Revisión del proyecto en el backend: el recorrido del cable se rehace cuando cambia. */
  projectRevision: number;
}

export default function Inspector({ project, setProject, library, selection, onSelect, findings, report, projectRevision }: Props) {
  if (!project || !selection) {
    return (
      <div className="inspector-panel">
        <div className="tree-panel-title">Inspector</div>
        <p className="hint">Select a row in a table, or an item in the tree or a diagram, to see and edit it here.</p>
        {project && (
          <button className="inspector-harness-button" onClick={() => onSelect({ kind: "project", id: 0 })}>
            Harness data: name, code, margins…
          </button>
        )}
      </div>
    );
  }

  const nodeOptions = project.nodes.map((n) => ({ value: n.id, label: `node ${n.id} · ${NODE_KIND_LABELS[n.kind]}` }));
  const parts = (defs: { part_id: number }[]) => defs.map((d) => ({ value: d.part_id, label: partLabel(library, d.part_id) }));

  let title = "";
  let fields: ReactNode = null;

  if (selection.kind === "project") {
    const p = project.project;
    const set = (patch: Partial<typeof p>) => setProject({ ...project, project: { ...p, ...patch } });
    const categories = [...new Set(library.parts.map((x) => x.category))].sort();
    title = "Harness";
    fields = (
      <>
        <Field label="Name"><TextInput value={p.name} onChange={(v) => set({ name: v })} placeholder="e.g. Cableado Motor" /></Field>
        <Field label="Code"><TextInput value={p.harness_code} onChange={(v) => set({ harness_code: v })} placeholder="e.g. MOT-01" /></Field>
        <Field label="Client"><TextInput value={p.client ?? ""} onChange={(v) => set({ client: v || null })} /></Field>
        <Field label="Revision"><TextInput value={p.revision ?? ""} onChange={(v) => set({ revision: v || null })} /></Field>
        <Field label="Main connector">
          <Select
            value={p.main_connector_instance_id}
            empty="—"
            options={project.connector_instances.map((c) => ({ value: c.id, label: c.name ? `${c.short_id} · ${c.name}` : c.short_id }))}
            onChange={(v) => set({ main_connector_instance_id: v })}
          />
        </Field>
        <Field label="Cut margin"><NumberInput value={p.default_cut_margin_pct} unit="%" onCommit={(v) => v !== null && set({ default_cut_margin_pct: v })} /></Field>
        <Field label="Twist pitch"><NumberInput value={p.default_twist_pitch_factor} unit="× bundle Ø" onCommit={(v) => v !== null && set({ default_twist_pitch_factor: v })} /></Field>
        <Field label="Fill factor"><NumberInput value={p.fill_factor} onCommit={(v) => v !== null && v > 0 && v <= 1 && set({ fill_factor: v })} /></Field>
        <Field label="Labor"><NumberInput value={p.labor_hours} unit="h" onCommit={(v) => v !== null && set({ labor_hours: v })} /></Field>
        <Field label="Labor rate"><NumberInput value={p.labor_rate_usd} unit="USD/h" onCommit={(v) => v !== null && set({ labor_rate_usd: v })} /></Field>
        <Field label="Markup"><NumberInput value={p.markup_pct} unit="%" onCommit={(v) => v !== null && set({ markup_pct: v })} /></Field>
        <Field label="Materials cost">
          <Select
            value={p.cost_on_purchased ? "purchased" : "used"}
            options={[{ value: "used", label: "On what is used" }, { value: "purchased", label: "On what is bought (full packs)" }]}
            onChange={(v) => set({ cost_on_purchased: v === "purchased" })}
          />
        </Field>
        {categories.map((cat) => (
          <Field key={cat} label={`Spare · ${cat}`}>
            <NumberInput
              value={p.spare_pcts[cat] ?? null}
              nullable
              unit="%"
              placeholder="0"
              onCommit={(v) => {
                const { [cat]: _, ...rest } = p.spare_pcts;
                set({ spare_pcts: v ? { ...rest, [cat]: v } : rest });
              }}
            />
          </Field>
        ))}
      </>
    );
  } else if (selection.kind === "node") {
    const node = project.nodes.find((n) => n.id === selection.id);
    if (node) {
      const set = (patch: Partial<Node>) => setProject(patchItem(project, "nodes", node.id, patch));
      title = `Node ${node.id}`;
      fields = (
        <>
          <Field label="Kind">
            <Select value={node.kind} options={NODE_KINDS.map((k) => ({ value: k, label: NODE_KIND_LABELS[k] }))} onChange={(v) => v && set({ kind: v })} />
          </Field>
          {node.kind === "ground_point" && (() => {
            // La masa (G1, con su ojal) vive en el nodo: se crea o se abre desde acá.
            const ground = project.ground_points.find((g) => g.node_id === node.id);
            return (
              <Field label="Ground point">
                {ground ? (
                  <button className="link-button" onClick={() => onSelect({ kind: "ground", id: ground.id })}>
                    Edit {ground.short_id}{ground.name ? ` · ${ground.name}` : ""} (ring lug, name)
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const id = nextId(project.ground_points.map((g) => g.id));
                      setProject({ ...project, ground_points: [...project.ground_points, { id, short_id: `G${id}`, name: "", terminal_library_part_id: null, node_id: node.id }] });
                      onSelect({ kind: "ground", id });
                    }}
                  >
                    + Create the ground point here
                  </button>
                )}
              </Field>
            );
          })()}
          <Field label="Termination">
            <Select
              value={node.termination}
              empty="—"
              options={NODE_TERMINATIONS.map((t) => ({ value: t, label: NODE_TERMINATION_LABELS[t] }))}
              onChange={(v) => set({ termination: v, termination_library_part_id: null })}
            />
          </Field>
          {node.termination === "t_mold" && (
            <Field label="T-mold">
              <Select value={node.termination_library_part_id} empty="—" options={parts(library.t_mold_defs)} onChange={(v) => set({ termination_library_part_id: v })} />
            </Field>
          )}
          {node.termination === "adhesive_heatshrink" && (
            <>
              <Field label="Covering">
                <Select value={node.termination_library_part_id} empty="—" options={parts(library.covering_defs)} onChange={(v) => set({ termination_library_part_id: v })} />
              </Field>
              {/* Va sobre los termos que llegan al breakout: solo suma al BOM y al costo. */}
              <Field label="Piece length">
                <NumberInput value={node.adhesive_heatshrink_length_mm} nullable unit="mm" placeholder="for the cost" onCommit={(v) => set({ adhesive_heatshrink_length_mm: v })} />
              </Field>
            </>
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
          <Field label="Diameter"><SegmentDiameter library={library} segmentId={seg.id} report={report} /></Field>
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
          <Field label="Terminal (ring lug)">
            <Select value={g.terminal_library_part_id} empty="—" options={parts(terminals)} onChange={(v) => set({ terminal_library_part_id: v })} />
            {terminals.length === 0 && (
              <span className="hint">No ring lugs in the library yet: add one in Library → Connectors with a single cavity.</span>
            )}
          </Field>
        </>
      );
    }
  } else if (selection.kind === "splice") {
    const s = project.splice_instances.find((x) => x.id === selection.id);
    if (s) {
      const set = (patch: Partial<SpliceInstance>) => setProject(patchItem(project, "splice_instances", s.id, patch));
      title = s.short_id || "Splice";
      fields = (
        <>
          <Field label="ID"><TextInput value={s.short_id} onChange={(v) => set({ short_id: v })} placeholder="SP1" /></Field>
          <Field label="Name"><TextInput value={s.name} onChange={(v) => set({ name: v })} placeholder="e.g. Coils pin 2" /></Field>
          <Field label="Part"><Select value={s.library_part_id} options={parts(library.splice_defs)} onChange={(v) => v !== null && set({ library_part_id: v })} /></Field>
          <LocationFields project={project} item={s} nodeOptions={nodeOptions} set={set} />
        </>
      );
    }
  } else if (selection.kind === "component") {
    const c = project.component_instances.find((x) => x.id === selection.id);
    if (c) {
      const set = (patch: Partial<ComponentInstance>) => setProject(patchItem(project, "component_instances", c.id, patch));
      title = c.short_id || "Component";
      fields = (
        <>
          <Field label="ID"><TextInput value={c.short_id} onChange={(v) => set({ short_id: v })} placeholder="R1" /></Field>
          <Field label="Name"><TextInput value={c.name} onChange={(v) => set({ name: v })} placeholder="e.g. CAN termination 100 Ω" /></Field>
          <Field label="Part">
            <Select
              value={c.library_part_id}
              options={library.component_defs.map((d) => ({ value: d.part_id, label: [partLabel(library, d.part_id), d.component_type, d.value].filter(Boolean).join(" · ") }))}
              onChange={(v) => v !== null && set({ library_part_id: v })}
            />
          </Field>
          <LocationFields project={project} item={c} nodeOptions={nodeOptions} set={set} />
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
          <Field label="Length"><WireLength project={project} wire={w} report={report} projectRevision={projectRevision} /></Field>
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

  const issues = findings.filter((f) => f.target?.kind === selection.kind && f.target.id === selection.id);
  return (
    <div className="inspector-panel">
      <div className="inspector-header">{title}</div>
      <div className="inspector-body">
        {fields}
        {issues.length > 0 && (
          <ul className="findings inspector-findings">
            {issues.map((f, i) => (
              <li key={i} className={`finding finding-${f.severity}`}>{f.message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
