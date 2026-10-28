import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import Topology from "./screens/Topology";
import Diagram from "./screens/diagram/Diagram";
import Schematic from "./screens/Schematic";
import LibraryScreen from "./screens/library/Library";
import Connectors from "./screens/Connectors";
import Wires from "./screens/Wires";
import Splices from "./screens/Splices";
import Checks from "./screens/Checks";
import Costs from "./screens/Costs";
import Print from "./screens/Print";
import Tree from "./panels/TreePanel";
import Inspector from "./panels/Inspector";
import { CloseIcon, MaximizeIcon, MinimizeIcon, PanelIcon, RedoIcon, UndoIcon } from "./components/icons";
import { useBackedState } from "./platform/useBackedState";
import type { CalcResults } from "./model/calc";
import { reloadConnectorImages } from "./platform/connectorImages";
import type { Finding, HistoryStatus, ProjectData, ProjectStatus, Selection } from "./model/project";
import type { Library } from "./model/library";

/** Espejo de lib.rs LibraryChange: la biblioteca y, si el autoguardado falló, por qué. */
interface LibraryChange {
  library: Library;
  save_error: string | null;
}
import { emptyLibrary } from "./model/library";
import "./styles/index.css";

const SECTIONS = ["Library", "Topology", "Diagram", "Schematic", "Connectors", "Wires", "Splices", "Checks", "Costs", "Print"] as const;
type Section = (typeof SECTIONS)[number];

