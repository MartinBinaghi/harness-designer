// Carga el ejemplo del motor sin diálogo: invoke directo + la función loadX que la pantalla recibe por props.
const ex = window.__examples; // ruta absoluta de examples/, la pone run.sh
const inv = window.__TAURI_INTERNALS__.invoke;
const findProp = (name) => { for (const el of document.querySelectorAll('*')) { const k = Object.keys(el).find(k => k.startsWith('__reactFiber$')); if (!k) continue; let f = el[k]; while (f) { if (f.memoizedProps && typeof f.memoizedProps[name] === 'function') return f.memoizedProps[name]; f = f.return; } } return null; };
__click('Library'); await sleep(400);
findProp('loadLibrary')(await inv('open_library', { path: ex + 'engine-demo-library.db' })); await sleep(300);
__click('Topology'); await sleep(400);
findProp('loadProject')(await inv('open_project', { path: ex + 'engine-demo.harness.db' })); await sleep(500);
