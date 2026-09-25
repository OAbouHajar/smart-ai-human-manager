param(
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\ContextWorkspace"
$LegacyInstallRoots = @(
    (Join-Path $env:LOCALAPPDATA "Programs\SmartHumanAIManager"),
    (Join-Path $env:LOCALAPPDATA "Programs\CopilotSessionHub")
)
$DataRoot = Join-Path $env:LOCALAPPDATA "ContextWorkspace"
$LegacyDataRoots = @(
    (Join-Path $env:LOCALAPPDATA "CopilotSessionHub"),
    (Join-Path $env:LOCALAPPDATA "SmartHumanAIManager")
)
$StartupFolder = [Environment]::GetFolderPath("Startup")
$StartupScript = Join-Path $StartupFolder "Context Workspace.cmd"
$LegacyStartupScripts = @(
    (Join-Path $StartupFolder "Smart Human-AI Manager.cmd"),
    (Join-Path $StartupFolder "Copilot Session Hub.cmd")
)
$UpdateCheckValue = if ($env:CONTEXT_WORKSPACE_UPDATE_CHECK) {
    $env:CONTEXT_WORKSPACE_UPDATE_CHECK
} elseif ($env:COPILOT_SESSION_HUB_UPDATE_CHECK) {
    $env:COPILOT_SESSION_HUB_UPDATE_CHECK
} else {
    "1"
}
$UpdateCheck = if ($UpdateCheckValue -eq "0") { "0" } else { "1" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22.13 or newer is required."
}

$NodeVersion = [version]((node --version).TrimStart("v"))
if ($NodeVersion -lt [version]"22.13.0") {
    throw "Node.js 22.13 or newer is required. Found $NodeVersion."
}

$ProviderCommands = @("copilot", "claude", "codex", "gemini")
$InstalledProviders = @($ProviderCommands | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue })
$ScoutCandidates = @(
    $env:SCOUT_PATH,
    (Join-Path $env:LOCALAPPDATA "Programs\Clawpilot\scout\scout.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Microsoft Scout\scout.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if ($InstalledProviders.Count -eq 0 -and $ScoutCandidates.Count -eq 0) {
    throw "Install at least one supported AI agent: GitHub Copilot, Claude Code, Codex, Gemini, or Microsoft Scout."
}

# Stop the service before replacing files or reinstalling the plugin. The running
# process may be using the plugin cache that Copilot needs to update.
try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:43120/api/shutdown" -TimeoutSec 2 | Out-Null
} catch {
}

