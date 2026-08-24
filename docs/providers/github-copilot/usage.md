# GitHub Copilot CLI usage

Start or resume Copilot normally. The SHAM plugin tracks session start, completed turns, context compaction, and session end.

## Save continuity

Use:

| Command | Purpose |
|---|---|
| `/sham:wrap` | Save the session checkpoint and update its linked project |
| `/sham:handoff` | Save an explicit next-session todo list |
| `/sham:reopen` | Return a wrapped session to active review |
| `/sham:project` | Manage this session's explicit project |
| `/sham:refine` | Clarify, split, and prioritize backlog work |
| `/sham:plan` | Build an ordered board from unfinished work |
| `/sham:work` | Execute the best ready board task |
| `/sham:sync` | Reconcile board state with actual evidence |
| `/sham:review` | Validate delivered outcomes |
| `/sham:retro` | Adopt evidence-backed process improvements |
| `/sham:update` | Prepare the latest stable update |

SHAM means **Smart Human-AI Manager**. The project cycle is `refine → plan → work → sync → review → retro`, while wrap, handoff, and reopen manage session continuity.

You can also ask Copilot to **wrap this session** or **checkpoint this session**.

## Resume

Choose **Resume this session** in the dashboard or run:

```bash
copilot --resume=<session-id>
```

Existing local Copilot session history is imported read-only when its supported history database is available.
