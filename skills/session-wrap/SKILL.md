---
name: session-wrap
description: Use when the user asks to wrap, checkpoint, pause, hand off, or save the current Copilot session for later.
---

Follow the same workflow as the plugin's `/wrap` command. Infer next actions only from explicit unfinished user requests, incomplete todos, failed checks, blockers, or promised follow-ups in the full chat history. Do not generate generic advice. If all requested work is complete, record no pending action and an empty task list. POST the concise structured checkpoint to the SHAM endpoint supplied by the session-start hook. Never store secrets or claim success unless the endpoint confirms the save.
