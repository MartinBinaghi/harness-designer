import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Velocidad del zoom con el pellizco del pad en el diagrama y el esquema (1 = la de React Flow, muy lenta).
const PINCH_ZOOM_SPEED = 3;

// El pellizco del pad llega como rueda con Ctrl (zoomHotkeysEnabled en tauri.conf.json lo
// habilita). En los lienzos se reenvía acelerado; afuera de ellos no agranda la ventana.
window.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey || !e.isTrusted) return;
    e.preventDefault();
    const target = e.target as Element;
    if (!target.closest(".react-flow")) return;
    e.stopPropagation();
    target.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaMode: e.deltaMode,
        deltaY: e.deltaY * PINCH_ZOOM_SPEED,
      }),
    );
  },
  { capture: true, passive: false },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
