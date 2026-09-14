# Google Gemini CLI setup

## Requirements

- Google Gemini CLI, signed in
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

When `gemini` is available on `PATH`, the installer merges Context Workspace handlers into:

```text
~/.gemini/settings.json
```

If `GEMINI_CLI_HOME` is set, that directory is used instead. Existing settings and unrelated hooks are preserved.

Restart Gemini CLI after installation so it loads the new lifecycle hooks.

## Verify

```bash
curl http://127.0.0.1:43120/api/health
gemini --version
```

Start a new Gemini session, then confirm that it appears in the dashboard.
