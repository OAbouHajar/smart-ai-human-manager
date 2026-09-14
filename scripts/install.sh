#!/bin/bash
set -euo pipefail

NO_OPEN=false
case "${1:-}" in
  "")
    ;;
  --no-open)
    NO_OPEN=true
    ;;
  *)
    echo "Usage: $0 [--no-open]" >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer supports macOS only. Use scripts/install.ps1 on Windows." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.13 or newer is required." >&2
  exit 1
fi
NODE_PATH="$(command -v node)"
NODE_VERSION="$(node --version)"
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'; then
  echo "Node.js 22.13 or newer is required. Found ${NODE_VERSION}." >&2
  exit 1
fi
PROVIDER_COUNT=0
for provider in copilot claude codex gemini; do
  if command -v "$provider" >/dev/null 2>&1; then
    PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
  fi
done
if [[ "$PROVIDER_COUNT" -eq 0 ]]; then
  echo "Install at least one supported AI CLI: GitHub Copilot, Claude Code, Codex, or Gemini." >&2
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_ROOT="$HOME/Library/Application Support/Context Workspace/app"
LEGACY_INSTALL_ROOTS=(
  "$HOME/Library/Application Support/Smart Human-AI Manager/app"
  "$HOME/Library/Application Support/AI Session Hub/app"
)
DATA_ROOT="${CONTEXT_WORKSPACE_DATA:-$HOME/Library/Application Support/ContextWorkspace}"
LEGACY_DATA_ROOTS=(
  "${COPILOT_SESSION_HUB_DATA:-}"
  "$HOME/Library/Application Support/CopilotSessionHub"
  "$HOME/.copilot-session-hub"
)
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS/com.context-workspace.plist"
LEGACY_PLIST_PATHS=(
  "$LAUNCH_AGENTS/com.smart-human-ai-manager.plist"
  "$LAUNCH_AGENTS/com.ai-session-hub.plist"
)
LABEL="com.context-workspace"
DOMAIN="gui/$(id -u)"
SERVER_PATH="$INSTALL_ROOT/server/server.mjs"

launchctl bootout "$DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
for legacy_plist in "${LEGACY_PLIST_PATHS[@]}"; do
  launchctl bootout "$DOMAIN" "$legacy_plist" >/dev/null 2>&1 || true
done
curl --silent --show-error --max-time 2 --request POST \
  "http://127.0.0.1:43120/api/shutdown" >/dev/null 2>&1 || true
for _ in {1..20}; do
  if ! /usr/sbin/lsof -nP -iTCP:43120 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
if /usr/sbin/lsof -nP -iTCP:43120 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 43120 is still in use. Close the process using it, then run the installer again." >&2
  exit 1
fi

mkdir -p "$INSTALL_ROOT" "$DATA_ROOT" "$LAUNCH_AGENTS"
if [[ ! -f "$DATA_ROOT/sessions.db" ]]; then
  for legacy_data_root in "${LEGACY_DATA_ROOTS[@]}"; do
    if [[ -n "$legacy_data_root" && -f "$legacy_data_root/sessions.db" ]]; then
      cp -R "$legacy_data_root/." "$DATA_ROOT/"
      echo "Migrated legacy Context Workspace data from $legacy_data_root."
      break
    fi
  done
fi
if [[ "$PROJECT_ROOT" != "$INSTALL_ROOT" ]]; then
  rm -rf "$INSTALL_ROOT/commands"
  tar --exclude="./.git" --exclude="./node_modules" -cf - -C "$PROJECT_ROOT" . |
    tar -xf - -C "$INSTALL_ROOT"
fi

