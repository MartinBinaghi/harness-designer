import { useState } from "react";
import Topologia from "./Topologia";
import LibraryScreen from "./Library";
import Conectores from "./Conectores";
import Cables from "./Cables";
import Checks from "./Checks";
import Costs from "./Costs";
import type { ProjectData } from "./types";
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

  return (
    <main className="app">
      <h1>Harness Designer</h1>
      <nav className="tabs">
        {SECTIONS.map((s) => (
          <button key={s} onClick={() => setSection(s)} disabled={s === section}>{s}</button>
        ))}
      </nav>

      {section === "Library" && (
        <LibraryScreen library={library} setLibrary={setLibrary} filePath={libraryPath} setFilePath={setLibraryPath} />
      )}
      {section === "Topology" && (
        <Topologia project={project} setProject={setProject} filePath={projectPath} setFilePath={setProjectPath} library={library} />
      )}
      {section === "Connectors" && <Conectores project={project} setProject={setProject} library={library} />}
      {section === "Wires" && <Cables project={project} setProject={setProject} library={library} />}
      {section === "Checks" && <Checks project={project} library={library} />}
      {section === "Costs" && <Costs project={project} library={library} />}
    </main>
  );
}
