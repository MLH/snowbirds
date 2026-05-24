#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$REPO_DIR/.cortex/mcp-server/server.js"

if ! command -v cortex >/dev/null 2>&1; then
  echo "error: 'cortex' CLI not found in PATH" >&2
  exit 1
fi

if [ ! -f "$SERVER" ]; then
  echo "error: MCP server not found at $SERVER" >&2
  exit 1
fi

if [ ! -d "$(dirname "$SERVER")/node_modules" ]; then
  echo "Installing MCP server dependencies..."
  (cd "$(dirname "$SERVER")" && npm install)
fi

if [ ! -f "$REPO_DIR/.env" ] && [ -f "$REPO_DIR/.env.example" ]; then
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  echo "Created .env from .env.example."
fi

cortex mcp remove birds >/dev/null 2>&1 || true
cortex mcp add birds node "$SERVER" -e "PROJECT_DIR=$REPO_DIR"

echo "Registered 'birds' MCP server with cortex CLI."
cortex mcp get birds