COMPAT_ROOT="$INSTALL_ROOT/compat/sham"
rm -rf "$COMPAT_ROOT/commands"
mkdir -p "$COMPAT_ROOT/commands" "$COMPAT_ROOT/scripts"
cp "$INSTALL_ROOT"/commands/*.md "$COMPAT_ROOT/commands/"
cp "$INSTALL_ROOT/scripts/project-share.mjs" "$COMPAT_ROOT/scripts/project-share.mjs"
for command_file in "$COMPAT_ROOT"/commands/*.md; do
  sed -i '' 's#/cw:#/sham:#g' "$command_file"
done

xml_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'
}

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$NODE_PATH")</string>
    <string>$(xml_escape "$SERVER_PATH")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$INSTALL_ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_escape "$PATH")</string>
    <key>CONTEXT_WORKSPACE_UPDATE_CHECK</key>
    <string>$(xml_escape "${CONTEXT_WORKSPACE_UPDATE_CHECK:-${COPILOT_SESSION_HUB_UPDATE_CHECK:-1}}")</string>
    <key>CONTEXT_WORKSPACE_DATA</key>
    <string>$(xml_escape "$DATA_ROOT")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$DATA_ROOT/server.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$DATA_ROOT/server-error.log")</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST_PATH" >/dev/null

start_service() {
  launchctl bootout "$DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
  launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
  launchctl kickstart -k "$DOMAIN/$LABEL"
}

node "$INSTALL_ROOT/scripts/provider-hooks.mjs" install "$INSTALL_ROOT"

if command -v copilot >/dev/null 2>&1; then
  copilot plugin uninstall cw >/dev/null 2>&1 || true
  copilot plugin uninstall sham >/dev/null 2>&1 || true
  copilot plugin uninstall sam >/dev/null 2>&1 || true
  copilot plugin uninstall copilot-session-hub >/dev/null 2>&1 || true
  copilot plugin marketplace remove smart-ai-human-manager >/dev/null 2>&1 || true
  copilot plugin marketplace remove context-workspace >/dev/null 2>&1 || true
  copilot plugin marketplace remove ai-session-hub >/dev/null 2>&1 || true
  MARKETPLACE_READY=false
  for _ in {1..3}; do
    if copilot plugin marketplace add "$INSTALL_ROOT" >/dev/null 2>&1; then
      MARKETPLACE_READY=true
      break
    fi
    sleep 1
  done
  if [[ "$MARKETPLACE_READY" != true ]]; then
    start_service
    echo "Context Workspace was updated, but its verified local Copilot plugin marketplace could not be registered." >&2
    echo "Exit active Copilot CLI sessions and rerun this installer." >&2
    exit 1
  fi

  PLUGIN_INSTALLED=false
  for _ in {1..5}; do
    if INSTALL_OUTPUT="$(copilot plugin install cw@context-workspace 2>&1)"; then
      PLUGIN_INSTALLED=true
      break
    fi
    sleep 1
  done
  if [[ "$PLUGIN_INSTALLED" != true ]]; then
    start_service
    cat >&2 <<EOF
Context Workspace application files were updated, but the Copilot plugin could not be refreshed.
This usually means an active Copilot session is using the plugin files.

Exit all Copilot CLI sessions, then run:
"$INSTALL_ROOT/scripts/install.sh" --no-open

Copilot plugin error:
$INSTALL_OUTPUT
EOF
    exit 1
  fi
  printf '%s\n' "$INSTALL_OUTPUT"
  COMPAT_INSTALLED=false
  for _ in {1..5}; do
    if copilot plugin install sham@context-workspace >/dev/null 2>&1; then
      COMPAT_INSTALLED=true
      break
    fi
    sleep 1
  done
  if [[ "$COMPAT_INSTALLED" != true ]]; then
    start_service
    echo "Context Workspace was installed, but the legacy /sham command aliases could not be registered." >&2
    echo "Exit active Copilot CLI sessions and rerun this installer." >&2
    exit 1
  fi
fi

start_service
HEALTHY=false
for _ in {1..20}; do
  sleep 0.25
  if curl --silent --max-time 2 "http://127.0.0.1:43120/api/health" |
    grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
    HEALTHY=true
    break
  fi
done
if [[ "$HEALTHY" != "true" ]]; then
  echo "Context Workspace did not become healthy on http://127.0.0.1:43120." >&2
  exit 1
fi

for legacy_install_root in "${LEGACY_INSTALL_ROOTS[@]}"; do
  rm -rf "$legacy_install_root"
done
for legacy_plist in "${LEGACY_PLIST_PATHS[@]}"; do
  rm -f "$legacy_plist"
done

if [[ "$NO_OPEN" != "true" ]]; then
  open "http://127.0.0.1:43120"
fi

echo "Context Workspace installed."
echo "Dashboard: http://127.0.0.1:43120"
echo "Data: $DATA_ROOT"
echo "Restart each supported AI CLI so the Context Workspace hooks are loaded."
