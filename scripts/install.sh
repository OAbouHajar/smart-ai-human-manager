#!/bin/bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.13 or newer is required." >&2
  exit 1
fi

node "$(cd "$(dirname "$0")" && pwd)/install.mjs" "$@"
