---
description: Remove the current session from the Wrapped view without deleting its continuity data
---

Mark the current AI Session Hub session as needing a new wrap.

1. Find the Session Hub session ID and dashboard URL from the session-start context.
2. Send a `PATCH` request to:

```text
<dashboardUrl>/api/sessions/<session-id>
```

with exactly this JSON body:

```json
{
  "needsReview": true
}
```

3. Do not clear or replace the session title, summary, last action, next action, tasks, decisions, unresolved questions, files, work items, events, or project state.
4. Do not archive or delete the session.
5. If the request fails, show the error and do not claim the session was unwrapped.
6. After the endpoint confirms success, show:

```text
Session unwrapped — it has been removed from Wrapped and marked Needs wrap.
Dashboard: <dashboardUrl>
```

The session remains available under Active or Paused and can be wrapped again later.
