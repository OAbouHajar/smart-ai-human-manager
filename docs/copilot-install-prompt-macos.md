# Install Smart Human-AI Manager with Copilot on macOS

Copy the prompt below into GitHub Copilot CLI. Copilot will clone the repository, run the installer, verify the service, and report the dashboard URL.

```text
Install Smart Human-AI Manager from https://github.com/OAbouHajar/smart-ai-human-manager on this Mac.

Do the setup end-to-end:
1. Verify that macOS, git, Node.js 22.13 or newer, and at least one supported AI CLI (GitHub Copilot, Claude Code, Codex, or Gemini) are installed.
2. Verify that each detected AI CLI is usable and signed in. If a prerequisite is missing, stop and tell me the exact official installation command or link needed.
3. Clone the repository into a temporary directory. If it is already cloned there, fetch and reset that temporary clone to the latest `main`.
4. Read `README.md` and `scripts/install.sh` before executing the installer.
5. Run `./scripts/install.sh --no-open`.
6. Do not delete or overwrite existing SHAM SQLite data under `~/Library/Application Support/CopilotSessionHub`.
7. If the installer says an active Copilot session is locking the plugin files, explain that the application files are already updated and give me the exact command it printed to run after exiting Copilot. Do not report installation success in that case.
8. Verify that `http://127.0.0.1:43120/api/health` returns `ok: true`.
9. Open `http://127.0.0.1:43120`.
10. Report whether installation succeeded, the installed version, and any action I still need to take.

Proceed autonomously. Only ask me before an action that requires administrator permission or would delete user data.
```