for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
    $Listener = Get-NetTCPConnection -LocalPort 43120 -State Listen -ErrorAction SilentlyContinue
    if (-not $Listener) {
        break
    }
    Start-Sleep -Milliseconds 250
}
if (Get-NetTCPConnection -LocalPort 43120 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 43120 is still in use. Close the process using it, then run the installer again."
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
if (-not (Test-Path (Join-Path $DataRoot "sessions.db"))) {
    $LegacyDataRoot = $LegacyDataRoots | Where-Object { Test-Path (Join-Path $_ "sessions.db") } | Select-Object -First 1
    if ($LegacyDataRoot) {
        New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
        Copy-Item -Path (Join-Path $LegacyDataRoot "*") -Destination $DataRoot -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Migrated legacy Context Workspace data from $LegacyDataRoot." -ForegroundColor Yellow
    }
}
$ResolvedProjectRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd("\")
$ResolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd("\")
if ($ResolvedProjectRoot -ne $ResolvedInstallRoot) {
    Remove-Item -LiteralPath (Join-Path $InstallRoot "commands") -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $ProjectRoot -Force |
        Where-Object { $_.Name -notin @(".git", "node_modules") } |
        Copy-Item -Destination $InstallRoot -Recurse -Force
}

$ServerPath = Join-Path $InstallRoot "server\server.mjs"
$CompatRoot = Join-Path $InstallRoot "compat\sham"
$CompatCommands = Join-Path $CompatRoot "commands"
$CompatScripts = Join-Path $CompatRoot "scripts"
New-Item -ItemType Directory -Force -Path $CompatCommands | Out-Null
New-Item -ItemType Directory -Force -Path $CompatScripts | Out-Null
Copy-Item -Path (Join-Path $InstallRoot "commands\*") -Destination $CompatCommands -Force
Copy-Item -LiteralPath (Join-Path $InstallRoot "scripts\project-share.mjs") -Destination $CompatScripts -Force
Get-ChildItem -LiteralPath $CompatCommands -Filter "*.md" | ForEach-Object {
    $Content = Get-Content $_.FullName -Raw
    Set-Content -LiteralPath $_.FullName -Value ($Content.Replace("/cw:", "/sham:")) -Encoding UTF8
}

$StartupContent = "@echo off`r`nset CONTEXT_WORKSPACE_UPDATE_CHECK=$UpdateCheck`r`nset CONTEXT_WORKSPACE_DATA=$DataRoot`r`nstart `"`" /min node `"$ServerPath`"`r`n"
Set-Content -LiteralPath $StartupScript -Value $StartupContent -Encoding ASCII

& node (Join-Path $InstallRoot "scripts\provider-hooks.mjs") install $InstallRoot
if ($LASTEXITCODE -ne 0) {
    throw "Could not configure AI CLI provider hooks."
}
& node (Join-Path $InstallRoot "scripts\scout-integration.mjs") install $InstallRoot
if ($LASTEXITCODE -ne 0) {
    throw "Could not configure the Microsoft Scout skill."
}

if (Get-Command copilot -ErrorAction SilentlyContinue) {
    try {
        copilot plugin uninstall cw 2>$null | Out-Null
    } catch {
    }
    try {
        copilot plugin uninstall sham 2>$null | Out-Null
    } catch {
    }
    try {
        copilot plugin uninstall sam 2>$null | Out-Null
    } catch {
    }
    try {
        copilot plugin uninstall copilot-session-hub 2>$null | Out-Null
    } catch {
    }
    try {
        copilot plugin marketplace remove smart-ai-human-manager 2>$null | Out-Null
    } catch {
    }
    try {
        copilot plugin marketplace remove context-workspace 2>$null | Out-Null
    } catch {
    }
    try {
        copilot plugin marketplace remove ai-session-hub 2>$null | Out-Null
    } catch {
    }
    $MarketplaceReady = $false
    for ($Attempt = 0; $Attempt -lt 3; $Attempt++) {
        copilot plugin marketplace add $InstallRoot 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $MarketplaceReady = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $MarketplaceReady) {
        Start-Process -FilePath "node" -ArgumentList "`"$ServerPath`"" -WorkingDirectory $InstallRoot -WindowStyle Hidden
        throw "Context Workspace was updated, but its verified local Copilot plugin marketplace could not be registered. Exit active Copilot CLI sessions and rerun this installer."
    }

    $PluginInstalled = $false
    for ($Attempt = 0; $Attempt -lt 5; $Attempt++) {
        $InstallOutput = copilot plugin install cw@context-workspace 2>&1
        if ($LASTEXITCODE -eq 0) {
            $PluginInstalled = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $PluginInstalled) {
        $InstallMessage = ($InstallOutput | Out-String).Trim()
        Start-Process -FilePath "node" -ArgumentList "`"$ServerPath`"" -WorkingDirectory $InstallRoot -WindowStyle Hidden
        throw @"
Context Workspace application files were updated, but the Copilot plugin could not be refreshed.
This usually means an active Copilot session is using the plugin files.

Exit all Copilot CLI sessions, then run:
pwsh -File "$InstallRoot\scripts\install.ps1" -NoOpen

Copilot plugin error:
$InstallMessage
"@
    }
    $InstallOutput | Write-Host
    $CompatInstalled = $false
    for ($Attempt = 0; $Attempt -lt 5; $Attempt++) {
        copilot plugin install sham@context-workspace 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $CompatInstalled = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $CompatInstalled) {
        Start-Process -FilePath "node" -ArgumentList "`"$ServerPath`"" -WorkingDirectory $InstallRoot -WindowStyle Hidden
        throw "Context Workspace was installed, but the legacy /sham command aliases could not be registered. Exit active Copilot CLI sessions and rerun this installer."
    }
}

Start-Process -FilePath "node" -ArgumentList "`"$ServerPath`"" -WorkingDirectory $InstallRoot -WindowStyle Hidden
$Healthy = $false
for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
    Start-Sleep -Milliseconds 250
    try {
        $Health = Invoke-RestMethod -Uri "http://127.0.0.1:43120/api/health" -TimeoutSec 2
        if ($Health.ok) {
            $Healthy = $true
            break
        }
    } catch {
    }
}
if (-not $Healthy) {
    throw "Context Workspace did not become healthy on http://127.0.0.1:43120."
}

foreach ($Path in $LegacyStartupScripts) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}
foreach ($Path in $LegacyInstallRoots) {
    if ([IO.Path]::GetFullPath($Path).TrimEnd("\") -ne [IO.Path]::GetFullPath($InstallRoot).TrimEnd("\")) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (-not $NoOpen) {
    Start-Process "http://127.0.0.1:43120"
}

Write-Host "Context Workspace installed." -ForegroundColor Green
Write-Host "Dashboard: http://127.0.0.1:43120"
Write-Host "Data: $DataRoot"
Write-Host "Restart each supported AI CLI so the Context Workspace hooks are loaded. Start a new Scout conversation to load its skill."
