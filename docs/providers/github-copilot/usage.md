# GitHub Copilot CLI usage

Start or resume Copilot normally. The Context Workspace plugin tracks session start, completed turns, context compaction, and session end.

## Save continuity

Use:

| Command | Purpose |
|---|---|
| `/cw:wrap` | Save the session checkpoint and update its linked project |
| `/cw:handoff` | Save an explicit next-session todo list |
| `/cw:reopen` | Return a wrapped session to active review |
| `/cw:project` | Manage this session's explicit project |
| `/cw:refine` | Clarify, split, and prioritize backlog work |
| `/cw:plan` | Build an ordered board from unfinished work |
| `/cw:work` | Execute the best ready board task |
| `/cw:sync` | Reconcile board state with actual evidence |
| `/cw:review` | Validate delivered outcomes |
| `/cw:retro` | Adopt evidence-backed process improvements |
| `/cw:update` | Prepare the latest stable update |

The Context Workspace project cycle is `refine → plan → work → sync → review → retro`, while wrap, handoff, and reopen manage session continuity.

You can also ask Copilot to **wrap this session** or **checkpoint this session**.

## Resume

Choose **Resume this session** in the dashboard or run:

```bash
copilot --resume=<session-id>
```

Existing local Copilot session history is imported read-only when its supported history database is available.
