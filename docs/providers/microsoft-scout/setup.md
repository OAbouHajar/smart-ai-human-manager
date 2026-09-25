# Microsoft Scout setup

## Requirements

- Microsoft Scout (Frontier), signed in
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

When Scout is detected, the installer writes only the managed Context Workspace skill:

```text
~/.copilot/skills/context-workspace-scout/SKILL.md
```

Existing Scout skills, Copilot settings, memories, conversations, and Context Workspace data are preserved. If that exact skill path contains a file not managed by Context Workspace, installation stops instead of overwriting it.

Start a new Scout conversation after installation so Scout discovers the skill.

## Verify

Open the dashboard Info panel and confirm **Microsoft Scout** is **Configured**. In Scout, say:

```text
Track this conversation with Context Workspace.
```

The conversation should appear in `http://127.0.0.1:43120`.

## Lifecycle limitation

Scout currently exposes custom skills but no supported user-configurable external session lifecycle hooks. Tracking starts when the skill activates, not automatically when every Scout conversation opens.
