# GitHub Copilot CLI usage

Start or resume Copilot normally. The Session Hub plugin tracks session start, completed turns, context compaction, and session end.

## Save continuity

Use:

| Command | Purpose |
|---|---|
| `/sam:wrap` | Save the session checkpoint and update its linked project |
| `/sam:handoff` | Save an explicit next-session todo list |
| `/sam:reopen` | Return a wrapped session to active review |
| `/sam:project` | Manage this session's explicit project |
| `/sam:refine` | Clarify, split, and prioritize backlog work |
| `/sam:plan` | Build an ordered board from unfinished work |
| `/sam:work` | Execute the best ready board task |
| `/sam:sync` | Reconcile board state with actual evidence |
| `/sam:review` | Validate delivered outcomes |
| `/sam:retro` | Adopt evidence-backed process improvements |
| `/sam:update` | Prepare the latest stable update |

SAM means **Smart AI Manager**. The project cycle is `refine → plan → work → sync → review → retro`, while wrap, handoff, and reopen manage session continuity.

You can also ask Copilot to **wrap this session** or **checkpoint this session**.

## Resume

Choose **Resume this session** in the dashboard or run:

```bash
copilot --resume=<session-id>
```

Existing local Copilot session history is imported read-only when its supported history database is available.
