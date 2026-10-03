import { useCallback, useEffect, useState } from "react";
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
import { CloseIcon, MaximizeIcon, MinimizeIcon, PanelIcon, RedoIcon, UndoIcon } from "./icons";
import { useBackedState } from "./useBackedState";
import type { Finding, HistoryStatus, ProjectData, ProjectStatus, Selection } from "./types";
import type { Library } from "./libraryTypes";
import { emptyLibrary } from "./libraryTypes";
import "./App.css";

const SECTIONS = ["Library", "Topology", "Connectors", "Wires", "Checks", "Costs"] as const;
type Section = (typeof SECTIONS)[number];

export default function App() {
  const [section, setSection] = useState<Section>("Topology");

  const [projectPath, setProjectPath] = useState("project.harness.db");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>({ loaded: false, can_undo: false, can_redo: false });
  const refreshProjectStatus = useCallback(async () => {
    setProjectStatus(await invoke<ProjectStatus>("project_status"));
  }, []);
  const commitProject = useCallback(
    async (next: ProjectData | null) => {
      if (!next) return;
      await invoke<ProjectData>("edit_project", { project: next });
      await refreshProjectStatus();
    },
    [refreshProjectStatus],
  );
  const projectHistory = useBackedState<ProjectData | null>(null, commitProject);
  const project = projectHistory.value;
  const setProject = projectHistory.edit;
  // El backend ya tiene el estado nuevo cuando esto se llama (después de
  // open_project/demo_project): solo hace falta refrescar el espejo local y
  // el estado del historial, sin pasar por un commit (ver useBackedState.ts).
  const loadProject = useCallback(
    (next: ProjectData) => {
      projectHistory.reset(next);
      void refreshProjectStatus();
    },
    [projectHistory, refreshProjectStatus],
  );
  const cancelProjectEdits = projectHistory.cancel;

  const [libraryPath, setLibraryPath] = useState("library.db");
  const [libraryStatus, setLibraryStatus] = useState<HistoryStatus>({ can_undo: false, can_redo: false });
  const refreshLibraryStatus = useCallback(async () => {
    setLibraryStatus(await invoke<HistoryStatus>("library_status"));
  }, []);
  const commitLibrary = useCallback(
    async (next: Library) => {
      await invoke<Library>("edit_library", { library: next });
      await refreshLibraryStatus();
    },
    [refreshLibraryStatus],
  );
  const libraryHistory = useBackedState<Library>(emptyLibrary(), commitLibrary);
  const library = libraryHistory.value;
  const setLibrary = libraryHistory.edit;
  const loadLibrary = useCallback(
    (next: Library) => {
      libraryHistory.reset(next);
      void refreshLibraryStatus();
    },
    [libraryHistory, refreshLibraryStatus],
  );
  const cancelLibraryEdits = libraryHistory.cancel;

  const undoProject = useCallback(async () => {
    await projectHistory.flush();
    const data = await invoke<ProjectData>("undo_project");
    projectHistory.reset(data);
    await refreshProjectStatus();
  }, [projectHistory, refreshProjectStatus]);
  const redoProject = useCallback(async () => {
    await projectHistory.flush();
    const data = await invoke<ProjectData>("redo_project");
    projectHistory.reset(data);
    await refreshProjectStatus();
  }, [projectHistory, refreshProjectStatus]);
  const undoLibrary = useCallback(async () => {
    await libraryHistory.flush();
    const data = await invoke<Library>("undo_library");
    libraryHistory.reset(data);
    await refreshLibraryStatus();
  }, [libraryHistory, refreshLibraryStatus]);
  const redoLibrary = useCallback(async () => {
    await libraryHistory.flush();
    const data = await invoke<Library>("redo_library");
    libraryHistory.reset(data);
    await refreshLibraryStatus();
  }, [libraryHistory, refreshLibraryStatus]);

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

  // Undo/Redo por teclado, apuntando al documento de la pantalla activa (el
  // proyecto en Topology/Connectors/Wires/Costs, la biblioteca en Library).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      const [undo, redo] = section === "Library" ? [undoLibrary, redoLibrary] : [undoProject, redoProject];
      if (e.shiftKey) void redo();
      else void undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [section, undoProject, redoProject, undoLibrary, redoLibrary]);

  // Paneles laterales ocultables; la preferencia se recuerda entre sesiones.
  const [treeOpen, setTreeOpen] = useState(() => localStorage.getItem("treeOpen") !== "false");
  const [inspectorOpen, setInspectorOpen] = useState(() => localStorage.getItem("inspectorOpen") !== "false");
  useEffect(() => {
    localStorage.setItem("treeOpen", String(treeOpen));
    localStorage.setItem("inspectorOpen", String(inspectorOpen));
  }, [treeOpen, inspectorOpen]);

  const showPanels = section !== "Library";
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const canUndo = section === "Library" ? libraryStatus.can_undo : projectStatus.can_undo;
  const canRedo = section === "Library" ? libraryStatus.can_redo : projectStatus.can_redo;
  const onUndo = section === "Library" ? undoLibrary : undoProject;
  const onRedo = section === "Library" ? redoLibrary : redoProject;

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
        <span style={{ flex: 1 }} />
        {showPanels && (
          <>
            <button
              className="icon-button"
              onClick={() => setTreeOpen(!treeOpen)}
              aria-pressed={treeOpen}
              title={treeOpen ? "Hide tree panel" : "Show tree panel"}
              aria-label="Toggle tree panel"
            >
              <PanelIcon side="left" />
            </button>
            <button
              className="icon-button"
              onClick={() => setInspectorOpen(!inspectorOpen)}
              aria-pressed={inspectorOpen}
              title={inspectorOpen ? "Hide inspector" : "Show inspector"}
              aria-label="Toggle inspector"
            >
              <PanelIcon side="right" />
            </button>
            <span className="tabs-divider" />
          </>
        )}
        <button className="icon-button" onClick={() => void onUndo()} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <UndoIcon />
        </button>
        <button className="icon-button" onClick={() => void onRedo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <RedoIcon />
        </button>
      </nav>

      <div className="shell">
        {showPanels && treeOpen && <Tree project={project} selection={selection} onSelect={setSelection} />}

        <div className="screen">
          {section === "Library" && (
            <LibraryScreen
              library={library}
              setLibrary={setLibrary}
              loadLibrary={loadLibrary}
              cancelLibraryEdits={cancelLibraryEdits}
              flushLibraryEdits={libraryHistory.flush}
              filePath={libraryPath}
              setFilePath={setLibraryPath}
            />
          )}
          {section === "Topology" && (
            <Topologia
              project={project}
              setProject={setProject}
              loadProject={loadProject}
              cancelProjectEdits={cancelProjectEdits}
              flushProjectEdits={projectHistory.flush}
              filePath={projectPath}
              setFilePath={setProjectPath}
              library={library}
              selection={selection}
              onSelect={setSelection}
            />
          )}
          {section === "Connectors" && (
            <Conectores project={project} setProject={setProject} library={library} selection={selection} onSelect={setSelection} />
          )}
          {section === "Wires" && (
            <Cables project={project} setProject={setProject} library={library} selection={selection} onSelect={setSelection} />
          )}
          {section === "Checks" && <Checks project={project} findings={findings} selection={selection} onSelect={setSelection} />}
          {section === "Costs" && (
            <Costs project={project} library={library} selection={selection} onSelect={setSelection} />
          )}
        </div>

        {showPanels && inspectorOpen && <Inspector project={project} library={library} selection={selection} />}
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
