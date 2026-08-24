$ErrorActionPreference = "Stop"
$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\SmartHumanAIManager"
$LegacyInstallRoot = Join-Path $env:LOCALAPPDATA "Programs\CopilotSessionHub"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$StartupScript = Join-Path $StartupFolder "Smart Human-AI Manager.cmd"
$LegacyStartupScript = Join-Path $StartupFolder "Copilot Session Hub.cmd"
$HookRoot = if (Test-Path -LiteralPath (Join-Path $InstallRoot "scripts\provider-hooks.mjs")) {
    $InstallRoot
} else {
    $LegacyInstallRoot
}

try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:43120/api/shutdown" -TimeoutSec 2 | Out-Null
} catch {
}

if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $HookRoot "scripts\provider-hooks.mjs"))) {
    & node (Join-Path $HookRoot "scripts\provider-hooks.mjs") uninstall $HookRoot
} elseif (Test-Path -LiteralPath (Join-Path $HookRoot "scripts\provider-hooks.mjs")) {
    Write-Warning "Node.js is unavailable, so AI CLI provider hooks could not be removed."
}

if (Get-Command copilot -ErrorAction SilentlyContinue) {
    try {
        copilot plugin uninstall sham
    } catch {
    }
    try {
        copilot plugin uninstall sam
    } catch {
    }
    try {
        copilot plugin uninstall copilot-session-hub
    } catch {
    }
    try {
        copilot plugin marketplace remove smart-ai-human-manager
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
if (Test-Path -LiteralPath $LegacyStartupScript) {
    Remove-Item -LiteralPath $LegacyStartupScript -Force
}
if (Test-Path -LiteralPath $InstallRoot) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
}
if (Test-Path -LiteralPath $LegacyInstallRoot) {
    Remove-Item -LiteralPath $LegacyInstallRoot -Recurse -Force
}

Write-Host "Smart Human-AI Manager uninstalled. Session data remains in %LOCALAPPDATA%\CopilotSessionHub." -ForegroundColor Yellow
