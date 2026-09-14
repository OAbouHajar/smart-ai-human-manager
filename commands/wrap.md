---
description: Save a high-quality continuity checkpoint for the current Copilot session
---

Wrap the current session into Context Workspace.

1. Use the current conversation and tool history to produce:
   - A concise session title.
   - A short summary of the goal and meaningful progress.
   - The last meaningful thing completed.
   - One specific recommended next action that is directly supported by an unfinished user request, failed validation, unresolved blocker, promised follow-up, or incomplete implementation in this conversation.
   - Up to six additional next actions, but ONLY for explicit todo/checklist items or clearly unfinished requested work.
   - Any known project tasks completed during this session, using the existing task wording when it is available.
   - Any unresolved questions, blockers, or important decisions.
   - Files actually viewed, created, or edited during this session, using repository-relative paths when possible.
2. Find the Context Workspace session ID, base dashboard URL, and checkpoint endpoint in the context added when this session started.
3. GET `{baseUrl}/api/sessions/{sessionId}`. If it belongs to a project, GET `{baseUrl}/api/board?projectId={projectId}`.
4. If `board.project.sharing.enabled` is true, synchronize before saving:
   - Run `node "<pluginRoot>/scripts/project-share.mjs" pull --base-url "<baseUrl>" --session-id "<sessionId>" --project-id "<projectId>" --cwd "<currentRepository>"`.
   - If pull fails, continue saving the local checkpoint, but record the sharing failure and do not attempt the final push. Local continuity must not be lost because Git is unavailable or conflicted.
5. POST the checkpoint as JSON using an available HTTP client (`Invoke-RestMethod` on Windows or `curl` on macOS). Use this shape:

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

6. The request body MUST use exactly the property names above. `tasks` contains only unfinished project work. `completedTasks` contains only work verifiably completed in this session and should reuse the existing task wording when known. `files` must include only files supported by actual tool activity; use empty arrays when no items exist. Do not substitute fields such as `action`, `status`, `timestamp`, `sessionId`, or `remainingCredits`; the session ID is already part of the endpoint URL.
7. Evidence rules:
   - Read the whole substantive chat history, including user corrections and failed tool/test results.
   - Never invent setup advice, maintenance suggestions, or generic future work.
   - Exclude work already completed and verified.
   - If no unfinished requested work remains, set `nextAction` to "No pending action — this session is complete." and use an empty `tasks` array.
   - `lastAction` must be the most recent meaningful completed and verified outcome, not merely the latest command.
   - Use the session-start context to determine project membership. If the session belongs to a project, make `summary`, `lastAction`, `nextAction`, `tasks`, and `completedTasks` describe how this session changed that explicit project.
   - If the session is unassigned, save it independently. Do not infer project membership from its repository or working directory and do not create a project automatically. The user can run `/cw:project` later.
8. Do not include secrets, credentials, access tokens, or raw tool output.
9. If the POST fails, state the error clearly and do not claim the checkpoint was saved.
10. After a successful checkpoint, if the project is shared and the pre-wrap pull succeeded, run `node "<pluginRoot>/scripts/project-share.mjs" push --base-url "<baseUrl>" --session-id "<sessionId>" --cwd "<currentRepository>"`.
    - This wrap invocation is consent to update only the project's existing configured sharing branch.
    - Never push the current code branch or any other Git ref.
    - If push fails, report that the local checkpoint succeeded but the shared board remains pending synchronization.
11. Inspect the successful checkpoint response. If `update.updateAvailable` is true, show one short notice after the checkpoint result: `Context Workspace {latestVersion} is available (installed: {currentVersion}). Run /cw:update to prepare it safely.`
12. After a successful save, show the recommended next action, shared-board synchronization result when applicable, and dashboard URL. Do not exit Copilot automatically.
