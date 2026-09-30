import { useState } from "react";
import type { CavityAssignment, ConnectorInstance, ProjectData } from "./types";
import type { Library } from "./libraryTypes";

function nextId(ids: number[]): number {
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

function partLabel(library: Library, partId: number | null): string {
  if (partId === null) return "—";
  const part = library.parts.find((p) => p.id === partId);
  return part ? part.part_number || `#${partId}` : `#${partId} (not in library)`;
}

function allCavityIds(project: ProjectData): number[] {
  return project.connector_instances.flatMap((c) => c.cavities.map((cav) => cav.id));
}

function cavitiesFromDef(project: ProjectData, connectorDefId: number, library: Library): CavityAssignment[] {
  const def = library.connector_defs.find((cd) => cd.part_id === connectorDefId);
  if (!def) return [];
  let nextCavityId = nextId(allCavityIds(project));
  return def.cavities.map((cav) => ({
    id: nextCavityId++,
    cavity_id: cav.cavity_id,
    contact_library_part_id: null,
    seal_plug_library_part_id: null,
    external_reference: null,
  }));
}

interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData) => void;
  library: Library;
}

export default function Conectores({ project, setProject, library }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [nodeFilter, setNodeFilter] = useState("");

  if (!project) {
    return <p>Open or load a project first (Topology tab).</p>;
  }
  if (project.nodes.length === 0) {
    return <p>This project has no nodes yet. Create at least one in the Topology tab.</p>;
  }

  function update(id: number, patch: Partial<ConnectorInstance>) {
    if (!project) return;
    setProject({
      ...project,
      connector_instances: project.connector_instances.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  }

  function changeConnectorDef(connector: ConnectorInstance, connectorDefId: number) {
    if (!project) return;
    update(connector.id, {
      library_part_id: connectorDefId,
      cavities: cavitiesFromDef(project, connectorDefId, library),
    });
  }

  function updateCavity(connector: ConnectorInstance, cavityId: number, patch: Partial<CavityAssignment>) {
    update(connector.id, {
      cavities: connector.cavities.map((c) => (c.id === cavityId ? { ...c, ...patch } : c)),
    });
  }

  function remove(id: number) {
    if (!project) return;
    setProject({ ...project, connector_instances: project.connector_instances.filter((c) => c.id !== id) });
  }

  function add() {
    if (!project) return;
    if (library.connector_defs.length === 0) {
      alert("Add at least one connector in Library → Connectors before adding one here.");
      return;
    }
    const id = nextId(project.connector_instances.map((c) => c.id));
    const connectorDef = library.connector_defs[0];
    const newConnector: ConnectorInstance = {
      id,
      short_id: `X${id}`,
      name: "",
      library_part_id: connectorDef.part_id,
      device_instance_id: null,
      node_id: project.nodes[0].id,
      termination: null,
      termination_library_part_id: null,
      backshell_library_part_id: null,
      status: "pending",
      is_interconnect: false,
      mates_with: null,
      cavities: cavitiesFromDef(project, connectorDef.part_id, library),
    };
    setProject({ ...project, connector_instances: [...project.connector_instances, newConnector] });
  }

  const visibleConnectors = project.connector_instances.filter((connector) => {
    if (statusFilter && connector.status !== statusFilter) return false;
    if (nodeFilter && String(connector.node_id) !== nodeFilter) return false;
    if (search) {
      const haystack = [connector.short_id, connector.name, connector.mates_with ?? ""].join(" ").toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <>
      <h2>Connectors</h2>

      <div className="toolbar">
        <input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search id, name, mates with…" style={{ width: "16em" }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.currentTarget.value)}>
          <option value="">All statuses</option>
          <option value="complete">Complete</option>
          <option value="pending">Pending</option>
        </select>
        <select value={nodeFilter} onChange={(e) => setNodeFilter(e.currentTarget.value)}>
          <option value="">All nodes</option>
          {project.nodes.map((n) => <option key={n.id} value={n.id}>node {n.id}</option>)}
        </select>
        <span className="status">{visibleConnectors.length} of {project.connector_instances.length} connectors</span>
      </div>

      {visibleConnectors.map((connector) => (
        <div key={connector.id} className="query-result" style={{ marginBottom: "1rem" }}>
          <div className="toolbar">
            <input value={connector.short_id} onChange={(e) => update(connector.id, { short_id: e.currentTarget.value })} placeholder="X1" style={{ width: "5em" }} />
            <input value={connector.name} onChange={(e) => update(connector.id, { name: e.currentTarget.value })} placeholder="descriptive name" />

            <select value={connector.library_part_id} onChange={(e) => changeConnectorDef(connector, Number(e.currentTarget.value))}>
              {library.connector_defs.map((cd) => (
                <option key={cd.part_id} value={cd.part_id}>{partLabel(library, cd.part_id)}</option>
              ))}
            </select>

            <select value={connector.node_id} onChange={(e) => update(connector.id, { node_id: Number(e.currentTarget.value) })}>
              {project.nodes.map((n) => <option key={n.id} value={n.id}>node {n.id}</option>)}
            </select>

            <select value={connector.device_instance_id ?? ""} onChange={(e) => update(connector.id, { device_instance_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
              <option value="">no device</option>
              {project.device_instances.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            <select value={connector.termination ?? ""} onChange={(e) => update(connector.id, { termination: e.currentTarget.value || null, termination_library_part_id: null })}>
              <option value="">termination: —</option>
              <option value="boot_straight">Straight boot</option>
              <option value="boot_90">90° boot</option>
              <option value="adhesive_heatshrink">Adhesive heat-shrink</option>
              <option value="none">None</option>
            </select>

            {(connector.termination === "boot_straight" || connector.termination === "boot_90") && (
              <select value={connector.termination_library_part_id ?? ""} onChange={(e) => update(connector.id, { termination_library_part_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
                <option value="">boot: —</option>
                {library.accessory_defs.map((ad) => {
                  const part = library.parts.find((p) => p.id === ad.part_id);
                  return <option key={ad.part_id} value={ad.part_id}>{part?.part_number ?? `#${ad.part_id}`}</option>;
                })}
              </select>
            )}
            {connector.termination === "adhesive_heatshrink" && (
              <select value={connector.termination_library_part_id ?? ""} onChange={(e) => update(connector.id, { termination_library_part_id: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
                <option value="">covering: —</option>
                {library.covering_defs.map((cd) => {
                  const part = library.parts.find((p) => p.id === cd.part_id);
                  return <option key={cd.part_id} value={cd.part_id}>{part?.part_number ?? `#${cd.part_id}`}</option>;
                })}
              </select>
            )}

            <select value={connector.status} onChange={(e) => update(connector.id, { status: e.currentTarget.value as ConnectorInstance["status"] })}>
              <option value="complete">Complete</option>
              <option value="pending">Pending</option>
            </select>

            <label style={{ fontSize: "0.9em" }}>
              <input type="checkbox" checked={connector.is_interconnect} onChange={(e) => update(connector.id, { is_interconnect: e.currentTarget.checked })} />
              interconnect
            </label>
            {connector.is_interconnect && (
              <input value={connector.mates_with ?? ""} onChange={(e) => update(connector.id, { mates_with: e.currentTarget.value || null })} placeholder="mates with…" />
            )}

            <button onClick={() => remove(connector.id)}>delete connector</button>
          </div>

          <table>
            <thead><tr><th>Cavity</th><th>Contact</th><th>Seal plug</th><th>External reference</th></tr></thead>
            <tbody>
              {connector.cavities.map((cav) => (
                <tr key={cav.id}>
                  <td>{cav.cavity_id}</td>
                  <td>
                    <select
                      value={cav.contact_library_part_id ?? ""}
                      onChange={(e) => updateCavity(connector, cav.id, { contact_library_part_id: e.currentTarget.value ? Number(e.currentTarget.value) : null, seal_plug_library_part_id: null })}
                    >
                      <option value="">—</option>
                      {library.contact_defs.map((cd) => <option key={cd.part_id} value={cd.part_id}>{partLabel(library, cd.part_id)}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      value={cav.seal_plug_library_part_id ?? ""}
                      onChange={(e) => updateCavity(connector, cav.id, { seal_plug_library_part_id: e.currentTarget.value ? Number(e.currentTarget.value) : null, contact_library_part_id: null })}
                    >
                      <option value="">—</option>
                      {library.seal_plug_defs.map((sp) => <option key={sp.part_id} value={sp.part_id}>{partLabel(library, sp.part_id)}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      value={cav.external_reference ?? ""}
                      onChange={(e) => updateCavity(connector, cav.id, { external_reference: e.currentTarget.value || null })}
                      placeholder="what's on the other side"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <button onClick={add}>+ connector</button>
    </>
  );
}
