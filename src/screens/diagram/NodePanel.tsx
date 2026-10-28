import { useState } from "react";
import { endLabel, usedCavities } from "../../logic/projectEdit";
import { ConnectorPartSelect } from "../../components/ConnectorPartSelect";
import { ConnectorViews } from "../../components/ConnectorViews";
import type { ProjectData } from "../../model/project";
import type { ConnectorChoice, Library } from "../../model/library";
import type { CostReport } from "../../model/calc";

/**
 * Panel de un nodo (doble click): si es un extremo sin conector, se le asigna
 * uno de la biblioteca; si tiene conector, muestra su pinout (plan 7.3 / 10.4):
 * Pin · Función · Termina en · Calibre · Color · Largo de corte.
 */
export function NodePanel({ project, library, report, nodeId, onClose, onAssign }: {
  project: ProjectData;
  library: Library;
  report: CostReport | null;
  nodeId: number;
  onClose: () => void;
  onAssign: (connectorDefId: number, name: string, deviceConnectorId: number | null) => void;
}) {
  const connector = project.connector_instances.find((c) => c.node_id === nodeId);
  const node = project.nodes.find((n) => n.id === nodeId)!;
  const [choice, setChoice] = useState<ConnectorChoice | null>(null);
  const [name, setName] = useState("");
  const partNumber = (id: number) => library.parts.find((p) => p.id === id)?.part_number ?? `#${id}`;

  let body;
  if (connector) {
    const def = library.connector_defs.find((d) => d.part_id === connector.library_part_id);
    const rows = connector.cavities.map((cav) => {
      const wires = project.wire_instances
        .map((w) => ({ w, here: w.end_a.cavity_assignment_id === cav.id ? "a" : w.end_b.cavity_assignment_id === cav.id ? "b" : null }))
        .filter((x) => x.here !== null);
      return { cav, wires };
    });
    body = (
      <>
        <div className="dg-panel-sub">
          {partNumber(connector.library_part_id)}
          {def ? ` · ${def.series ?? ""} ${def.cavities.length}-way ${def.gender}` : ""}
        </div>
        <ConnectorViews library={library} partId={connector.library_part_id} only="front" used={usedCavities(project, connector)} />
        <table className="compact-table dg-pinout">
          <thead>
            <tr><th>Pin</th><th>Function</th><th>Goes to</th><th>Gauge</th><th>Color</th><th>Cut</th></tr>
          </thead>
          <tbody>
            {rows.map(({ cav, wires }) =>
              wires.length === 0 ? (
                <tr key={cav.id} className="dg-pin-unused">
                  <td>{cav.cavity_id}</td>
                  <td colSpan={5}>{cav.external_reference ?? "—"}</td>
                </tr>
              ) : (
                wires.map(({ w, here }) => (
                  <tr key={`${cav.id}-${w.id}`}>
                    <td>{cav.cavity_id}</td>
                    <td>{w.specific_name ?? w.short_id}</td>
                    <td>{endLabel(project, here === "a" ? w.end_b : w.end_a)}</td>
                    <td>{library.wire_defs.find((d) => d.part_id === w.library_part_id)?.gauge ?? "—"}</td>
                    <td>{w.color ?? "—"}</td>
                    <td className="num">{report?.cut_list.find((c) => c.wire_id === w.id)?.cut_length_mm.toFixed(0) ?? "—"}</td>
                  </tr>
                ))
              ),
            )}
          </tbody>
        </table>
      </>
    );
  } else if (node.kind === "connector_end") {
    body = (
      <div className="dg-panel-form">
        <label>
          Part
          <ConnectorPartSelect
            library={library}
            partId={choice?.partId ?? null}
            deviceConnectorId={choice?.deviceConnectorId ?? null}
            placeholder="choose…"
            onChange={setChoice}
          />
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Oil Temp" />
        </label>
        <button className="button-primary" disabled={!choice} onClick={() => choice && onAssign(choice.partId, name, choice.deviceConnectorId)}>
          Assign connector
        </button>
        {library.connector_defs.length === 0 && <p className="hint">The library has no connectors — add them in Library → Connectors.</p>}
      </div>
    );
  } else {
    body =
      node.kind === "ground_point" ? (
        <p className="hint">Ground point: click the node once and, in the Inspector, “+ Create the ground point here”; there you pick its ring lug and name.</p>
      ) : (
        <p className="hint">Nothing to show for a {node.kind.replace("_", " ")} here — use the Inspector.</p>
      );
  }

  return (
    <div className="dg-panel" role="dialog" aria-label={connector ? `${connector.short_id} pinout` : `Node ${nodeId}`}>
      <div className="dg-panel-head">
        <span>{connector ? `${connector.short_id} · ${connector.name || "—"}` : `Node ${nodeId}`}</span>
        <button className="icon-button" onClick={onClose} title="Close" aria-label="Close">×</button>
      </div>
      <div className="dg-panel-body">{body}</div>
    </div>
  );
}
