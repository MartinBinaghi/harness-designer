#!/bin/sh
# Uso: ./run.sh "<cuerpo async JS>" [captura.png]  — expone __click(text) y sleep(ms)
cd "$(dirname "$0")"
node cdp.mjs eval "(async()=>{ $(cat click.js) const sleep=ms=>new Promise(r=>setTimeout(r,ms)); $1 })()"
[ -n "$2" ] && node cdp.mjs shot "$2"
