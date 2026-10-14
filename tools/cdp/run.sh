#!/bin/sh
# Uso: ./run.sh "<cuerpo async JS>" [captura.png]  — expone __click(text) y sleep(ms)
cd "$(dirname "$0")"
# examples/ del repo, con barras normales (lo usa loadex.js para abrir el ejemplo).
EXAMPLES="$(cd ../.. && (pwd -W 2>/dev/null || pwd))/examples/"
node cdp.mjs eval "(async()=>{ window.__examples='$EXAMPLES'; $(cat click.js) const sleep=ms=>new Promise(r=>setTimeout(r,ms)); $1 })()"
[ -n "$2" ] && node cdp.mjs shot "$2"
