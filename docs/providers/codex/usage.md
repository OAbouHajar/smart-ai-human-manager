# OpenAI Codex CLI usage

Start or resume Codex normally after restarting it and trusting the Context Workspace hooks.

## Save continuity

Before leaving, tell Codex:

```text
Wrap this session.
```

or:

```text
Checkpoint this session and save the next actions.
```

The SessionStart hook provides the local checkpoint endpoint and dashboard URL.

## Resume

Choose **Resume this session** in the dashboard or run:

```bash
codex resume <session-id>
```

Historical Codex sessions created before hook installation are not currently imported.
