import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectData } from "../model/project";
import { partLabel, type Library } from "../model/library";
import type { CostReport, PinDestinations } from "../model/calc";
import { assemblyBranches, connectorHeatShrink, coveringRows, cutListGroups, cutListRows, cutPairGroups, labelRows, mergeCutRows, paginatePinout, pinoutRows, pinoutViewMm, terminationRows, toCsv, wireTotals, type CutGrouping, type CutSort } from "../logic/sheets";
import { ConnectorFaceView, MIL } from "../components/ConnectorFaceView";
import { connectorFace } from "../logic/connectorFace";
import { useConnectorImage } from "../platform/connectorImages";
import { usedCavities } from "../logic/projectEdit";
import { AssemblyOverview, BranchFan, branchesWithSheet, WholeHarness } from "../components/AssemblyBranches";
import { fileName, pickFileToSave } from "../platform/fileDialogs";

/**
 * Etapa 6: hojas para imprimir o guardar como PDF (diálogo de impresión del
 * sistema) y exportaciones. La vista previa son las mismas hojas que salen
 * impresas; el resto de la ventana se oculta al imprimir (styles, @media print).
 */

type Doc = "cut" | "pinout" | "assembly" | "labels";
const DOCS: [Doc, string, string][] = [
  ["cut", "Cut list", "One row per wire, divided by connector, with metres per wire type, heat-shrink pieces and boots."],
  ["pinout", "Pinout sheets", "Workshop format: one block per connector with its pins, where each one ends, and its front view."],
  ["assembly", "Assembly drawing", "The harness diagram with its lengths, for the table: fitted to one sheet (A3 for big harnesses)."],
  ["labels", "Label list", "Harness, connectors and labelled wires, for the label printer."],
];
const CUT_GROUPINGS: [CutGrouping, string][] = [
  ["connector", "Connector"],
  ["pair", "Connector to connector (X1 ↔ X3)"],
];
const CUT_SORTS: [CutSort, string][] = [
  ["pin", "Pin"],
  ["type", "Wire type and color (cut from the same reel)"],
  ["length", "Length"],
];
const PAPER_MM = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] } as const;
type Paper = keyof typeof PAPER_MM;

interface Props {
  project: ProjectData | null;
  setProject: (p: ProjectData) => void;
  library: Library;
  /** Costos de la revisión actual, o null mientras se calculan. */
  report: CostReport | null;
  /** "Termina en" de cada vía con cable (por id de vía), calculado por el núcleo. */
  destinations: Map<number, PinDestinations>;
  /** Revisión del proyecto en el backend: las distancias se rehacen cuando cambia. */
  projectRevision: number;
}

/** Redondeo del largo de corte, siempre hacia arriba (se guarda en el proyecto). */
const CUT_ROUNDING: [number | null, string][] = [
  [null, "No rounding"],
  [5, "Up to 5 mm"],
  [10, "Up to 10 mm"],
  [50, "Up to 50 mm"],
  [100, "Up to 100 mm"],
];

