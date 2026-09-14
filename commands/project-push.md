---
description: Push the latest sanitized project board to its shared Git branch
---

Publish current local project changes to the shared Context Workspace board.

1. Extract the Context Workspace session ID and base dashboard URL from session-start context.
2. GET `{baseUrl}/api/sessions/{sessionId}` and require a linked project.
3. Run:

```text
node "<pluginRoot>/scripts/project-share.mjs" push --base-url "<baseUrl>" --session-id "<sessionId>" --cwd "<currentRepository>"
```

4. This command is explicit consent to update only `context-workspace/shared-projects`. Never push the current code branch.
5. Require a successful JSON response, then report the project title and number of shared tickets.

Only project title, description, ticket IDs, short descriptions, statuses, owners, and revisions may be published. Do not add transcripts, prompts, raw responses, code, local paths, or tool logs.
