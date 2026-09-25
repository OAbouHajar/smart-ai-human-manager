$ErrorActionPreference = "Stop"
$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\ContextWorkspace"
$LegacyInstallRoots = @(
    (Join-Path $env:LOCALAPPDATA "Programs\SmartHumanAIManager"),
    (Join-Path $env:LOCALAPPDATA "Programs\CopilotSessionHub")
)
$StartupFolder = [Environment]::GetFolderPath("Startup")
$StartupScript = Join-Path $StartupFolder "Context Workspace.cmd"
$LegacyStartupScripts = @(
    (Join-Path $StartupFolder "Smart Human-AI Manager.cmd"),
    (Join-Path $StartupFolder "Copilot Session Hub.cmd")
)
$HookRoot = @($InstallRoot) + $LegacyInstallRoots |
    Where-Object { Test-Path -LiteralPath (Join-Path $_ "scripts\provider-hooks.mjs") } |
    Select-Object -First 1

try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:43120/api/shutdown" -TimeoutSec 2 | Out-Null
} catch {
}

if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $HookRoot "scripts\provider-hooks.mjs"))) {
    & node (Join-Path $HookRoot "scripts\provider-hooks.mjs") uninstall $HookRoot
    if (Test-Path -LiteralPath (Join-Path $HookRoot "scripts\scout-integration.mjs")) {
        & node (Join-Path $HookRoot "scripts\scout-integration.mjs") uninstall $HookRoot
    }
} elseif (Test-Path -LiteralPath (Join-Path $HookRoot "scripts\provider-hooks.mjs")) {
    Write-Warning "Node.js is unavailable, so AI provider hooks and the Microsoft Scout skill could not be removed."
}

if (Get-Command copilot -ErrorAction SilentlyContinue) {
    try {
        copilot plugin uninstall cw
    } catch {
    }
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
        copilot plugin marketplace remove context-workspace
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
foreach ($Path in $LegacyStartupScripts) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $InstallRoot) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
}
foreach ($Path in $LegacyInstallRoots) {
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Context Workspace uninstalled. Session data was preserved under %LOCALAPPDATA%\ContextWorkspace or its legacy data directory." -ForegroundColor Yellow
