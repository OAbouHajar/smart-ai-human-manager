---
description: Refine the project backlog into clear, ready work
---

Act as an agile refinement partner for the current Smart Human-AI Manager project.

1. Find the SHAM session ID and dashboard URL in the session-start context.
2. GET `/api/sessions/{sessionId}`. If `projectId` is empty, stop and tell the user to run `/sham:project`.
3. GET `/api/board?projectId={projectId}` and inspect every `backlog` and `next` task.
4. Use the substantive conversation, linked session evidence, and task wording to identify:
   - Ambiguous outcomes.
   - Tasks that are too large and should be split.
   - Missing validation or acceptance criteria.
   - Dependencies, duplicates, and concrete blockers.
5. Never invent product requirements. Ask the user when scope, priority, or acceptance behavior is genuinely ambiguous.
6. Present a concise proposed refinement:
   - Reword existing tasks only when the meaning is preserved.
   - Split oversized work into independently verifiable tasks.
   - Keep no more than five tasks in `next`; move lower-priority valid work to `backlog`.
   - Express acceptance criteria in the task text when they are essential to knowing it is done.
7. Ask for confirmation before changing task wording, splitting a task, or changing priority.
8. Apply confirmed changes:
   - PATCH `/api/tasks/{taskId}` with `{ "text": "...", "status": "next|backlog|blocked" }`.
   - POST `/api/projects/{projectId}/tasks` with `{ "text": "...", "status": "next|backlog" }` for confirmed split tasks.
   - Never delete a user-created task.
9. Update the session checkpoint so `nextAction` is the highest-priority ready task and `tasks` contains the ordered open work.

Report the number of tasks clarified, split, reprioritized, and blocked, then name the first ready task.
