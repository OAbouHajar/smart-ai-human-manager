param([switch]$NoOpen)

$ErrorActionPreference = "Stop"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22.13 or newer is required."
}
$Arguments = @((Join-Path $PSScriptRoot "install.mjs"))
if ($NoOpen) { $Arguments += "--no-open" }
& node @Arguments
if ($LASTEXITCODE -ne 0) { throw "Context Workspace installation failed." }
