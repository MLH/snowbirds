#!/usr/bin/env bash
# Launches the SnowBirds live display for the projected big screen.

set -euo pipefail

WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$WORKSPACE"

PORT="${SNOWBIRDS_DISPLAY_PORT:-8765}"
HOST="${SNOWBIRDS_DISPLAY_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}/index.html"
SYNC_INTERVAL="${SNOWBIRDS_DISPLAY_SYNC_INTERVAL:-5}"

command -v python3 >/dev/null 2>&1 || {
  echo "error: 'python3' not found in PATH" >&2
  exit 1
}

[ -f "manifest.json" ] || printf '[]\n' > manifest.json

SYNC_ENABLED=0
if [ "${SNOWBIRDS_DISPLAY_SYNC:-1}" != "0" ]; then
  SYNC_ENABLED=1
  python3 sync-display-manifest.py --once || true
  python3 sync-display-manifest.py --interval "$SYNC_INTERVAL" &
  SYNC_PID=$!
  trap 'kill "$SYNC_PID" 2>/dev/null || true' EXIT INT TERM
fi

echo "SnowBirds live display: ${URL}"
if command -v open >/dev/null 2>&1; then
  (sleep 1; open "$URL") >/dev/null 2>&1 &
fi

if [ "$SYNC_ENABLED" = "0" ]; then
  exec python3 -m http.server "$PORT" --bind "$HOST"
fi

python3 -m http.server "$PORT" --bind "$HOST" &
SERVER_PID=$!

cleanup() {
  kill "$SYNC_PID" "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait "$SERVER_PID"
