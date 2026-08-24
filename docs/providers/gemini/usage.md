# Google Gemini CLI usage

Start or resume Gemini CLI normally after restarting it. Smart Human-AI Manager tracks session start, completed turns, context compression, and session end.

## Save continuity

Before leaving, tell Gemini:

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
gemini --resume <session-id>
```

Historical Gemini sessions created before hook installation are not currently imported.
