---
description: Control automatic wrapping for the current Smart Human-AI Manager session
---

Control auto-wrap for the current tracked session. Supported arguments are `on`, `off`, `status`, and `default`.

1. Find the SHAM session ID and dashboard URL in the session-start context.
2. Read the argument immediately following `/sham:auto-wrap`, case-insensitively.
3. GET `/api/sessions/{sessionId}`. Stop clearly if the tracked session does not exist.
4. Perform the requested operation:
   - **`on`:** PATCH `/api/sessions/{sessionId}` with `{ "autoWrapMode": "on" }`.
   - **`off`:** PATCH `/api/sessions/{sessionId}` with `{ "autoWrapMode": "off" }`.
   - **`default`:** PATCH `/api/sessions/{sessionId}` with `{ "autoWrapMode": "inherit" }`. This follows the global preference only while the session is linked to a project; unassigned sessions remain manual.
   - **`status`:** Do not modify anything. Report `autoWrapMode`, effective `autoWrapEnabled`, whether the session is linked to a project, and the resulting behavior.
5. If an explicit argument was supplied but it is not `on`, `off`, `status`, or `default`, stop and report the supported arguments. Do not reinterpret it or open the choice form.
6. If no argument was supplied, use `ask_user` to choose On, Off, Use linked-project default, or Show status. Never guess or change the setting without a selection.
7. After a change, inspect the successful response and report both the stored mode and effective behavior.
8. Auto-wrap only preserves session continuity. It never creates a project, links a session, changes priorities, accepts work, or archives anything.
9. Do not claim success unless the API confirms it.
