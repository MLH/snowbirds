#!/usr/bin/env bash
# Launches the SnowBirds live display for the projected big screen.

set -euo pipefail

WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$WORKSPACE"

PORT="${SNOWBIRDS_DISPLAY_PORT:-8765}"
HOST="${SNOWBIRDS_DISPLAY_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}/index.html"

command -v python3 >/dev/null 2>&1 || {
  echo "error: 'python3' not found in PATH" >&2
  exit 1
}

[ -f "manifest.json" ] || printf '[]\n' > manifest.json

echo "SnowBirds live display: ${URL}"
if command -v open >/dev/null 2>&1; then
  (sleep 1; open "$URL") >/dev/null 2>&1 &
fi

exec python3 -m http.server "$PORT" --bind "$HOST"
