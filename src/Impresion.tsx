import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectData } from "./types";
import { partLabel, type Library } from "./libraryTypes";
import type { CostReport } from "./costTypes";
import { connectorHeatShrink, coveringRows, cutListGroups, cutListRows, labelRows, pinoutRows, terminationRows, toCsv, wireTotals, type CutSort } from "./sheets";
import { ConnectorFaceView } from "./ConnectorFaceView";
import { AssemblySheet } from "./AssemblySheet";
import { usedCavities } from "./Inspector";
import { fileName, pickFileToSave } from "./fileDialogs";

/**
 * Etapa 6: hojas para imprimir o guardar como PDF (diálogo de impresión del
 * sistema) y exportaciones. La vista previa son las mismas hojas que salen
 * impresas; el resto de la ventana se oculta al imprimir (App.css, @media print).
 */

type Doc = "cut" | "pinout" | "assembly" | "labels";
const DOCS: [Doc, string, string][] = [
  ["cut", "Cut list", "One row per wire, divided by connector, with metres per wire type, heat-shrink pieces and boots."],
  ["pinout", "Pinout sheets", "Workshop format: one block per connector with its pins, where each one ends, and its front view."],
  ["assembly", "Assembly drawing", "The harness diagram with its lengths, for the table: fitted to one sheet (A3 for big harnesses)."],
  ["labels", "Label list", "Harness, connectors and labelled wires, for the label printer."],
];
const CUT_SORTS: [CutSort, string][] = [
  ["pin", "Pin"],
  ["type", "Wire type (cut from the same reel)"],
  ["length", "Length"],
];
const PAPER_MM = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] } as const;
type Paper = keyof typeof PAPER_MM;

interface Props {
  project: ProjectData | null;
  library: Library;
}

