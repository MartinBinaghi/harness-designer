// Driver mínimo por CDP para WebView2 (sin Playwright). Uso:
//   node cdp.mjs eval "<js>"       -> Runtime.evaluate, imprime el resultado
//   node cdp.mjs shot <archivo>    -> Page.captureScreenshot a PNG
const targets = await (await fetch("http://localhost:9222/json")).json();
const target = targets.find((t) => t.type === "page") ?? targets[0];
if (!target) throw new Error("no CDP targets");

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

const [, , cmd, arg] = process.argv;

if (cmd === "eval") {
  const result = await send("Runtime.evaluate", { expression: arg, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(result.result?.value ?? result, null, 2));
} else if (cmd === "shot") {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const fs = await import("node:fs");
  fs.writeFileSync(arg, Buffer.from(data, "base64"));
  console.log("saved", arg);
} else if (cmd === "clip") {
  // node cdp.mjs clip x,y,w,h,scale archivo.png — captura ampliada de una zona
  const [x, y, width, height, scale] = arg.split(",").map(Number);
  const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x, y, width, height, scale } });
  const fs = await import("node:fs");
  fs.writeFileSync(process.argv[4], Buffer.from(data, "base64"));
  console.log("saved", process.argv[4]);
} else if (cmd === "upload") {
  // node cdp.mjs upload <selector CSS> <archivo> — carga un archivo en un <input type=file>
  const { root } = await send("DOM.getDocument", {});
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: arg });
  await send("DOM.setFileInputFiles", { nodeId, files: [process.argv[4]] });
  console.log("uploaded", process.argv[4]);
} else if (cmd === "drag") {
  // node cdp.mjs drag x1,y1,x2,y2 — arrastre real con el mouse, en pasos.
  const [x1, y1, x2, y2] = arg.split(",").map(Number);
  const mouse = (type, x, y, buttons) =>
    send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
  await mouse("mousePressed", x1, y1, 1);
  for (let i = 1; i <= 10; i++) await mouse("mouseMoved", x1 + ((x2 - x1) * i) / 10, y1 + ((y2 - y1) * i) / 10, 1);
  await mouse("mouseReleased", x2, y2, 0);
  console.log("dragged");
} else if (cmd === "wheel") {
  // node cdp.mjs wheel x,y,dy — rueda del mouse (ej. bajar en la vista previa de impresión)
  const [x, y, dy] = arg.split(",").map(Number);
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy });
  console.log("wheel");
} else if (cmd === "key") {
  // node cdp.mjs key Escape — una tecla (ej. cerrar la vista previa de impresión)
  const k = { key: arg, code: arg, windowsVirtualKeyCode: arg === "Escape" ? 27 : 0 };
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
  console.log("key", arg);
} else {
  console.error("usage: node cdp.mjs eval|shot <arg>");
  process.exit(1);
}

ws.close();
