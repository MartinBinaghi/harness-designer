import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { findUpdate, installedVersion, installUpdate, type Update } from "../platform/updates";

type State = { kind: "idle" } | { kind: "checking" } | { kind: "current" } | { kind: "error"; message: string } | { kind: "installing"; percent: number | null };

/**
 * Versión instalada, en la barra de estado. Al abrir se busca sola si hay una
 * nueva (sin internet no pasa nada); clic en la versión, se busca a mano. Si
 * hay una, el botón la ofrece; instalarla pasa antes por `beforeInstall`
 * (cambios sin guardar del proyecto).
 */
export function UpdateStatus({ beforeInstall }: { beforeInstall: () => Promise<boolean> }) {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    void installedVersion().then(setVersion);
    findUpdate().then(setUpdate, () => {}); // sin internet o sin release: se sigue igual
  }, []);

  async function checkNow() {
    setState({ kind: "checking" });
    try {
      const found = await findUpdate();
      setUpdate(found);
      setState(found ? { kind: "idle" } : { kind: "current" });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }

  async function install(found: Update) {
    const go = await ask(`Install Harness Designer ${found.version}? The program closes, updates and opens again. Your library and projects are kept.`, {
      title: "Harness Designer",
      kind: "info",
      okLabel: "Install",
      cancelLabel: "Not now",
    });
    if (!go || !(await beforeInstall())) return;
    setState({ kind: "installing", percent: null });
    try {
      await installUpdate(found, (percent) => setState({ kind: "installing", percent }));
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }

  if (state.kind === "installing") {
    return <span className="status-version">Downloading {update?.version}{state.percent !== null ? ` · ${state.percent}%` : "…"}</span>;
  }
  if (update) {
    return (
      <button className="status-update" onClick={() => void install(update)} title={update.body ?? undefined}>
        Update to {update.version}
      </button>
    );
  }
  const note = state.kind === "checking" ? " · checking…" : state.kind === "current" ? " · up to date" : state.kind === "error" ? " · couldn't check" : "";
  return (
    <button className="status-version" onClick={() => void checkNow()} title={state.kind === "error" ? state.message : "Check for updates"}>
      Harness Designer {version}
      {note}
    </button>
  );
}
