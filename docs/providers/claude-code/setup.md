# Claude Code setup

## Requirements

- Claude Code, signed in
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

When `claude` is available on `PATH`, the installer merges Smart Human-AI Manager handlers into:

```text
~/.claude/settings.json
```

If `CLAUDE_CONFIG_DIR` is set, that directory is used instead. Existing settings and unrelated hooks are preserved.

Restart Claude Code after installation. The currently running session cannot load hooks that were added after it started.

## Verify

```bash
curl http://127.0.0.1:43120/api/health
claude --version
```

Start a new Claude session, then confirm that it appears in the dashboard.
