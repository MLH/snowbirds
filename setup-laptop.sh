#!/usr/bin/env bash
# Booth laptop setup for SnowBirds.
# Run this ONCE per laptop. Assumes:
#   1. `snow` CLI is installed (brew install snowflake-cli, or pipx install snowflake-cli)
#   2. setup.sql has already been run against the Snowflake account by an admin
#
# rsa_key.p8 (the shared booth private key) is git-ignored and distributed
# out-of-band — drop it into the repo root before running this script.
#
# What it does:
#   - Writes a `databirds` connection entry to ~/.snowflake/config.toml
#     (keypair auth pointing at DATA_BIRDS_USER — no password, no browser)
#   - Creates .env from .env.example with SNOWFLAKE_CONNECTION=databirds
#   - Registers the MCP server with the cortex CLI
#   - Pre-approves the workshop's MCP tools in ~/.snowflake/cortex/permissions.json
#     so attendees never see a permission prompt
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
  echo "       It is git-ignored and must be copied in out-of-band (1Password / USB)." >&2
  echo "       Ask the booth lead for the current rsa_key.p8." >&2
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
cortex mcp add birds -e "PROJECT_DIR=${REPO_DIR}" node "$SERVER" >/dev/null
echo "✓ Registered 'birds' MCP server with cortex CLI"

# ── Pre-approve workshop tools ───────────────────────────────
# Cortex Code asks the user to approve each MCP tool the first time the agent
# invokes it. For a booth scenario, we pre-seed the approval cache so attendees
# never see those prompts.
#
# Format reference (reverse-engineered from a live cortex session):
#   ~/.snowflake/cortex/permissions.json
#   {
#     "working_dirs": {
#       "<abs path>": {
#         "cache": {
#           "{\"tool_name\":\"mcp__birds__<name>\",\"type\":\"mcp\"}":
#               {"result": "granted", "created_at": "<ISO>"}
#         }
#       }
#     }
#   }
PERMS_FILE="${SNOW_CONFIG_DIR}/cortex/permissions.json"
mkdir -p "$(dirname "$PERMS_FILE")"
python3 - "$PERMS_FILE" "$REPO_DIR" <<'PY'
import json, sys, os, datetime
path, workdir = sys.argv[1], sys.argv[2]
TOOLS = [
    "mcp__birds__start_canvas",
    "mcp__birds__check_for_drawing",
    "mcp__birds__process_bird",
    "mcp__birds__generate_bird_data",
    "mcp__birds__push_to_flock",
]
data = {}
if os.path.exists(path):
    try:
        data = json.loads(open(path).read() or "{}")
    except json.JSONDecodeError:
        data = {}
data.setdefault("working_dirs", {})
data["working_dirs"].setdefault(workdir, {}).setdefault("cache", {})
cache = data["working_dirs"][workdir]["cache"]
now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.datetime.utcnow().microsecond // 1000:03d}Z"
for tool in TOOLS:
    key = json.dumps({"tool_name": tool, "type": "mcp"}, separators=(",", ":"))
    cache[key] = {"result": "granted", "created_at": now}
with open(path, "w") as f:
    json.dump(data, f, indent=2)
PY
echo "✓ Pre-approved workshop MCP tools for ${REPO_DIR}"

# ── Shell alias ──────────────────────────────────────────────
# Installs `birds` as a shortcut for the SnowBirds workshop launcher.
# Idempotent — we wrap the alias in a marked block and replace it in place on
# re-run. Older versions of this setup used this same block to shadow `cortex`,
# so re-running setup also restores `cortex` to the real Cortex Code CLI.
LAUNCHER="${REPO_DIR}/start-workshop.sh"
ALIAS_MARKER="# >>> snowbirds workshop alias >>>"
ALIAS_END="# <<< snowbirds workshop alias <<<"
ALIAS_BLOCK="${ALIAS_MARKER}
# Launches the SnowBirds workshop with a scoped Cortex Code allowlist.
# Remove this block to uninstall the shortcut.
alias birds='${LAUNCHER}'
${ALIAS_END}"

install_alias() {
  local rc="$1"
  [ -f "$rc" ] || touch "$rc"
  # Strip any prior block, then append the fresh one.
  python3 - "$rc" "$ALIAS_MARKER" "$ALIAS_END" "$ALIAS_BLOCK" <<'PY'
import re, sys, pathlib
rc, start, end, block = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
text = pathlib.Path(rc).read_text()
pattern = re.compile(rf"{re.escape(start)}.*?{re.escape(end)}\n?", re.DOTALL)
text = pattern.sub("", text).rstrip() + "\n\n" + block + "\n"
pathlib.Path(rc).write_text(text)
PY
  echo "✓ Installed birds alias in $rc"
}

[ -f "${HOME}/.zshrc" ]  && install_alias "${HOME}/.zshrc"
[ -f "${HOME}/.bashrc" ] && install_alias "${HOME}/.bashrc"

# ── Smoke test ────────────────────────────────────────────────
echo "→ Testing Snowflake connection..."
if snow sql -c "$CONNECTION_NAME" -q "SELECT CURRENT_USER() AS U" --format json >/dev/null 2>&1; then
  echo "✓ Connection works — booth laptop is ready."
  echo ""
  echo "Open a new terminal and type:  birds"
  echo "(or run ./start-workshop.sh directly in this shell)"
else
  echo "✗ Connection test FAILED. Run 'snow sql -c ${CONNECTION_NAME} -q \"SELECT 1\"' to debug." >&2
  exit 1
fi
