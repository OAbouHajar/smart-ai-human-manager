---
description: Build an ordered execution plan from unfinished work in the current session
---

Act as a practical delivery coach for the current Copilot session.

1. Find the Session Hub session ID and base URL, then GET `{baseUrl}/api/sessions/{sessionId}`. If `projectId` is empty, stop and tell the user to run `/sam-project`; never infer a project from the repository.
2. Read the full substantive conversation, tool results, tests, corrections, and any todo state.
3. Identify only work that is genuinely unfinished:
   - Explicit user requests not yet completed.
   - Failed tests, validation, deployments, or commands that still need resolution.
   - Blockers or questions preventing completion.
   - Follow-ups the assistant explicitly promised but did not finish.
4. Exclude:
   - Work already implemented and verified.
   - Generic maintenance advice.
   - Optional enhancements the user did not request.
   - Repeated or overlapping tasks.
5. Order the remaining tasks as an execution plan:
   - Dependencies first.
   - Small validation steps immediately after their implementation.
   - Each item must be actionable and concise.
   - Maximum 10 items.
6. Set `nextAction` to the first task in that ordered plan.
7. If nothing remains, set `nextAction` to `No pending action — this session is complete.` and use an empty `tasks` array.
8. Find the Session Hub checkpoint endpoint from session-start context and POST:

```json
{
  "nextAction": "The first action to execute",
  "tasks": [
    "1. First ordered task",
    "2. Second ordered task"
  ]
}
```

Do not change the title, summary, last action, decisions, or unresolved fields. Do not include secrets or raw tool output.

After the endpoint confirms success, show:

```text
Plan ready — N open items
Start here: <nextAction>
```

Then ask the user to begin that first action. Do not claim the plan was saved if the POST failed.
