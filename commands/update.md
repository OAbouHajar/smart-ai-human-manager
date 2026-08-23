---
description: Update AI Session Hub safely with one command
---

Schedule the latest stable AI Session Hub update. The user must not need to run a second script or handle a temporary path.

1. Find the dashboard URL in the Session Hub context added when this session started.
2. GET `{dashboardUrl}/api/update?refresh=1`.
3. Stop and report clearly when:
   - update checks are disabled;
   - the check returned an error;
   - no newer version is available.
4. Require `latestVersion` to match `X.Y.Z` using decimal numbers only.
5. Ask for confirmation with the `ask_user` tool. Show installed version, available version, and that installation begins automatically after this AI CLI session exits.
6. After confirmation, POST `{dashboardUrl}/api/update/install` with exactly:

```json
{ "sessionId": "<current Session Hub session ID>" }
```

7. Poll GET `{dashboardUrl}/api/update/job` until the job is `waiting_for_exit` or `failed`. Stop after 90 seconds and report the current state if preparation is still running. The user can cancel a preparing or waiting job through POST `{dashboardUrl}/api/update/cancel`.
8. If preparation fails, report its concise `error`; do not expose logs, Git commands, staging paths, or internal configuration.
9. When the job is `waiting_for_exit`, tell the user:
   - the exact stable version is downloaded and verified;
   - they should exit all active supported AI CLI sessions;
   - installation and dashboard restart will then happen automatically;
   - the next AI CLI session will report success or failure.
10. Do not run another installer command, clone a repository yourself, or show a temporary path. Existing Session Hub data and unrelated provider settings are preserved.

Never install a branch, prerelease, draft, or version other than the validated latest stable release.
