# Abre la app en modo desarrollo con el puerto de depuración (CDP) en 9222, para
# poder manejarla con cdp.mjs / run.sh sin robarle el foco a nadie.
# Uso (desde PowerShell, queda como proceso aparte):
#   Start-Process powershell -WindowStyle Minimized -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','<ruta>\tools\cdp\launch.ps1'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
pnpm tauri dev *> "$env:TEMP\harness-designer-dev.log"
