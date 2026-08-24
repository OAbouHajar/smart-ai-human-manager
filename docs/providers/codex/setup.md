# OpenAI Codex CLI setup

## Requirements

- OpenAI Codex CLI, signed in
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

When `codex` is available on `PATH`, the installer merges Smart Human-AI Manager handlers into:

```text
~/.codex/hooks.json
```

If `CODEX_HOME` is set, that directory is used instead. Existing hooks are preserved.

Restart Codex after installation. Codex requires non-managed hooks to be reviewed before they run. Open `/hooks`, review the Smart Human-AI Manager entries, and trust them.

## Verify

```bash
curl http://127.0.0.1:43120/api/health
codex --version
```

After trusting the hooks, start a new Codex session and confirm that it appears in the dashboard.
