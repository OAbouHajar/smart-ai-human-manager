$ErrorActionPreference = "Stop"
$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\CopilotSessionHub"
$StartupScript = Join-Path ([Environment]::GetFolderPath("Startup")) "Copilot Session Hub.cmd"

try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:43120/api/shutdown" -TimeoutSec 2 | Out-Null
} catch {
}

if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $InstallRoot "scripts\provider-hooks.mjs"))) {
    & node (Join-Path $InstallRoot "scripts\provider-hooks.mjs") uninstall $InstallRoot
} elseif (Test-Path -LiteralPath (Join-Path $InstallRoot "scripts\provider-hooks.mjs")) {
    Write-Warning "Node.js is unavailable, so AI CLI provider hooks could not be removed."
}

if (Get-Command copilot -ErrorAction SilentlyContinue) {
    try {
        copilot plugin uninstall sam
    } catch {
    }
    try {
        copilot plugin uninstall copilot-session-hub
    } catch {
    }
    try {
        copilot plugin marketplace remove ai-session-hub
    } catch {
    }
}

if (Test-Path -LiteralPath $StartupScript) {
    Remove-Item -LiteralPath $StartupScript -Force
}

Write-Host "AI Session Hub uninstalled. Session data remains in %LOCALAPPDATA%\CopilotSessionHub." -ForegroundColor Yellow
Write-Host "The application files can be removed from: $InstallRoot"
