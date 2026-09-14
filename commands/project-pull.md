---
description: Pull a teammate's shared project board and connect this local AI session
---

Import shared Context Workspace project work from the repository without importing another person's AI conversation.

1. Extract the Context Workspace session ID and base dashboard URL from session-start context.
2. Run the list operation:

```text
node "<pluginRoot>/scripts/project-share.mjs" list --base-url "<baseUrl>" --cwd "<currentRepository>"
```

3. If several projects are available and the current session is not already linked, use `ask_user` to let the user select one. Never infer the project only from repository similarity.
4. Run:

```text
node "<pluginRoot>/scripts/project-share.mjs" pull --base-url "<baseUrl>" --session-id "<sessionId>" --project-id "<projectId>" --cwd "<currentRepository>"
```

5. The pull imports the sanitized Kanban and links an unassigned current session to that explicit project. It does not import transcripts, prompts, source code, or another user's local session.
6. GET `{baseUrl}/api/board?projectId={projectId}` after import and summarize the first actionable `in_progress` or `next` ticket.
7. Do not start or modify work until the user asks or invokes `/cw:work`.

If the current session belongs to a different project, stop rather than moving it automatically.
