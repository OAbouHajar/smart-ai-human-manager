---
description: Save a high-quality continuity checkpoint for the current Copilot session
---

Wrap the current session into Smart Human-AI Manager.

1. Use the current conversation and tool history to produce:
   - A concise session title.
   - A short summary of the goal and meaningful progress.
   - The last meaningful thing completed.
   - One specific recommended next action that is directly supported by an unfinished user request, failed validation, unresolved blocker, promised follow-up, or incomplete implementation in this conversation.
   - Up to six additional next actions, but ONLY for explicit todo/checklist items or clearly unfinished requested work.
   - Any known project tasks completed during this session, using the existing task wording when it is available.
   - Any unresolved questions, blockers, or important decisions.
   - Files actually viewed, created, or edited during this session, using repository-relative paths when possible.
2. Find the SHAM session ID and checkpoint endpoint in the context added when this session started.
3. POST the checkpoint as JSON using an available HTTP client (`Invoke-RestMethod` on Windows or `curl` on macOS). Use this shape:

```json
{
  "title": "Short title",
  "summary": "What this session accomplished",
  "lastAction": "Last meaningful completed action",
  "nextAction": "Best next action",
  "tasks": ["Additional action"],
  "completedTasks": ["Exact project task completed"],
  "unresolved": ["Open question"],
  "decisions": ["Important decision"],
  "files": [
    { "path": "src/example.js", "toolName": "edit" }
  ]
}
```

4. The request body MUST use exactly the property names above. `tasks` contains only unfinished project work. `completedTasks` contains only work verifiably completed in this session and should reuse the existing task wording when known. `files` must include only files supported by actual tool activity; use empty arrays when no items exist. Do not substitute fields such as `action`, `status`, `timestamp`, `sessionId`, or `remainingCredits`; the session ID is already part of the endpoint URL.
5. Evidence rules:
   - Read the whole substantive chat history, including user corrections and failed tool/test results.
   - Never invent setup advice, maintenance suggestions, or generic future work.
   - Exclude work already completed and verified.
   - If no unfinished requested work remains, set `nextAction` to "No pending action — this session is complete." and use an empty `tasks` array.
   - `lastAction` must be the most recent meaningful completed and verified outcome, not merely the latest command.
   - Use the session-start context to determine project membership. If the session belongs to a project, make `summary`, `lastAction`, `nextAction`, `tasks`, and `completedTasks` describe how this session changed that explicit project.
   - If the session is unassigned, save it independently. Do not infer project membership from its repository or working directory and do not create a project automatically. The user can run `/sham:project` later.
6. Do not include secrets, credentials, access tokens, or raw tool output.
7. If the POST fails, state the error clearly and do not claim the checkpoint was saved.
8. Inspect the successful checkpoint response. If `update.updateAvailable` is true, show one short notice after the checkpoint result: `Smart Human-AI Manager {latestVersion} is available (installed: {currentVersion}). Run /sham:update to prepare it safely.`
9. After a successful save, show the recommended next action and the dashboard URL. Do not exit Copilot automatically.
