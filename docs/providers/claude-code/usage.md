# Claude Code usage

Start or resume Claude Code normally after restarting it. Smart Human-AI Manager tracks session start, completed turns, context compaction, and session end.

## Save continuity

Claude Code does not receive the Copilot plugin slash commands. Before leaving, tell Claude:

```text
Wrap this session.
```

or:

```text
Checkpoint this session and save the next actions.
```

The SessionStart hook gives Claude the local checkpoint endpoint and dashboard URL needed to save the handoff.

## Resume

Choose **Resume this session** in the dashboard or run:

```bash
claude --resume <session-id>
```

Historical Claude sessions created before hook installation are not currently imported.
