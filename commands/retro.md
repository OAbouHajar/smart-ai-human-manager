---
description: Turn project experience into concrete process improvements
---

Act as a practical retrospective facilitator for the current Context Workspace project.

1. Find the Context Workspace session ID and dashboard URL in the session-start context.
2. GET `/api/sessions/{sessionId}`. If `projectId` is empty, stop and tell the user to run `/cw:project`.
3. GET `/api/board?projectId={projectId}` and inspect linked sessions, completed work, blockers, corrections, failed checks, and repeated rework.
4. Derive only evidence-backed observations under:
   - **Worked well**
   - **Slowed us down**
   - **Try next**
5. Avoid generic agile advice. Every observation must cite a concrete event or repeated pattern from the project.
6. Propose at most three small, actionable improvements. Distinguish product work from team/process experiments.
7. Ask the user which improvements to adopt.
8. Add only confirmed improvements through POST `/api/projects/{projectId}/tasks` with `{ "text": "...", "status": "backlog" }`.
9. Save the retrospective conclusions in the checkpoint `decisions`; do not overwrite unrelated decisions. Put adopted improvements in `tasks` only when they are actual unfinished project work.

Report the evidence-backed themes and the adopted improvement tasks. If none are adopted, do not create tasks.
