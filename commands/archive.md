---
description: Archive or restore a Context Workspace project without losing its history
---

Archive or restore the current session's Context Workspace project.

Archiving is reversible. It removes a project from active views while preserving every linked session, task, decision, work item, metric, and file record.

1. Find the Context Workspace session ID and dashboard URL in the session-start context.
2. GET `/api/sessions/{sessionId}` to identify the linked project. If the session is unassigned, stop and report that there is no project to archive.
3. GET `/api/board?projectId={projectId}` and inspect the project status and task counts.
4. If the project is active or complete:
   - Report its title and the number of unfinished tasks.
   - Ask for explicit confirmation before archiving. Make clear that unfinished work is preserved but hidden from active project views.
   - After confirmation, PATCH `/api/projects/{projectId}` with `{ "status": "archived", "confirmArchive": true }`.
5. If the project is archived:
   - Ask for explicit confirmation before restoring it.
   - After confirmation, PATCH `/api/projects/{projectId}` with `{ "status": "active" }`.
6. Never delete the project, unlink its sessions, complete its tasks automatically, or claim success unless the API confirms it.
7. Report the resulting status and dashboard URL concisely.
