---
description: Create or manage the explicit AI Session Hub project for this session
---

Manage the current session's AI Session Hub project.

Projects are explicit goals or workstreams. A repository can contain many projects, and a session belongs to at most one project. Never infer or create a project from the repository or working directory alone.

1. Find the Session Hub session ID and dashboard URL in the session-start context.
2. GET the current session from `/api/sessions/{sessionId}` and available projects from `/api/projects`.
3. Determine the requested operation from the user's invocation. If it is not explicit, use `ask_user` to offer:
   - Create a new project and link this session.
   - Link or move this session to an existing project.
   - Show the current project.
   - Unlink this session and return it to Unassigned.
   - Mark the current project complete.
4. Perform exactly one confirmed operation:
   - **Create:** Ask for a concise goal-based title and optional one-sentence description. POST `/api/projects` with `{ "title", "description", "sessionId" }`.
   - **Link or switch:** Prefer projects returned by `/api/project-suggestions?sessionId={sessionId}` with `suggested: true`, but show that they are suggestions only. Ask the user to choose, then POST `/api/projects/{projectId}/sessions` with `{ "sessionId" }`.
   - **Show:** Report the linked project's title, description, status, dashboard URL, and current recommended next action from `/api/board?projectId={projectId}`. If unassigned, say so clearly.
   - **Unlink:** Confirm the choice, then DELETE `/api/projects/{projectId}/sessions/{sessionId}`.
   - **Complete:** Confirm the choice, then PATCH `/api/projects/{projectId}` with `{ "status": "complete" }`.
5. A successful create or link moves the session from any previous project automatically because one session has one primary project.
6. Never delete a project or its sessions. Never link based only on repository similarity without the user's selection.
7. Do not claim success unless the API confirms it. Report the resulting project and dashboard URL concisely.