export default function Impresion({ project, library }: Props) {
  const [doc, setDoc] = useState<Doc>("cut");
  const [sort, setSort] = useState<CutSort>("pin");
  const [paper, setPaper] = useState<Paper>("A4");
  const [landscape, setLandscape] = useState(false);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState("");
  const [toScale, setToScale] = useState(false);
  const [showDistances, setShowDistances] = useState(true);
  const [distances, setDistances] = useState<Record<string, number> | null>(null);
  const [data, setData] = useState<{ report: CostReport; nets: Map<number, number[]> } | null>(null);

  // Largos de corte y nets: los calcula el backend, igual que en Costs y el diagrama.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      const report = await invoke<CostReport>("compute_costs", { project, library });
      // ponytail: un wire_net por cable (cada uno manda el proyecto entero); si con arneses grandes tarda, un comando que devuelva todas las nets juntas.
      const nets = await Promise.all(
        project.wire_instances.map(async (w) => [w.id, await invoke<number[]>("wire_net", { project, wireId: w.id })] as const),
      );
      if (!cancelled) setData({ report, nets: new Map(nets) });
    })();
    return () => {
      cancelled = true;
    };
  }, [project, library]);

  // Distancia acumulada desde el conector principal (hoja de armado, plan 10.2).
  const mainNode = project?.connector_instances.find((c) => c.id === project.project.main_connector_instance_id)?.node_id;
  useEffect(() => {
    if (!project || mainNode === undefined || !showDistances) return setDistances(null);
    let cancelled = false;
    void invoke<Record<string, number>>("node_distances", { project, fromNodeId: mainNode }).then((d) => {
      if (!cancelled) setDistances(d);
    });
    return () => {
      cancelled = true;
    };
  }, [project, mainNode, showDistances]);

  if (!project) return <p>Open or load a project first (Topology tab).</p>;

  const [w, h] = PAPER_MM[paper];
  const sheetWidth = `${landscape ? h : w}mm`;
  const netOf = (id: number) => data?.nets.get(id) ?? [id];

  // El título del documento es el nombre que el diálogo propone para el PDF
  // (y el encabezado del navegador, si se deja activado): "MOT-01 Cut list".
  function print() {
    const previous = document.title;
    const docName = DOCS.find(([key]) => key === doc)![1];
    document.title = [project!.project.harness_code, docName].filter(Boolean).join(" ");
    window.addEventListener("afterprint", () => (document.title = previous), { once: true });
    window.print();
  }

  async function exportLabels() {
    const path = await pickFileToSave("csv", `${project!.project.harness_code || "harness"}-labels.csv`);
    if (!path) return;
    try {
      // BOM al principio: Excel reconoce el UTF-8 (acentos, "·").
      await invoke("write_text_file", { path, contents: "﻿" + toCsv(["Type", "ID", "Text"], labelRows(project!)) });
      setStatus(`Saved ${fileName(path)}`);
    } catch (err) {
      setStatus(String(err));
    }
  }

  let sheets;
  if (!data) {
    sheets = <p className="hint">Computing cut lengths…</p>;
  } else if (doc === "cut") {
    const rows = cutListRows(project, library, data.report.cut_list, sort);
    sheets = (
      <section className="sheet" style={{ width: sheetWidth }}>
        <SheetHeader project={project} title="Cut list" />
        <table>
          <thead>
            <tr>
              <th>Wire</th><th>Function</th><th>Type</th><th>Color</th><th>From</th><th>To</th><th>Twist</th>
              <th className="num">Route (mm)</th><th className="num">Margin</th><th className="num">Cut (mm)</th><th className="check" aria-label="Done">✓</th>
            </tr>
          </thead>
          {/* Dividida por conector (cada cable una sola vez), para no perderse en la mesa. */}
          {cutListGroups(project, rows).map((g) => (
            <tbody key={g.connectorId ?? "other"} className="cut-group">
              <tr className="cut-group-title">
                <td colSpan={11}>
                  {g.title}
                  <span className="cut-group-count">{g.rows.length} wire{g.rows.length === 1 ? "" : "s"}</span>
                  {g.connectorId !== null && (
                    <span className="cut-group-hs">
                      Heat-shrink: {connectorHeatShrink(project, library, g.connectorId, data.report.segment_diameters).join(" / ") || "—"}
                    </span>
                  )}
                </td>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.wireId}>
                  <td className="strong">{r.id}</td><td>{r.fn}</td><td>{r.wireType}</td><td>{r.color}</td><td>{r.from}</td><td>{r.to}</td><td>{r.twist ?? ""}</td>
                  <td className="num">{r.withTwistMm.toFixed(0)}</td><td className="num">{r.manual ? "by hand" : `${r.marginPct.toFixed(0)}%`}</td>
                  <td className="num strong">{r.cutMm.toFixed(0)}</td><td className="check"><span className="tick-box" /></td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        <h4>Metres per wire type</h4>
        <table className="sheet-totals">
          <thead><tr><th>Type</th><th className="num">Wires</th><th className="num">Metres</th></tr></thead>
          <tbody>
            {wireTotals(rows).map((t) => (
              <tr key={t.wireType}><td>{t.wireType}</td><td className="num">{t.count}</td><td className="num strong">{t.meters.toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
        <CoveringSheet project={project} library={library} report={data.report} />
      </section>
    );
  } else if (doc === "pinout") {
    // Formato de las hojas del taller (ej. "Instalación chasis Chevrolet Tracker"):
    // una tabla apaisada, un bloque por conector, encabezados en castellano.
    sheets = (
      <section className="sheet" style={{ width: sheetWidth }}>
        <SheetHeader project={project} title="Pinout" />
        <table className="pinout-table">
          <colgroup>
            <col style={{ width: "15%" }} /><col style={{ width: "5%" }} /><col style={{ width: "20%" }} /><col style={{ width: "28%" }} />
            <col style={{ width: "14%" }} /><col style={{ width: "18%" }} />
          </colgroup>
          <thead>
            <tr><th>Nombre</th><th>Pin</th><th>Función</th><th>Termina en</th><th>Conector</th><th>Vista delantera</th></tr>
          </thead>
          {project.connector_instances
            .filter((c) => !skipped.has(c.id))
            .map((c, i) => (
              <PinoutBlock key={c.id} first={i === 0} project={project} library={library} connectorId={c.id} netOf={netOf} />
            ))}
        </table>
      </section>
    );
  } else if (doc === "assembly") {
    sheets = (
      <section className="sheet" style={{ width: sheetWidth }}>
        <SheetHeader project={project} title="Assembly drawing" />
        {/* Alto de la hoja menos márgenes (10 mm × 2) y encabezado: el dibujo entra en una sola hoja. */}
        <AssemblySheet project={project} library={library} report={data.report} distances={distances} toScale={toScale} maxHeightMm={(landscape ? w : h) - 38} />
      </section>
    );
  } else {
    sheets = (
      <section className="sheet" style={{ width: sheetWidth }}>
        <SheetHeader project={project} title="Label list" />
        <table>
          <thead><tr><th>Type</th><th>ID</th><th>Text</th></tr></thead>
          <tbody>
            {labelRows(project).map(([kind, id, text], i) => (
              <tr key={i}><td>{kind}</td><td className="strong">{id}</td><td>{text}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <div className="print-screen">
      {/* Tamaño de hoja y número de página para el diálogo de impresión. Definir
          las cajas del margen reemplaza el encabezado/pie del navegador (fecha, URL). */}
      <style>{`@page { size: ${paper} ${landscape ? "landscape" : "portrait"}; margin: 10mm;
        @top-left { content: ""; } @top-center { content: ""; } @top-right { content: ""; }
        @bottom-left { content: ""; }
        @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7pt sans-serif; color: #666; } }`}</style>

      <aside className="print-options">
        <fieldset>
          <legend className="field-label">Document</legend>
          {DOCS.map(([key, label, hint]) => (
            <label key={key} className="print-doc">
              <input
                type="radio"
                name="doc"
                checked={doc === key}
                onChange={() => {
                  setDoc(key);
                  setLandscape(key === "pinout" || key === "assembly"); // pinout del taller y diagrama, apaisados
                }}
              />
              <span>
                <span className="print-doc-name">{label}</span>
                <span className="hint">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {doc === "cut" && (
          <label className="print-field">
            <span className="field-label">Order within each connector</span>
            <select value={sort} onChange={(e) => setSort(e.currentTarget.value as CutSort)}>
              {CUT_SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        )}

        {doc === "assembly" && (
          <fieldset>
            <legend className="field-label">Drawing</legend>
            <label className="print-check">
              <input type="checkbox" checked={toScale} onChange={(e) => setToScale(e.currentTarget.checked)} /> To scale
            </label>
            <label className="print-check">
              <input type="checkbox" checked={showDistances} onChange={(e) => setShowDistances(e.currentTarget.checked)} disabled={mainNode === undefined} />
              Distance from the main connector
            </label>
          </fieldset>
        )}

        {doc === "pinout" && (
          <fieldset>
            <legend className="field-label">Connectors</legend>
            <div className="print-connector-actions">
              <button className="link-button" onClick={() => setSkipped(new Set())}>All</button>
              <button className="link-button" onClick={() => setSkipped(new Set(project.connector_instances.map((c) => c.id)))}>None</button>
            </div>
            <div className="print-connectors">
              {project.connector_instances.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={!skipped.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(skipped);
                      if (e.currentTarget.checked) next.delete(c.id);
                      else next.add(c.id);
                      setSkipped(next);
                    }}
                  />
                  <span className="print-cid">{c.short_id}</span> {c.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="print-paper">
          <label className="print-field">
            <span className="field-label">Paper</span>
            <select value={paper} onChange={(e) => setPaper(e.currentTarget.value as Paper)}>
              {Object.keys(PAPER_MM).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="print-field">
            <span className="field-label">Orientation</span>
            <select value={landscape ? "landscape" : "portrait"} onChange={(e) => setLandscape(e.currentTarget.value === "landscape")}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
        </div>

        <button className="button-primary" onClick={print} disabled={!data}>Print / Save as PDF…</button>
        {doc === "labels" && <button onClick={() => void exportLabels()}>Export CSV…</button>}
        {status && <p className="hint">{status}</p>}
      </aside>

      <div className="print-preview">{sheets}</div>
    </div>
  );
}

const GENDER_ES = { male: "macho", female: "hembra" } as const;

/** Un conector en la hoja de pinout: nombre, conector y vista ocupan todo el alto del bloque. */
function PinoutBlock({ first, project, library, connectorId, netOf }: {
  first: boolean;
  project: ProjectData;
  library: Library;
  connectorId: number;
  netOf: (wireId: number) => number[];
}) {
  const c = project.connector_instances.find((x) => x.id === connectorId)!;
  const def = library.connector_defs.find((d) => d.part_id === c.library_part_id);
  const rows = pinoutRows(project, library, c.id, netOf);
  const span = Math.max(rows.length, 1);
  // La vista ocupa el alto del bloque (~4,2 mm por renglón), sin estirar los renglones.
  const viewHeight = { "--view-h": `${Math.min(40, Math.max(12, span * 4.2))}mm` } as CSSProperties;
  // Sin vista lateral por ahora (decisión de Martin): solo la delantera.
  const views =
    c.status === "pending" ? (
      <td rowSpan={span} className="pinout-view pinout-pending">Falta pinout y conector — se envía después</td>
    ) : (
      <td rowSpan={span} className="pinout-view" style={viewHeight}>
        {def?.image_front ? (
          <img src={def.image_front} alt={`${c.short_id} front view`} />
        ) : (
          def && <ConnectorFaceView def={def} used={usedCavities(project, c)} fixedSide="front" />
        )}
      </td>
    );
  const head = (
    <td rowSpan={span} className="pinout-name">
      {c.name || c.short_id}
      <span className="pinout-id">{c.short_id}</span>
    </td>
  );
  const connectorCell = (
    <td rowSpan={span} className="pinout-connector">
      {def ? `${def.series ?? ""} ${def.cavities.length} vías ${GENDER_ES[def.gender]}`.trim() : ""}
      <span className="pinout-pn">{partLabel(library, c.library_part_id)}</span>
    </td>
  );
  return (
    <>
      {!first && (
        <tbody aria-hidden="true" className="pinout-gap"><tr><td colSpan={6} /></tr></tbody>
      )}
      {/* Un bloque que no entra en una hoja se corta entre hojas (App.css, .pinout-long). */}
      <tbody className={span > 35 ? "pinout-block pinout-long" : "pinout-block"}>
        {rows.length === 0 ? (
          <tr>{head}<td /><td /><td />{connectorCell}{views}</tr>
        ) : (
          rows.map((r, i) => (
            <tr key={r.pin + i}>
              {i === 0 && head}
              <td className="pinout-pin">{r.pin}</td>
              <td className={r.fn === "n/c" ? "pinout-nc" : undefined}>{r.fn}</td>
              <td>{r.goesTo}</td>
              {i === 0 && connectorCell}
              {i === 0 && views}
            </tr>
          ))
        )}
      </tbody>
    </>
  );
}

/** Lista de corte de coberturas (plan 8.1/9.2) y lo que va en cada punta. */
function CoveringSheet({ project, library, report }: { project: ProjectData; library: Library; report: CostReport }) {
  const rows = coveringRows(project, library, report.covering_cuts);
  const ends = terminationRows(project, library);
  return (
    <>
      <h4>Heat-shrink per segment</h4>
      {rows.length === 0 ? (
        <p className="hint">No segment carries wires yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Segment</th><th>Between</th><th>Heat-shrink</th>
              <th className="num">Segment (mm)</th><th className="num">− Legs</th><th className="num">+ Overlap</th><th className="num">Cut (mm)</th><th className="check" aria-label="Done">✓</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.segmentId}>
                <td className="strong">S{r.segmentId}</td><td>{r.between}</td>
                <td>{r.size}{r.part && ` · ${r.part}`}{r.suggested && " (suggested)"}</td>
                <td className="num">{r.segmentMm.toFixed(0)}</td><td className="num">{r.legsMm ? r.legsMm.toFixed(0) : ""}</td>
                <td className="num">{r.overlapMm ? r.overlapMm.toFixed(0) : ""}</td><td className="num strong">{r.cutMm.toFixed(0)}</td>
                <td className="check"><span className="tick-box" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ends.length > 0 && (
        <>
          <h4>Boots, T-molds and adhesive pieces</h4>
          <table>
            <thead><tr><th>Where</th><th>What</th><th>Part</th><th className="check" aria-label="Done">✓</th></tr></thead>
            <tbody>
              {ends.map(([where, what, part], i) => (
                <tr key={i}><td className="strong">{where}</td><td>{what}</td><td>{part}</td><td className="check"><span className="tick-box" /></td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function SheetHeader({ project, title }: { project: ProjectData; title: string }) {
  const p = project.project;
  return (
    <header className="sheet-header">
      <span><strong>{p.name}</strong>{p.harness_code && ` · ${p.harness_code}`}</span>
      <span className="sheet-title">{title}</span>
      <span>{[p.revision && `Rev ${p.revision}`, p.client, new Date().toISOString().slice(0, 10)].filter(Boolean).join(" · ")}</span>
    </header>
  );
}
