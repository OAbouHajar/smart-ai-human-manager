# GitHub Copilot CLI usage

Start or resume Copilot normally. The Session Hub plugin tracks session start, completed turns, context compaction, and session end.

## Save continuity

Use:

| Command | Purpose |
|---|---|
| `/sam-wrap` | Save a continuity checkpoint |
| `/sam-handoff` or `/sam-next` | Save a checkpoint with an explicit next-session todo list |
| `/sam-project` | Manage this session's explicit project |
| `/sam-plan` | Build an ordered board from unfinished work |
| `/sam-sync` | Reconcile board state with actual progress |
| `/sam-do` | Execute the next actionable board task |
| `/sam-reopen` | Return a wrapped session to active review |
| `/sam-update` | Prepare the latest stable update |

SAM means **Smart AI Manager**. The original command names remain available as compatibility aliases.

You can also ask Copilot to **wrap this session** or **checkpoint this session**.

## Resume

Choose **Resume this session** in the dashboard or run:

```bash
copilot --resume=<session-id>
```

Existing local Copilot session history is imported read-only when its supported history database is available.
