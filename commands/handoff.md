---
description: Wrap the session and save an explicit todo list for the next session
---

Wrap the current session into AI Session Hub and preserve the user's intended next-session todo list.

1. Read the full substantive conversation, including completed work, failed checks, blockers, corrections, and promises.
2. Determine the todo list:
   - If the user included todos with the `/sam:handoff` invocation, use those todos.
   - Otherwise ask one focused question using the `ask_user` tool: `What should I save in the todo list for your next session?`
   - Preserve the user's intent, but rewrite each todo as one concise actionable item.
   - Maximum 10 todos.
   - Do not add generic advice or work the user did not request.
3. Produce the standard continuity checkpoint:
   - `title`: concise session title.
   - `summary`: goal and meaningful progress.
   - `lastAction`: last meaningful completed and verified outcome.
   - `nextAction`: the first todo item.
   - `tasks`: the complete explicit todo list, including the first item.
   - `completedTasks`: known project tasks completed in this session, using existing task wording when available.
   - `unresolved`: genuine blockers or open questions.
   - `decisions`: important decisions made in the session.
   - `files`: files actually viewed, created, or edited, with repository-relative paths and the tool action.
4. If the user explicitly says there is nothing left to do, set:
   - `nextAction` to `No pending action — this session is complete.`
   - `tasks` to an empty array.
5. Find the Session Hub checkpoint endpoint from the session-start context.
6. POST exactly this JSON shape using an available HTTP client (`Invoke-RestMethod` on Windows or `curl` on macOS):

```json
{
  "title": "Short title",
  "summary": "What this session accomplished",
  "lastAction": "Last meaningful completed action",
  "nextAction": "First explicit todo",
  "tasks": [
    "First explicit todo",
    "Second explicit todo"
  ],
  "completedTasks": ["Exact project task completed"],
  "unresolved": ["Open question"],
  "decisions": ["Important decision"],
  "files": [
    { "path": "src/example.js", "toolName": "edit" }
  ]
}
```

Use the session-start context to determine project membership. If linked, describe how this session changed that explicit project. If unassigned, save it independently and do not infer a project from the repository or working directory. `tasks` must contain only unfinished work. `completedTasks` must contain only verifiably completed work. Do not include secrets, raw tool output, timestamps, session IDs, or alternate property names in the body.

If the successful response has `update.updateAvailable` set to true, also show:

```text
AI Session Hub <latestVersion> is available (installed: <currentVersion>). Run /sam:update to prepare it safely.
```

After a successful save, show:

```text
Session wrapped — N todos saved
Start next time with: <nextAction>
Dashboard: <dashboardUrl>
```

Do not claim success unless the endpoint confirms the save. Do not exit Copilot automatically.
