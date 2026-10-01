import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectData, Selection } from "./types";
import type { Library } from "./libraryTypes";
import type { CostReport } from "./costTypes";
import { endLabel } from "./Cables";

interface Props {
  project: ProjectData | null;
  library: Library;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export default function Costs({ project, library, selection, onSelect }: Props) {
  const [report, setReport] = useState<CostReport | null>(null);

  if (!project) {
    return <p>Open or load a project first (Topology tab).</p>;
  }

  async function run() {
    const result = await invoke<CostReport>("compute_costs", { project, library });
    setReport(result);
  }

  function wireLabel(wireId: number): string {
    const wire = project!.wire_instances.find((w) => w.id === wireId);
    return wire?.short_id ?? `#${wireId}`;
  }

  function wireFromTo(wireId: number): [string, string] {
    const wire = project!.wire_instances.find((w) => w.id === wireId);
    if (!wire) return ["—", "—"];
    return [endLabel(project!, wire.end_a), endLabel(project!, wire.end_b)];
  }

  function partLabel(row: { library_part_id: number; part_number: string }): string {
    return row.part_number || `#${row.library_part_id}`;
  }

  function libraryPartNumber(id: number): string {
    return library.parts.find((p) => p.id === id)?.part_number ?? `#${id}`;
  }

  function connectorLabel(id: number): string {
    return project!.connector_instances.find((c) => c.id === id)?.short_id ?? `#${id}`;
  }

  return (
    <>
      <div className="toolbar">
        <button className="button-primary" onClick={run}>Compute</button>
        {report && (
          <span className="status">
            {report.cut_list.length} wires · {report.bom.length} parts · total ${report.cost_summary.total_usd.toFixed(2)}
          </span>
        )}
      </div>

      {report && (
        <>
          <section>
            <h3>Cut list</h3>
            <table>
              <thead>
                <tr><th>ID</th><th>From</th><th>To</th><th>Length w/ twist (mm)</th><th>Margin</th><th>Min. by twist</th><th>Cut length (mm)</th></tr>
              </thead>
              <tbody>
                {report.cut_list.map((cut) => {
                  const [from, to] = wireFromTo(cut.wire_id);
                  const belowMinimum = cut.margin_pct < cut.twist_min_margin_pct;
                  return (
                    <tr
                      key={cut.wire_id}
                      className={`selectable-row${selection?.kind === "wire" && selection.id === cut.wire_id ? " selected-row" : ""}`}
                      onClick={() => onSelect({ kind: "wire", id: cut.wire_id })}
                    >
                      <td>{wireLabel(cut.wire_id)}</td>
                      <td>{from}</td>
                      <td>{to}</td>
                      <td>{cut.length_with_twist_mm.toFixed(1)}</td>
                      <td style={belowMinimum ? { color: "var(--warning)" } : undefined}>
                        {cut.margin_pct.toFixed(1)}%
                        {belowMinimum && ` (min ${cut.twist_min_margin_pct.toFixed(1)}%)`}
                      </td>
                      <td>{cut.twist_min_margin_pct.toFixed(1)}%</td>
                      <td>{cut.cut_length_mm.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section>
            <h3>Bill of materials</h3>
            <table>
              <thead>
                <tr><th>Category</th><th>Part</th><th>Needed</th><th>Unit</th><th>To buy</th><th>Unit price</th><th>Subtotal</th><th>Price date</th></tr>
              </thead>
              <tbody>
                {report.bom.map((row) => (
                  <tr key={row.library_part_id}>
                    <td>{row.category}</td>
                    <td>{partLabel(row)}</td>
                    <td>{row.quantity_needed.toFixed(row.unit === "meter" ? 2 : 0)}</td>
                    <td>{row.unit}</td>
                    <td>{row.quantity_to_buy.toFixed(row.unit === "meter" ? 2 : 0)}</td>
                    <td>{row.unit_price_usd !== null ? `$${row.unit_price_usd.toFixed(2)}` : "—"}</td>
                    <td>{row.subtotal_usd !== null ? `$${row.subtotal_usd.toFixed(2)}` : "—"}</td>
                    <td>{row.price_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {report.segment_diameters.length > 0 && (
            <section>
              <h3>Segment diameters &amp; covering (termocontraíble)</h3>
              <table>
                <thead>
                  <tr><th>Segment</th><th>Bundle Ø (mm)</th><th>Final Ø (mm)</th><th>Suggested covering</th><th>Alternatives</th></tr>
                </thead>
                <tbody>
                  {report.segment_diameters.map((s) => {
                    const suggested = s.covering_options.find((c) => c.fits);
                    const alternatives = s.covering_options.filter((c) => c.fits && c.library_part_id !== suggested?.library_part_id);
                    return (
                      <tr key={s.segment_id}>
                        <td>S{s.segment_id}</td>
                        <td>{s.bundle_diameter_mm.toFixed(2)}</td>
                        <td>{s.final_diameter_mm.toFixed(2)}</td>
                        <td style={!suggested ? { color: "var(--warning)" } : undefined}>
                          {suggested ? libraryPartNumber(suggested.library_part_id) : "none in library fits"}
                        </td>
                        <td>{alternatives.map((a) => libraryPartNumber(a.library_part_id)).join(", ") || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {report.connector_terminations.length > 0 && (
            <section>
              <h3>Connector boots</h3>
              <table>
                <thead>
                  <tr><th>Connector</th><th>Suggested boot</th><th>Alternatives</th></tr>
                </thead>
                <tbody>
                  {report.connector_terminations.map((c) => {
                    const suggested = c.boot_options.find((b) => b.fits);
                    const alternatives = c.boot_options.filter((b) => b.fits && b.library_part_id !== suggested?.library_part_id);
                    return (
                      <tr key={c.connector_instance_id}>
                        <td>{connectorLabel(c.connector_instance_id)}</td>
                        <td style={!suggested ? { color: "var(--warning)" } : undefined}>
                          {suggested ? libraryPartNumber(suggested.library_part_id) : "none in library fits"}
                        </td>
                        <td>{alternatives.map((a) => libraryPartNumber(a.library_part_id)).join(", ") || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {report.breakout_terminations.length > 0 && (
            <section>
              <h3>Breakout T-molds</h3>
              <table>
                <thead>
                  <tr><th>Breakout</th><th>Suggested T-mold</th><th>Leg fit (mm)</th><th>Alternatives</th></tr>
                </thead>
                <tbody>
                  {report.breakout_terminations.map((b) => {
                    const suggested = b.t_mold_options.find((t) => t.fits);
                    const alternatives = b.t_mold_options.filter((t) => t.fits && t.library_part_id !== suggested?.library_part_id);
                    return (
                      <tr key={b.node_id}>
                        <td>Node {b.node_id}</td>
                        <td style={!suggested ? { color: "var(--warning)" } : undefined}>
                          {suggested ? libraryPartNumber(suggested.library_part_id) : "none in library fits"}
                        </td>
                        <td>
                          {suggested?.leg_fits.map((lf) => `S${lf.segment_id}: ${lf.diameter_mm.toFixed(2)}`).join(", ") ?? "—"}
                        </td>
                        <td>{alternatives.map((a) => libraryPartNumber(a.library_part_id)).join(", ") || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          <section>
            <h3>Summary</h3>
            <table>
              <tbody>
                <tr><td>Materials</td><td>${report.cost_summary.materials_usd.toFixed(2)}</td></tr>
                <tr><td>Labor</td><td>${report.cost_summary.labor_usd.toFixed(2)}</td></tr>
                <tr><td>Markup</td><td>${report.cost_summary.markup_usd.toFixed(2)}</td></tr>
                <tr><td><strong>Total</strong></td><td><strong>${report.cost_summary.total_usd.toFixed(2)}</strong></td></tr>
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
