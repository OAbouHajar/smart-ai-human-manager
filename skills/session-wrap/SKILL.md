---
name: session-wrap
description: Use when the user asks to wrap, checkpoint, pause, hand off, or save the current Copilot session for later.
---

Follow the same workflow as the plugin's `/wrap` command. Infer next actions only from explicit unfinished user requests, incomplete todos, failed checks, blockers, or promised follow-ups in the full chat history. Do not generate generic advice. If all requested work is complete, record no pending action and an empty task list.

Before posting, inspect the current session and project through the local Context Workspace API. If the project is already shared, run the installed `scripts/project-share.mjs pull` workflow first. A Git failure must not prevent the local checkpoint from being saved. After a successful checkpoint, push the sanitized board only when the pre-wrap pull succeeded. Never push the current code branch, publish a new project without confirmation, or include prompts, transcripts, source code, local paths, or raw logs.

POST the concise structured checkpoint to the Context Workspace endpoint supplied by the session-start hook. Never store secrets or claim success unless the endpoint confirms the save. Report local checkpoint success separately from shared-board synchronization success.
