#!/usr/bin/env bash
# Booth laptop setup for SnowBirds.
# Run this ONCE per laptop. Assumes:
#   1. `snow` CLI is installed (brew install snowflake-cli, or pipx install snowflake-cli)
#   2. setup.sql has already been run against the Snowflake account by an admin
#
# rsa_key.p8 (the shared booth private key) ships in the repo — git clone is
# enough, no out-of-band copy needed.
#
# What it does:
#   - Writes a `databirds` connection entry to ~/.snowflake/config.toml
#     (keypair auth pointing at DATA_BIRDS_USER — no password, no browser)
#   - Creates .env from .env.example with SNOWFLAKE_CONNECTION=databirds
#   - Registers the MCP server with the cortex CLI
#   - Smoke-tests the connection end-to-end

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNOW_CONFIG_DIR="${HOME}/.snowflake"
SNOW_CONFIG="${SNOW_CONFIG_DIR}/config.toml"
PRIVATE_KEY="${REPO_DIR}/rsa_key.p8"
CONNECTION_NAME="databirds"
SNOWFLAKE_ACCOUNT="${SNOWFLAKE_ACCOUNT:-ogtostq-ooc82737}"

# ── Preflight ─────────────────────────────────────────────────
command -v snow >/dev/null 2>&1 || {
  echo "error: 'snow' CLI not found. Install with: brew install snowflake-cli" >&2
  exit 1
}
command -v cortex >/dev/null 2>&1 || {
  echo "error: 'cortex' CLI not found in PATH" >&2
  exit 1
}
[ -f "$PRIVATE_KEY" ] || {
  echo "error: private key not found at $PRIVATE_KEY" >&2
  echo "       It should ship with the repo. Re-clone, or regenerate with:" >&2
  echo "         openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out rsa_key.p8 -nocrypt" >&2
  exit 1
}

# Snowflake requires private key files to be readable only by the owner.
chmod 600 "$PRIVATE_KEY"

# ── Write the databirds connection entry ─────────────────────
mkdir -p "$SNOW_CONFIG_DIR"
chmod 700 "$SNOW_CONFIG_DIR"
touch "$SNOW_CONFIG"
chmod 600 "$SNOW_CONFIG"

# Remove any prior [connections.databirds] block, then append the fresh one.
python3 - "$SNOW_CONFIG" "$CONNECTION_NAME" <<'PY'
import re, sys, pathlib
path, name = sys.argv[1], sys.argv[2]
text = pathlib.Path(path).read_text() if pathlib.Path(path).exists() else ""
pattern = re.compile(rf"(?ms)^\[connections\.{re.escape(name)}\].*?(?=^\[|\Z)")
new = pattern.sub("", text).rstrip() + "\n"
pathlib.Path(path).write_text(new if new.strip() else "")
PY

cat >> "$SNOW_CONFIG" <<EOF

[connections.${CONNECTION_NAME}]
account = "${SNOWFLAKE_ACCOUNT}"
user = "DATA_BIRDS_USER"
role = "DATA_BIRDS_ROLE"
warehouse = "DATA_BIRDS_WH"
database = "DATA_BIRDS_DB"
schema = "AVIARY"
authenticator = "SNOWFLAKE_JWT"
private_key_file = "${PRIVATE_KEY}"
EOF

echo "✓ Added '${CONNECTION_NAME}' connection to ${SNOW_CONFIG}"

# ── .env ──────────────────────────────────────────────────────
if [ ! -f "$REPO_DIR/.env" ] && [ -f "$REPO_DIR/.env.example" ]; then
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
fi
# Force SNOWFLAKE_CONNECTION=databirds in .env
if [ -f "$REPO_DIR/.env" ]; then
  if grep -q "^SNOWFLAKE_CONNECTION=" "$REPO_DIR/.env"; then
    sed -i.bak "s|^SNOWFLAKE_CONNECTION=.*|SNOWFLAKE_CONNECTION=${CONNECTION_NAME}|" "$REPO_DIR/.env"
    rm -f "$REPO_DIR/.env.bak"
  else
    echo "SNOWFLAKE_CONNECTION=${CONNECTION_NAME}" >> "$REPO_DIR/.env"
  fi
fi
echo "✓ .env ready (SNOWFLAKE_CONNECTION=${CONNECTION_NAME})"

# ── MCP server ────────────────────────────────────────────────
SERVER="$REPO_DIR/.cortex/mcp-server/server.js"
if [ ! -d "$(dirname "$SERVER")/node_modules" ]; then
  (cd "$(dirname "$SERVER")" && npm install)
fi
cortex mcp remove birds >/dev/null 2>&1 || true
cortex mcp add birds node "$SERVER" >/dev/null
echo "✓ Registered 'birds' MCP server with cortex CLI"

# ── Smoke test ────────────────────────────────────────────────
echo "→ Testing Snowflake connection..."
if snow sql -c "$CONNECTION_NAME" -q "SELECT CURRENT_USER() AS U" --format json >/dev/null 2>&1; then
  echo "✓ Connection works — booth laptop is ready."
else
  echo "✗ Connection test FAILED. Run 'snow sql -c ${CONNECTION_NAME} -q \"SELECT 1\"' to debug." >&2
  exit 1
fi
