---
description: Recommend the best available AI model for each open project ticket
---

Create an evidence-based model execution plan for the current tracked project.

1. Extract the Context Workspace session ID and base dashboard URL from session-start context.
2. GET `{baseUrl}/api/sessions/{sessionId}`. If `projectId` is empty, stop and tell the user to run `/cw:project`.
3. GET `{baseUrl}/api/board?projectId={projectId}`.
4. Review every `in_progress`, `next`, and `backlog` ticket. Do not modify `done` tickets.
5. For each ticket, assess:
   - Scope and number of files likely involved.
   - Reasoning complexity and ambiguity.
   - Risk of regressions or security impact.
   - Need for long context, visual understanding, tool use, or fast iteration.
   - Whether the model is actually available in the user's current provider environment.
6. Recommend the least expensive model that can reliably complete the work. Do not choose the largest model by default.
7. PATCH each task at `{baseUrl}/api/tasks/{taskId}` with:

```json
{
  "recommendedModel": "Exact model name or identifier",
  "modelProvider": "Provider or AI CLI",
  "reasoningEffort": "low|medium|high|xhigh",
  "modelReason": "One concise, task-specific explanation"
}
```

8. If exact model availability cannot be verified, use a capability label such as `fast coding model`, `high-reasoning coding model`, `long-context model`, or `multimodal model`, and explain the limitation.
9. Preserve ticket status, owner, agent attribution, and description. Never claim that a recommendation guarantees quality.
10. Report a concise table with ticket ID, recommended model, reasoning effort, and reason.

Use higher reasoning only for architecture, migrations, difficult debugging, security-sensitive changes, or broad cross-file work. Prefer fast models for isolated edits, documentation, formatting, and straightforward tests.
