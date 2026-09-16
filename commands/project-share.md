---
description: Share the current project's sanitized Kanban through a dedicated Git branch
---

Publish the current Context Workspace project's board for teammates without sharing AI conversations.

1. Extract the Context Workspace session ID and base dashboard URL from session-start context.
2. GET `{baseUrl}/api/sessions/{sessionId}`. If the session is not linked to a project, stop and tell the user to run `/cw:project`.
3. GET `{baseUrl}/api/projects/{projectId}/share` and show a concise preview containing the project title and the ticket IDs, titles, descriptions, statuses, human owners, AI agents, and completion attribution that will be published.
4. Use `ask_user` to confirm the first publication. Explain that it pushes only this previewed state to `context-workspace/shared-projects` on `origin`; it never publishes transcripts, prompts, responses, source code, local paths, or tool logs.
5. Run:

```text
node "<pluginRoot>/scripts/project-share.mjs" push --base-url "<baseUrl>" --session-id "<sessionId>" --cwd "<currentRepository>"
```

6. Do not push any code branch or other Git ref.
7. Require the script's successful JSON response before reporting success.
8. Report the project title, ticket count, remote branch, and dashboard URL.

If Git authentication, identity, or permissions fail, report the exact blocker. Never fall back to a public gist or upload the full local database.
