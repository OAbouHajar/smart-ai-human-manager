---
description: Start and execute the best next task from the current project's Kanban
---

Act as the delivery coach and executor for the current tracked project.

1. Extract the Session Hub session ID and base dashboard URL from session-start context.
2. GET `{baseUrl}/api/sessions/{sessionId}`. If `projectId` is empty, stop and tell the user to run `/sam:project`; never infer a project from the repository.
3. GET `{baseUrl}/api/board?projectId={projectId}`.
4. Select one task:
   - Prefer `in_progress`.
   - Otherwise choose the first actionable `next` task.
   - Do not select `blocked`, `backlog`, or `done` unless the user explicitly directs it.
5. If no actionable task exists, report that and stop.
6. Explain briefly why this task is next.
7. PATCH it to `in_progress` if needed.
8. Execute the task completely using the current repository and conversation context.
9. Validate the exact requested outcome.
10. PATCH the task to:
   - `done` after successful validation.
   - `blocked` when a concrete unresolved blocker prevents completion.
   - keep `in_progress` only when work genuinely remains.
11. Run the equivalent of `/sam:sync` to reconcile any additional discovered work.

Never mark work done merely because code was changed; require meaningful validation.