export default function App() {
  const [section, setSection] = useState<Section>("Topology");
  // Pestañas ya abiertas: quedan montadas (ocultas) para volver a donde estaban.
  const [visited, setVisited] = useState<Set<Section>>(() => new Set([section]));
  useEffect(() => setVisited((v) => (v.has(section) ? v : new Set(v).add(section))), [section]);

  const [selection, setSelection] = useState<Selection>(null);
  const [projectPath, setProjectPath] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>({ loaded: false, can_undo: false, can_redo: false, unsaved: false, revision: 0 });
  const refreshProjectStatus = useCallback(async () => {
    setProjectStatus(await invoke<ProjectStatus>("project_status"));
  }, []);
  const commitProject = useCallback(
    async (next: ProjectData | null) => {
      if (!next) return;
      await invoke("edit_project", { project: next });
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
      // Otro proyecto: los ids de la selección anterior no significan nada acá.
      setSelection(null);
    },
    [projectHistory, refreshProjectStatus],
  );
  const cancelProjectEdits = projectHistory.cancel;

  // Antes de cerrar o de reemplazar el proyecto (New, Open, Load sample): si
  // tiene cambios sin guardar, se pregunta. Devuelve si se puede seguir.
  const confirmDiscardProject = useCallback(async () => {
    await projectHistory.flush();
    const status = await invoke<ProjectStatus>("project_status");
    setProjectStatus(status);
    if (!status.unsaved) return true;
    return ask("The project has unsaved changes. Discard them?", { title: "Harness Designer", kind: "warning", okLabel: "Discard changes", cancelLabel: "Cancel" });
  }, [projectHistory]);

  // Aviso general en la barra de estado (ej. un cambio de la biblioteca que no se pudo guardar).
  const [appNotice, setAppNotice] = useState("");

  const [libraryPath, setLibraryPath] = useState("");
  const [libraryStatus, setLibraryStatus] = useState<HistoryStatus>({ can_undo: false, can_redo: false, revision: 0 });
  const refreshLibraryStatus = useCallback(async () => {
    setLibraryStatus(await invoke<HistoryStatus>("library_status"));
  }, []);
  // Cada cambio de la biblioteca se guarda solo en su archivo (backend,
  // autosave). Si no se pudo guardar, se avisa y se recuerda para preguntar al cerrar.
  const librarySaveFailed = useRef(false);
  const noteLibrarySave = useCallback((saveError: string | null) => {
    librarySaveFailed.current = saveError !== null;
    if (saveError) setAppNotice(saveError);
  }, []);
  const commitLibrary = useCallback(
    async (next: Library) => {
      noteLibrarySave(await invoke<string | null>("edit_library", { library: next }));
      await refreshLibraryStatus();
    },
    [refreshLibraryStatus, noteLibrarySave],
  );
  const libraryHistory = useBackedState<Library>(emptyLibrary(), commitLibrary);
  const library = libraryHistory.value;
  const setLibrary = libraryHistory.edit;
  const loadLibrary = useCallback(
    (next: Library) => {
      libraryHistory.reset(next);
      void refreshLibraryStatus();
      reloadConnectorImages().catch((e) => setAppNotice(`Couldn't read the connector photos: ${String(e)}`));
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
    const change = await invoke<LibraryChange>("undo_library");
    libraryHistory.reset(change.library);
    noteLibrarySave(change.save_error);
    await refreshLibraryStatus();
  }, [libraryHistory, refreshLibraryStatus, noteLibrarySave]);
  const redoLibrary = useCallback(async () => {
    await libraryHistory.flush();
    const change = await invoke<LibraryChange>("redo_library");
    libraryHistory.reset(change.library);
    noteLibrarySave(change.save_error);
    await refreshLibraryStatus();
  }, [libraryHistory, refreshLibraryStatus, noteLibrarySave]);

  // Si la ventana se recargó, el proyecto sigue en el núcleo: se recupera,
  // con su archivo, sin perder lo que no se había guardado.
  useEffect(() => {
    void invoke<{ project: ProjectData; path: string | null } | null>("current_project").then((current) => {
      if (!current) return;
      loadProject(current.project);
      setProjectPath(current.path ?? "");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Al abrir el programa: la última biblioteca usada (la primera vez, la que
  // trae el instalador). No hace falta cargarla a mano.
  useEffect(() => {
    void invoke<{ library: Library; path: string; notice: string | null }>("startup_library")
      .then(({ library: opened, path, notice }) => {
        loadLibrary(opened);
        setLibraryPath(path);
        if (notice) setAppNotice(notice);
      })
      .catch((err) => setAppNotice(`Couldn't open the library: ${err}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cerrar la ventana (botón o Alt+F4): la biblioteca termina de guardarse y,
  // si algo quedó sin guardar (el proyecto, o la biblioteca porque falló el
  // autoguardado), se pregunta. Se registra una sola vez; las funciones del
  // render actual se leen de una ref.
  const onClose = useRef(async () => true);
  onClose.current = async () => {
    await libraryHistory.flush();
    if (librarySaveFailed.current) {
      const discard = await ask("Library changes couldn't be saved to its file (see the message at the bottom). Close anyway and lose them?", {
        title: "Harness Designer",
        kind: "warning",
        okLabel: "Close anyway",
        cancelLabel: "Cancel",
      });
      if (!discard) return false;
    }
    return confirmDiscardProject();
  };
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await onClose.current())) event.preventDefault();
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // Costos y chequeos: un solo pedido por revisión del proyecto o de la
  // biblioteca (el backend los calcula con lo que ya tiene y los guarda), y
  // de acá van a cada pantalla. Así la barra de estado siempre refleja el dato
  // real, sin que nadie tenga que entrar a Checks.
  const [calc, setCalc] = useState<CalcResults | null>(null);
  useEffect(() => {
    if (!projectStatus.loaded) {
      setCalc(null);
      return;
    }
    let cancelled = false;
    invoke<CalcResults>("calc_results").then(
      (result) => {
        if (!cancelled) setCalc(result);
      },
      (e) => {
        if (!cancelled) setAppNotice(`Couldn't compute costs and checks: ${String(e)}`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectStatus.loaded, projectStatus.revision, libraryStatus.revision]);
  const findings = calc?.findings ?? NO_FINDINGS;
  const report = calc?.report ?? null;
  const gauges = calc?.gauges ?? null;
  const destinations = useMemo(() => new Map((calc?.destinations ?? []).map((d) => [d.cavity_assignment_id, d])), [calc]);

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

  const showPanels = section !== "Library" && section !== "Print";
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

          <Pane name="Library" active={section === "Library"} visited={visited}>
            <LibraryScreen
              library={library}
              setLibrary={setLibrary}
              loadLibrary={loadLibrary}
              cancelLibraryEdits={cancelLibraryEdits}
              flushLibraryEdits={libraryHistory.flush}
              filePath={libraryPath}
              setFilePath={setLibraryPath}
              project={project}
            />
          </Pane>
          <Pane name="Topology" active={section === "Topology"} visited={visited}>
            <Topology
              project={project}
              setProject={setProject}
              loadProject={loadProject}
              cancelProjectEdits={cancelProjectEdits}
              flushProjectEdits={projectHistory.flush}
              confirmDiscard={confirmDiscardProject}
              afterSave={refreshProjectStatus}
              filePath={projectPath}
              setFilePath={setProjectPath}
              library={library}
              selection={selection}
              onSelect={setSelection}
            />
          </Pane>
          <Pane name="Diagram" active={section === "Diagram"} visited={visited} canvas>
            <Diagram
              project={project}
              setProject={setProject}
              report={report}
              projectRevision={projectStatus.revision}
              library={library}
              findings={findings}
              selection={selection}
              onSelect={setSelection}
            />
          </Pane>
          <Pane name="Schematic" active={section === "Schematic"} visited={visited} canvas>
            <Schematic project={project} setProject={setProject} library={library} selection={selection} onSelect={setSelection} projectRevision={projectStatus.revision} gauges={gauges} />
          </Pane>
          <Pane name="Connectors" active={section === "Connectors"} visited={visited}>
            <Connectors project={project} setProject={setProject} library={library} selection={selection} onSelect={setSelection} report={report} destinations={destinations} gauges={gauges} />
          </Pane>
          <Pane name="Wires" active={section === "Wires"} visited={visited}>
            <Wires project={project} setProject={setProject} library={library} selection={selection} onSelect={setSelection} />
          </Pane>
          <Pane name="Splices" active={section === "Splices"} visited={visited}>
            <Splices project={project} setProject={setProject} library={library} selection={selection} onSelect={setSelection} />
          </Pane>
          <Pane name="Checks" active={section === "Checks"} visited={visited}>
            <Checks project={project} findings={findings} selection={selection} onSelect={setSelection} />
          </Pane>
          <Pane name="Costs" active={section === "Costs"} visited={visited}>
            <Costs project={project} library={library} selection={selection} onSelect={setSelection} report={report} />
          </Pane>
          <Pane name="Print" active={section === "Print"} visited={visited}>
            <Print project={project} setProject={setProject} library={library} report={report} destinations={destinations} projectRevision={projectStatus.revision} />
          </Pane>
        {showPanels && inspectorOpen && <Inspector project={project} setProject={setProject} library={library} selection={selection} onSelect={setSelection} findings={findings} report={report} projectRevision={projectStatus.revision} />}
      </div>

      <div className="status-bar">
        <span><span className="status-dot status-dot-error" />{errorCount} error{errorCount === 1 ? "" : "s"}</span>
        <span><span className="status-dot status-dot-warning" />{warningCount} warning{warningCount === 1 ? "" : "s"}</span>
        <span style={{ flex: 1 }} />
        {appNotice && (
          <button className="status-notice" onClick={() => setAppNotice("")} title="Click to dismiss">{appNotice}</button>
        )}
        {project ? (
          // Clic: los datos del arnés (nombre, código, márgenes) en el Inspector.
          <button
            className="status-project"
            onClick={() => {
              setSelection({ kind: "project", id: 0 });
              setInspectorOpen(true);
              if (section === "Library" || section === "Print") setSection("Topology");
            }}
            title={projectStatus.unsaved ? "Unsaved changes (Topology → Save) · click to edit the harness data" : "Click to edit the harness data"}
          >
            {[project.project.name, project.project.harness_code].filter(Boolean).join(" · ")}
            {projectStatus.unsaved && " •"}
          </button>
        ) : (
          <span>No project loaded</span>
        )}
      </div>
    </main>
  );
}

/**
 * Una pestaña. Al salir queda montada pero oculta, y sin re-renderizar mientras
 * no se ve (el memo la congela): al volver sigue donde estaba (scroll, conector
 * elegido, zoom del diagrama…) y se pone al día con el proyecto.
 */
const Pane = memo(
  function Pane({ name, active, visited, canvas, children }: { name: Section; active: boolean; visited: Set<Section>; canvas?: boolean; children: ReactNode }) {
    if (!active && !visited.has(name)) return null;
    return (
      <div className={`screen${canvas ? " screen-canvas" : ""}`} hidden={!active}>
        {children}
      </div>
    );
  },
  (prev, next) => !prev.active && !next.active && prev.visited.has(prev.name) === next.visited.has(next.name),
);

/** Lista vacía estable (sin proyecto), para no re-renderizar en cada vuelta. */
const NO_FINDINGS: Finding[] = [];
