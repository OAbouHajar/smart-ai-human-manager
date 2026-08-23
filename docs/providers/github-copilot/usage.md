# GitHub Copilot CLI usage

Start or resume Copilot normally. The Session Hub plugin tracks session start, completed turns, context compaction, and session end.

## Save continuity

Use:

| Command | Purpose |
|---|---|
| `/sesh-wrap` | Save a continuity checkpoint |
| `/sesh-handoff` or `/sesh-next` | Save a checkpoint with an explicit next-session todo list |
| `/sesh-project` | Manage this session's explicit project |
| `/sesh-plan` | Build an ordered board from unfinished work |
| `/sesh-sync` | Reconcile board state with actual progress |
| `/sesh-do` | Execute the next actionable board task |
| `/sesh-reopen` | Return a wrapped session to active review |
| `/sesh-update` | Prepare the latest stable update |

The previous command names remain available as compatibility aliases.

You can also ask Copilot to **wrap this session** or **checkpoint this session**.

## Resume

Choose **Resume this session** in the dashboard or run:

```bash
copilot --resume=<session-id>
```

Existing local Copilot session history is imported read-only when its supported history database is available.
