<!-- context-workspace-managed-scout-skill -->
---
name: context-workspace-scout
description: Always use when a Microsoft Scout message contains /cw:, /sham:, Context Workspace, wrap-session, wrap this session, checkpoint, handoff, project tracking, or a request to track or manage AI work.
---

Integrate this Microsoft Scout conversation with the local Context Workspace service at `http://127.0.0.1:43120`.

## Command routing

Treat any message beginning with `/cw:` or `/sham:` as a Context Workspace request written as chat text. Scout does not need a native slash-command registration to execute the workflow. Do not call the command unsupported or a typo.

Recognize these commands and aliases:

- `/cw:wrap`, `/cw:wrap-session`, `/sham:wrap`, `wrap this session`: save a checkpoint without ending the conversation.
- `/cw:handoff`, `/sham:handoff`: save a checkpoint with explicit next-session tasks, then mark the Scout session paused.
- `/cw:project`, `/sham:project`: inspect, create, link, switch, unlink, or complete a project only as explicitly requested.
- `/cw:reopen`, `/sham:reopen`: return the tracked session to active review.
- Other `/cw:` and `/sham:` requests: follow the equivalent Context Workspace workflow through the local API or the dashboard. Preserve human control over project membership, sharing, priorities, and acceptance.

`/cw:wrap-session` is a supported Scout chat alias for `/cw:wrap`, even though it is not a Copilot CLI command.

## Start tracking

When this skill first activates in a conversation:

1. GET `/api/health`. If the service is unavailable, state that Context Workspace is not running and stop.
2. Generate a UUID and POST `/api/hooks/scout/sessionStart` with:

```json
{
  "sessionId": "<uuid>",
  "timestamp": "<current Unix epoch milliseconds>",
  "cwd": "<current workspace directory>",
  "source": "scout-skill"
}
```

Use the current Unix epoch time in milliseconds for `timestamp`. Keep the returned full `sessionId` in the conversation context and reuse it for every later Context Workspace action in this conversation. Never create a second session unless the existing ID is unavailable or the user explicitly requests a new tracked session.

The external UUID is used for `/api/hooks/scout/...` events. The returned full ID, normally `scout:<uuid>`, is used for `/api/sessions/{sessionId}` and its checkpoint endpoint.

After the start response succeeds, GET `/api/sessions/{returnedSessionId}` and verify the session exists before reporting that tracking started. If verification fails, state the API error and do not claim the conversation is tracked.

The session is unassigned unless the API response includes a project. Never infer or create project membership from the repository or folder.

## Save a checkpoint

When the user asks to wrap, checkpoint, pause, or hand off:

1. If tracking has not started, start it first.
2. Review the substantive conversation and actual tool activity.
3. POST `/api/sessions/{sessionId}/checkpoint` using exactly:

```json
{
  "title": "Short title",
  "summary": "Goal and meaningful progress",
  "lastAction": "Latest verified completed action",
  "nextAction": "Best supported next action",
  "tasks": [],
  "completedTasks": [],
  "unresolved": [],
  "decisions": [],
  "files": [
    { "path": "relative/or/absolute/path", "toolName": "tool used" }
  ]
}
```

Only include unfinished requested work in `tasks`, verified completed work in `completedTasks`, and files actually viewed, created, or edited. Do not include secrets, prompts, transcripts, source contents, or raw logs. If no requested work remains, use `No pending action - this session is complete.` for `nextAction` and an empty `tasks` array.

For pause or handoff requests, after the checkpoint succeeds, POST `/api/hooks/scout/sessionEnd` with the same external UUID, the current timestamp, and reason `user_exit`. A wrap or checkpoint alone does not end the session.

Never claim a checkpoint succeeded unless the endpoint confirms it. Report the dashboard URL after a successful save.

Never create or report a local-only wrap, local tracking entry, Markdown checkpoint, or success-shaped fallback. If Context Workspace cannot index the Scout session or accept the checkpoint, report the failure clearly and leave the conversation unwrapped.

## Project work

Use the session and project APIs exposed by Context Workspace rather than editing its SQLite database. Project creation, linking, switching, sharing, archiving, and completion always require the user's explicit request. Preserve human control over task priority, acceptance, auto-wrap, and project membership.

## Scout limitation

Microsoft Scout currently exposes custom skills but no supported external lifecycle-hook configuration. Tracking therefore starts when this skill is activated, not automatically when every Scout conversation opens. Restore Scout conversations from Scout's own history; Context Workspace does not launch a Scout resume command.
