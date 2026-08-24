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
INSTALL_ROOT="$HOME/Library/Application Support/Smart Human-AI Manager/app"
LEGACY_INSTALL_ROOT="$HOME/Library/Application Support/AI Session Hub/app"
DATA_ROOT="$HOME/Library/Application Support/CopilotSessionHub"
if [[ -f "$HOME/.copilot-session-hub/sessions.db" && ! -f "$DATA_ROOT/sessions.db" ]]; then
  DATA_ROOT="$HOME/.copilot-session-hub"
fi
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS/com.smart-human-ai-manager.plist"
LEGACY_PLIST_PATH="$LAUNCH_AGENTS/com.ai-session-hub.plist"
LABEL="com.smart-human-ai-manager"
DOMAIN="gui/$(id -u)"
SERVER_PATH="$INSTALL_ROOT/server/server.mjs"

launchctl bootout "$DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootout "$DOMAIN" "$LEGACY_PLIST_PATH" >/dev/null 2>&1 || true
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
if [[ "$PROJECT_ROOT" != "$INSTALL_ROOT" ]]; then
  rm -rf "$INSTALL_ROOT/commands"
  tar --exclude="./.git" --exclude="./node_modules" -cf - -C "$PROJECT_ROOT" . |
    tar -xf - -C "$INSTALL_ROOT"
fi

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
    <key>COPILOT_SESSION_HUB_UPDATE_CHECK</key>
    <string>$(xml_escape "${COPILOT_SESSION_HUB_UPDATE_CHECK:-1}")</string>
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
  copilot plugin uninstall sham >/dev/null 2>&1 || true
  copilot plugin uninstall sam >/dev/null 2>&1 || true
  copilot plugin uninstall copilot-session-hub >/dev/null 2>&1 || true
  copilot plugin marketplace remove smart-ai-human-manager >/dev/null 2>&1 || true
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
    echo "Smart Human-AI Manager was updated, but its verified local Copilot plugin marketplace could not be registered." >&2
    echo "Exit active Copilot CLI sessions and rerun this installer." >&2
    exit 1
  fi

  PLUGIN_INSTALLED=false
  for _ in {1..5}; do
    if INSTALL_OUTPUT="$(copilot plugin install sham@smart-ai-human-manager 2>&1)"; then
      PLUGIN_INSTALLED=true
      break
    fi
    sleep 1
  done
  if [[ "$PLUGIN_INSTALLED" != true ]]; then
    start_service
    cat >&2 <<EOF
Smart Human-AI Manager application files were updated, but the Copilot plugin could not be refreshed.
This usually means an active Copilot session is using the plugin files.

Exit all Copilot CLI sessions, then run:
"$INSTALL_ROOT/scripts/install.sh" --no-open

Copilot plugin error:
$INSTALL_OUTPUT
EOF
    exit 1
  fi
  printf '%s\n' "$INSTALL_OUTPUT"
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
  echo "Smart Human-AI Manager did not become healthy on http://127.0.0.1:43120." >&2
  exit 1
fi

rm -rf "$LEGACY_INSTALL_ROOT"
rm -f "$LEGACY_PLIST_PATH"

if [[ "$NO_OPEN" != "true" ]]; then
  open "http://127.0.0.1:43120"
fi

echo "Smart Human-AI Manager installed."
echo "Dashboard: http://127.0.0.1:43120"
echo "Data: $DATA_ROOT"
echo "Restart each supported AI CLI so the SHAM hooks are loaded."
