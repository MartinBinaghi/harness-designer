import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Topologia from "./Topologia";
import LibraryScreen from "./Library";
import Conectores from "./Conectores";
import Cables from "./Cables";
import Checks from "./Checks";
import Costs from "./Costs";
import Tree from "./TreePanel";
import Inspector from "./Inspector";
import { CloseIcon, MaximizeIcon, MinimizeIcon } from "./icons";
import type { Finding, ProjectData, Selection } from "./types";
import type { Library } from "./libraryTypes";
import { emptyLibrary } from "./libraryTypes";
import "./App.css";

const SECTIONS = ["Library", "Topology", "Connectors", "Wires", "Checks", "Costs"] as const;
type Section = (typeof SECTIONS)[number];

export default function App() {
  const [section, setSection] = useState<Section>("Topology");

  const [projectPath, setProjectPath] = useState("project.harness.db");
  const [project, setProject] = useState<ProjectData | null>(null);

  const [libraryPath, setLibraryPath] = useState("library.db");
  const [library, setLibrary] = useState<Library>(emptyLibrary());

  const [selection, setSelection] = useState<Selection>(null);
  const [findings, setFindings] = useState<Finding[]>([]);

  // Chequeos en vivo: se recalculan solos cada vez que cambia el proyecto o
  // la biblioteca, para que la barra de estado siempre refleje el dato real
  // (no depende de que alguien entre a la pantalla de Checks y la corra a mano).
  useEffect(() => {
    if (!project) {
      setFindings([]);
      return;
    }
    let cancelled = false;
    invoke<Finding[]>("run_checks", { project, library }).then((result) => {
      if (!cancelled) setFindings(result);
    });
    return () => {
      cancelled = true;
    };
  }, [project, library]);

  const showPanels = section !== "Library";
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  const appWindow = getCurrentWindow();

  return (
    <main className="app">
      {/* La ventana corre sin decoración nativa (tauri.conf.json): esta es
          la única barra de título, arrastrable, con sus propios controles. */}
      <div className="app-header" data-tauri-drag-region>
        <span className="app-logo">H</span>
        Harness Designer
        <span style={{ flex: 1 }} data-tauri-drag-region />
        <button className="window-button" onClick={() => appWindow.minimize()} title="Minimize" aria-label="Minimize window">
          <MinimizeIcon />
        </button>
        <button className="window-button" onClick={() => appWindow.toggleMaximize()} title="Maximize" aria-label="Maximize window">
          <MaximizeIcon />
        </button>
        <button className="window-button window-button-close" onClick={() => appWindow.close()} title="Close" aria-label="Close window">
          <CloseIcon />
        </button>
      </div>

      <nav className="tabs">
        {SECTIONS.map((s) => (
          <button key={s} onClick={() => setSection(s)} disabled={s === section}>{s}</button>
        ))}
      </nav>

      <div className="shell">
        {showPanels && <Tree project={project} selection={selection} onSelect={setSelection} />}

        <div className="screen">
          {section === "Library" && (
            <LibraryScreen library={library} setLibrary={setLibrary} filePath={libraryPath} setFilePath={setLibraryPath} />
          )}
          {section === "Topology" && (
            <Topologia
              project={project}
              setProject={setProject}
              filePath={projectPath}
              setFilePath={setProjectPath}
              library={library}
              selection={selection}
              onSelect={setSelection}
            />
          )}
          {section === "Connectors" && <Conectores project={project} setProject={setProject} library={library} />}
          {section === "Wires" && (
            <Cables project={project} setProject={setProject} library={library} selection={selection} onSelect={setSelection} />
          )}
          {section === "Checks" && <Checks project={project} findings={findings} />}
          {section === "Costs" && (
            <Costs project={project} library={library} selection={selection} onSelect={setSelection} />
          )}
        </div>

        {showPanels && <Inspector project={project} library={library} selection={selection} />}
      </div>

      <div className="status-bar">
        <span><span className="status-dot status-dot-error" />{errorCount} error{errorCount === 1 ? "" : "s"}</span>
        <span><span className="status-dot status-dot-warning" />{warningCount} warning{warningCount === 1 ? "" : "s"}</span>
        <span style={{ flex: 1 }} />
        <span>{project ? `${project.project.name} · ${project.project.harness_code}` : "No project loaded"}</span>
      </div>
    </main>
  );
}
