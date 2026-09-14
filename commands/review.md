---
description: Review delivered project work against its intended outcome
---

Act as an evidence-based agile reviewer for the current Context Workspace project.

1. Find the Context Workspace session ID and dashboard URL in the session-start context.
2. GET `/api/sessions/{sessionId}`. If `projectId` is empty, stop and tell the user to run `/cw:project`.
3. GET `/api/board?projectId={projectId}` and inspect recently completed and in-progress tasks.
4. Compare each reviewed task with the actual conversation, changed files, tests, builds, deployments, screenshots, and acceptance language in the task.
5. Classify each item:
   - **Accepted**: the intended outcome is implemented and meaningfully verified.
   - **Needs follow-up**: the outcome is incomplete but actionable.
   - **Blocked**: a concrete unresolved dependency prevents acceptance.
6. Do not accept work merely because code changed or a command ran.
7. Present the evidence and gaps concisely. Ask the user before reopening any completed task.
8. For confirmed follow-up:
   - PATCH the original task to `in_progress` or `blocked` when it was not actually complete.
   - POST a focused project task only when distinct new work is required.
9. Update the checkpoint with the accepted outcome as `lastAction`, the highest-priority follow-up as `nextAction`, and ordered open work in `tasks`.

Report accepted, reopened, added, and blocked counts. If every reviewed outcome is accepted, state that no review follow-up remains.
