#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This uninstaller supports macOS only. Use scripts/uninstall.ps1 on Windows." >&2
  exit 1
fi

INSTALL_ROOT="$HOME/Library/Application Support/Context Workspace/app"
LEGACY_INSTALL_ROOTS=(
  "$HOME/Library/Application Support/Smart Human-AI Manager/app"
  "$HOME/Library/Application Support/AI Session Hub/app"
)
DATA_ROOT="$HOME/Library/Application Support/ContextWorkspace"
PLIST_PATH="$HOME/Library/LaunchAgents/com.context-workspace.plist"
LEGACY_PLIST_PATHS=(
  "$HOME/Library/LaunchAgents/com.smart-human-ai-manager.plist"
  "$HOME/Library/LaunchAgents/com.ai-session-hub.plist"
)
DOMAIN="gui/$(id -u)"
HOOK_ROOT=""
for candidate in "$INSTALL_ROOT" "${LEGACY_INSTALL_ROOTS[@]}"; do
  if [[ -f "$candidate/scripts/provider-hooks.mjs" ]]; then
    HOOK_ROOT="$candidate"
    break
  fi
done

curl --silent --max-time 2 --request POST \
  "http://127.0.0.1:43120/api/shutdown" >/dev/null 2>&1 || true
if command -v node >/dev/null 2>&1 && [[ -n "$HOOK_ROOT" ]]; then
  node "$HOOK_ROOT/scripts/provider-hooks.mjs" uninstall "$HOOK_ROOT"
  if [[ -f "$HOOK_ROOT/scripts/scout-integration.mjs" ]]; then
    node "$HOOK_ROOT/scripts/scout-integration.mjs" uninstall "$HOOK_ROOT"
  fi
elif [[ -n "$HOOK_ROOT" ]]; then
  echo "Warning: Node.js is unavailable, so AI provider hooks and the Microsoft Scout skill could not be removed." >&2
fi
if command -v copilot >/dev/null 2>&1; then
  copilot plugin uninstall cw >/dev/null 2>&1 || true
  copilot plugin uninstall sham >/dev/null 2>&1 || true
  copilot plugin uninstall sam >/dev/null 2>&1 || true
  copilot plugin uninstall copilot-session-hub >/dev/null 2>&1 || true
  copilot plugin marketplace remove smart-ai-human-manager >/dev/null 2>&1 || true
  copilot plugin marketplace remove context-workspace >/dev/null 2>&1 || true
  copilot plugin marketplace remove ai-session-hub >/dev/null 2>&1 || true
fi
launchctl bootout "$DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
for legacy_plist in "${LEGACY_PLIST_PATHS[@]}"; do
  launchctl bootout "$DOMAIN" "$legacy_plist" >/dev/null 2>&1 || true
done
rm -f "$PLIST_PATH" "${LEGACY_PLIST_PATHS[@]}"
rm -rf "$INSTALL_ROOT"
for legacy_install_root in "${LEGACY_INSTALL_ROOTS[@]}"; do
  rm -rf "$legacy_install_root"
done

echo "Context Workspace uninstalled. Session data was preserved in the current or legacy data directory."