export default function Print({ project, setProject, library, report, destinations, projectRevision }: Props) {
  const [doc, setDoc] = useState<Doc>("cut");
  const [sort, setSort] = useState<CutSort>("pin");
  const [grouping, setGrouping] = useState<CutGrouping>("connector");
  const [hideNames, setHideNames] = useState(false);
  const [paper, setPaper] = useState<Paper>("A4");
  const [landscape, setLandscape] = useState(false);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState("");
  // Por breakouts (vista general + una hoja por breakout, como la hoja a mano del taller) o todo el dibujo en una hoja.
  const [assemblyLayout, setAssemblyLayout] = useState<"branches" | "whole">("branches");
  const [showDistances, setShowDistances] = useState(true);
  const [distances, setDistances] = useState<Record<string, number> | null>(null);


  // Distancia acumulada desde el conector principal (hoja de armado, plan 10.2).
  const mainNode = project?.connector_instances.find((c) => c.id === project.project.main_connector_instance_id)?.node_id;
  useEffect(() => {
    if (!projectRevision || mainNode === undefined || !showDistances) return setDistances(null);
    let cancelled = false;
    void invoke<Record<string, number>>("node_distances", { fromNodeId: mainNode }).then((d) => {
      if (!cancelled) setDistances(d);
    });
    return () => {
      cancelled = true;
    };
  }, [projectRevision, mainNode, showDistances]);

  const data = report ? { report } : null;

  if (!project) return <p>Open or load a project first (Topology tab).</p>;

  const [w, h] = PAPER_MM[paper];
  const sheetWidth = `${landscape ? h : w}mm`;
  const destinationOf = (cavityId: number) => destinations.get(cavityId);

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
    const rows = cutListRows(project, library, data.report.cut_list, data.report.cable_cut_list, sort);
    sheets = (
      <section className="sheet" style={{ width: sheetWidth }}>
        <SheetHeader project={project} title="Cut list" />
        <table>
          <thead>
            {hideNames ? (
              <tr><th>Type</th><th>Color</th><th>Twist</th><th className="num">Cut (mm)</th><th className="num">Qty</th><th className="check" aria-label="Done">✓</th></tr>
            ) : (
              <tr>
                <th>Wire</th><th>Function</th><th>Type</th><th>Color</th><th>From</th><th>To</th><th>Twist</th>
                <th className="num">Route (mm)</th><th className="num">Margin</th><th className="num">Cut (mm)</th><th className="check" aria-label="Done">✓</th>
              </tr>
            )}
          </thead>
          {/* Dividida por conector, o por los dos puntos que une cada cable (cada cable una sola vez), para no perderse en la mesa. */}
          {(grouping === "pair" ? cutPairGroups(project, rows, destinationOf) : cutListGroups(project, rows)).map((g) => (
            <tbody key={g.key} className="cut-group">
              <tr className="cut-group-title">
                <td colSpan={hideNames ? 6 : 11}>
                  {g.title}
                  <span className="cut-group-count">{g.rows.length} wire{g.rows.length === 1 ? "" : "s"}</span>
                  {g.connectorId !== null && (
                    <span className="cut-group-hs">
                      Heat-shrink: {connectorHeatShrink(project, library, g.connectorId, data.report.segment_diameters).join(" / ") || "—"}
                    </span>
                  )}
                </td>
              </tr>
              {/* Sin nombres: los cables iguales (tipo, color, largo, trenzado) en un renglón con la cantidad. */}
              {hideNames && mergeCutRows(g.rows).map((m) => (
                <tr key={m.ids[0]} title={m.ids.join(", ")}>
                  <td>{m.wireType}</td><td>{m.color}</td><td>{m.twist ?? ""}</td>
                  <td className="num strong">{m.cutMm.toFixed(0)}</td><td className="num strong">× {m.count}</td><td className="check"><span className="tick-box" /></td>
                </tr>
              ))}
              {!hideNames && g.rows.map((r) => (
                <Fragment key={r.wireId}>
                  <tr>
                    <td className="strong">{r.id}</td><td>{r.fn}</td><td>{r.wireType}</td><td>{r.color}</td><td>{r.from}</td><td>{r.to}</td><td>{r.twist ?? ""}</td>
                    <td className="num">{r.withTwistMm.toFixed(0)}</td><td className="num">{r.manual ? "by hand" : `${r.marginPct.toFixed(0)}%`}</td>
                    <td className="num strong">{r.cutMm.toFixed(0)}</td><td className="check"><span className="tick-box" /></td>
                  </tr>
                  {/* Conductores de un cable comprado: se cortan con él, sin largo propio. */}
                  {r.conductors.map((c) => (
                    <tr key={c.wireId} className="cut-conductor">
                      <td>{c.id}</td><td>{c.fn}</td><td></td><td>{c.color}</td><td>{c.from}</td><td>{c.to}</td><td colSpan={5}></td>
                    </tr>
                  ))}
                </Fragment>
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
    // Formato de las planillas de pinout del taller:
    // una tabla apaisada, un bloque por conector, encabezados en castellano.
    // Al final, una hoja por conector grande con sus vistas en grande (en la
    // columna no se leen los números; Martin las prefiere todas al final).
    const shown = project.connector_instances.filter((c) => !skipped.has(c.id));
    // Un bloque que no entra se parte en tramos, y cada uno repite nombre,
    // conector y vista (Martin: en el PDF quedaban solo arriba de la primera).
    const chunks = paginatePinout(
      shown.map((c) => ({
        rows: pinoutRows(project, library, c.id, destinationOf),
        // Notas debajo del dibujo: "vistas en grande" y la de pendiente.
        extraMm: (bigConnector(library, c.library_part_id) ? 3 : 0) + (c.status === "pending" ? 5 : 0),
      })),
      { pageMm: (landscape ? w : h) - PINOUT_PAGE_LOSS_MM, titleMm: PINOUT_TITLE_MM, gapMm: PINOUT_GAP_MM, charsPerLine: landscape ? 60 : 42 },
    );
    sheets = (
      <>
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
            {chunks.map((ch, i) => (
              <PinoutChunk key={i} gap={i > 0 && !ch.newPage} newPage={ch.newPage} cont={ch.cont} project={project} library={library} connectorId={shown[ch.block].id} rows={ch.rows} />
            ))}
          </table>
        </section>
        {shown.map((c) => {
          const def = bigConnector(library, c.library_part_id);
          return (
            def && (
              <section key={c.id} className="sheet" style={{ width: sheetWidth }}>
                <SheetHeader project={project} title={`Pinout · ${c.name || c.short_id} (${c.short_id}) · vistas`} />
                <div className="pinout-views">
                  {(["front", "rear"] as const).map((side) => (
                    <figure key={side}>
                      <figcaption>{side === "front" ? "Vista delantera (lado de acople)" : "Vista trasera (lado cables)"}</figcaption>
                      <ConnectorFaceView def={def} used={usedCavities(project, c)} fixedSide={side} />
                    </figure>
                  ))}
                </div>
                <p className="pinout-views-note">Resaltadas: las vías con cable.</p>
              </section>
            )
          );
        })}
      </>
    );
  } else if (doc === "assembly" && assemblyLayout === "branches") {
    const branches = assemblyBranches(project, library, data.report.segment_diameters);
    // Alto de la hoja menos márgenes (10 mm × 2) y encabezado.
    const pageMm = (landscape ? w : h) - 38;
    sheets = (
      <>
        <section className="sheet" style={{ width: sheetWidth }}>
          <SheetHeader project={project} title="Assembly · overview" />
          <AssemblyOverview project={project} branches={branches} distances={distances} maxHeightMm={pageMm} />
        </section>
        {branchesWithSheet(branches).map((b) => (
          <section key={b.num} className="sheet" style={{ width: sheetWidth }}>
            <SheetHeader project={project} title={b.num === 0 ? "Assembly · main connector" : `Assembly · breakout ${b.num}`} />
            <BranchFan project={project} library={library} branch={b} distances={distances} maxHeightMm={pageMm} />
          </section>
        ))}
      </>
    );
  } else if (doc === "assembly") {
    sheets = (
      <section className="sheet" style={{ width: sheetWidth }}>
        <SheetHeader project={project} title="Assembly drawing" />
        {/* Alto de la hoja menos márgenes (10 mm × 2) y encabezado: el dibujo entra en una sola hoja. */}
        <WholeHarness project={project} library={library} branches={assemblyBranches(project, library, data.report.segment_diameters)} distances={distances} maxHeightMm={(landscape ? w : h) - 38} />
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
            <span className="field-label">Group by</span>
            <select value={grouping} onChange={(e) => setGrouping(e.currentTarget.value as CutGrouping)}>
              {CUT_GROUPINGS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        )}
        {doc === "cut" && (
          <label className="print-field">
            <span className="field-label">Order within each group</span>
            <select value={sort} onChange={(e) => setSort(e.currentTarget.value as CutSort)}>
              {CUT_SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        )}
        {doc === "cut" && (
          <label className="print-check" title="Identical wires (type, color, cut length, twist) in one row with the quantity">
            <input type="checkbox" checked={hideNames} onChange={(e) => setHideNames(e.currentTarget.checked)} /> Hide names (count identical wires)
          </label>
        )}
        {doc === "cut" && project && (
          <label className="print-field">
            <span className="field-label">Round cut lengths</span>
            <select
              value={project.project.cut_round_mm ?? ""}
              onChange={(e) => setProject({ ...project, project: { ...project.project, cut_round_mm: e.currentTarget.value ? Number(e.currentTarget.value) : null } })}
              title="Always rounded up, so no wire comes out short. Lengths set by hand aren't rounded."
            >
              {CUT_ROUNDING.map(([mm, label]) => <option key={label} value={mm ?? ""}>{label}</option>)}
            </select>
          </label>
        )}

        {doc === "assembly" && (
          <fieldset>
            <legend className="field-label">Drawing</legend>
            <label className="print-field">
              <select value={assemblyLayout} onChange={(e) => setAssemblyLayout(e.currentTarget.value as "branches" | "whole")}>
                <option value="branches">Overview + one sheet per breakout</option>
                <option value="whole">Whole harness on one sheet</option>
              </select>
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

/**
 * Medidas de la hoja de pinout impresa para partir los bloques (medidas en un
 * PDF de Martin, A4 apaisada): del alto del papel se van los márgenes (10 mm
 * arriba y abajo), el encabezado de la tabla que se repite en cada hoja
 * (7,4 mm) y 1,6 mm de resguardo; en la primera hoja, además, el título; antes
 * de un conector que no es el primero, el espacio que lo separa.
 */
const PINOUT_PAGE_LOSS_MM = 29;
const PINOUT_TITLE_MM = 9;
const PINOUT_GAP_MM = 3.5;

/**
 * Desde cuántas vías la cara dibujada va además en una hoja aparte, en grande
 * (Martin: en la columna no se leían los números de la ECU, el interco y el motor).
 */
const BIG_CONNECTOR_WAYS = 25;
const bigConnector = (library: Library, partId: number) => {
  const def = library.connector_defs.find((d) => d.part_id === partId);
  return def && def.cavities.length >= BIG_CONNECTOR_WAYS && connectorFace(def, MIL) ? def : undefined;
};

/** Un tramo de un conector en la hoja de pinout: nombre, conector y vista ocupan todo su alto. */
function PinoutChunk({ gap, newPage, cont, project, library, connectorId, rows }: {
  /** Va a continuación del tramo anterior, separado por un espacio. */
  gap: boolean;
  newPage: boolean;
  cont: boolean;
  project: ProjectData;
  library: Library;
  connectorId: number;
  rows: ReturnType<typeof pinoutRows>;
}) {
  const c = project.connector_instances.find((x) => x.id === connectorId)!;
  const def = library.connector_defs.find((d) => d.part_id === c.library_part_id);
  const photo = useConnectorImage(def?.part_id, "front");
  const span = Math.max(rows.length, 1);
  // La vista ocupa el alto del bloque (~4,2 mm por renglón), sin estirar los renglones.
  const viewHeight = { "--view-h": `${pinoutViewMm(span)}mm` } as CSSProperties;
  // Sin vista lateral por ahora (decisión de Martin): solo la delantera.
  // Un conector pendiente igual lleva su dibujo si se sabe la pieza; la nota va debajo.
  const views = (
    <td rowSpan={span} className={`pinout-view${c.status === "pending" ? " pinout-pending" : ""}`} style={viewHeight}>
      {photo ? (
        <img src={photo} alt={`${c.short_id} front view`} />
      ) : (
        def && <ConnectorFaceView def={def} used={usedCavities(project, c)} fixedSide="front" />
      )}
      {bigConnector(library, c.library_part_id) && <div className="pinout-views-ref">vistas en grande: al final</div>}
      {c.status === "pending" && <div className="pinout-pending-note">Falta pinout y conector — se envía después</div>}
    </td>
  );
  const head = (
    <td rowSpan={span} className="pinout-name">
      {c.name || c.short_id}
      <span className="pinout-id">{c.short_id}{cont ? " (cont.)" : ""}</span>
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
      {gap && (
        <tbody aria-hidden="true" className="pinout-gap"><tr><td colSpan={6} /></tr></tbody>
      )}
      <tbody className={newPage ? "pinout-block pinout-new-page" : "pinout-block"}>
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
