#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This uninstaller supports macOS only. Use scripts/uninstall.ps1 on Windows." >&2
  exit 1
fi

INSTALL_ROOT="$HOME/Library/Application Support/AI Session Hub/app"
DATA_ROOT="$HOME/Library/Application Support/CopilotSessionHub"
if [[ -f "$HOME/.copilot-session-hub/sessions.db" && ! -f "$DATA_ROOT/sessions.db" ]]; then
  DATA_ROOT="$HOME/.copilot-session-hub"
fi
PLIST_PATH="$HOME/Library/LaunchAgents/com.ai-session-hub.plist"
DOMAIN="gui/$(id -u)"

curl --silent --max-time 2 --request POST \
  "http://127.0.0.1:43120/api/shutdown" >/dev/null 2>&1 || true
if command -v node >/dev/null 2>&1 && [[ -f "$INSTALL_ROOT/scripts/provider-hooks.mjs" ]]; then
  node "$INSTALL_ROOT/scripts/provider-hooks.mjs" uninstall "$INSTALL_ROOT"
elif [[ -f "$INSTALL_ROOT/scripts/provider-hooks.mjs" ]]; then
  echo "Warning: Node.js is unavailable, so AI CLI provider hooks could not be removed." >&2
fi
if command -v copilot >/dev/null 2>&1; then
  copilot plugin uninstall sam >/dev/null 2>&1 || true
  copilot plugin uninstall copilot-session-hub >/dev/null 2>&1 || true
  copilot plugin marketplace remove ai-session-hub >/dev/null 2>&1 || true
fi
launchctl bootout "$DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
if [[ -f "$PLIST_PATH" ]]; then
  rm "$PLIST_PATH"
fi

echo "AI Session Hub uninstalled. Session data remains in: $DATA_ROOT"
echo "The application files can be removed from: $INSTALL_ROOT"
