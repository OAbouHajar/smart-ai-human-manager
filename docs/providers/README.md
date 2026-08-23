# Provider guides

AI Session Hub detects supported AI CLIs during installation and adds only its own lifecycle hook entries. Existing provider settings are preserved.

| Provider | Setup | Usage | Wrap interaction |
|---|---|---|---|
| GitHub Copilot CLI | [Setup](github-copilot/setup.md) | [Usage](github-copilot/usage.md) | `/sesh-wrap` and related commands |
| Claude Code | [Setup](claude-code/setup.md) | [Usage](claude-code/usage.md) | Ask Claude to wrap or checkpoint |
| OpenAI Codex CLI | [Setup](codex/setup.md) | [Usage](codex/usage.md) | Ask Codex to wrap or checkpoint |
| Google Gemini CLI | [Setup](gemini/setup.md) | [Usage](gemini/usage.md) | Ask Gemini to wrap or checkpoint |

The dashboard is shared by every provider at `http://127.0.0.1:43120`.

Only Copilot historical sessions are currently imported. Claude, Codex, and Gemini tracking begins when a session starts after their hooks are installed and loaded.
