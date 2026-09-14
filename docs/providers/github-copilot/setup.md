# GitHub Copilot CLI setup

## Requirements

- GitHub Copilot CLI, signed in
- Node.js 22.13 or newer
- Git
- macOS or Windows
- PowerShell 7 on Windows

## Install

Run the platform installer from the repository:

**macOS**

```bash
./scripts/install.sh
```

**Windows**

```powershell
pwsh -File .\scripts\install.ps1
```

The installer:

1. Copies the application into the platform installation directory.
2. Registers the installed, version-matched `context-workspace` marketplace and installs or refreshes `sham@context-workspace`.
3. Starts Context Workspace at `http://127.0.0.1:43120`.
4. Preserves the existing SHAM database.

Restart any Copilot CLI sessions that were open during installation. A new or restarted session loads the plugin hooks and slash commands.

The marketplace-based installation uses Copilot CLI's supported plugin distribution mechanism and does not rely on deprecated direct local-path installation.

## Verify

```bash
curl http://127.0.0.1:43120/api/health
copilot plugin list
```

The health response must contain `"ok":true`, and the plugin list must include `sham`.
