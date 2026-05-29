#!/usr/bin/env bash
# Launches Cortex Code with a scoped allowlist for the SnowBirds workshop.
#
# This is what booth volunteers run at the start of an attendee session
# (instead of plain `cortex`). The --allowed-tools flags pre-approve the
# tools the bird-workshop skill actually needs, so the attendee never sees
# a permission prompt during the 5-phase flow.
#
# Anything OUTSIDE this list still triggers a normal approval prompt — so
# the agent can't surprise-edit files, curl the internet, or run rm. If a
# prompt does show up mid-workshop, that's a signal the agent drifted off
# the skill's intended path; consider tightening SKILL.md.
#
# To add a tool to the allowlist, append it below. Syntax reference:
#   - MCP tool:       mcp__<server>__<tool>
#   - Bash pattern:   "Bash(<command> *)"
#   - File tools:     Read, Edit, Write, Glob, Grep

set -euo pipefail
WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$WORKSPACE"

# Cortex Code has two Snowflake connection concepts:
# - --connection: SQL/session connection used by built-in Snowflake tools.
# - cortexAgentConnectionName: agent-service connection used before the TUI opens.
# Use the known-working Vibe connection for the agent by default so onboarding
# does not fall back to unrelated connections like postcard.
AGENT_CONNECTION="${SNOWBIRDS_AGENT_CONNECTION:-vibecoding}"
SQL_CONNECTION="${SNOWBIRDS_SQL_CONNECTION:-databirds}"

SETTINGS_CONFIG="${WORKSPACE}/.cortex-launch-settings.json"
cat > "$SETTINGS_CONFIG" <<EOF
{
  "cortexAgentConnectionName": "${AGENT_CONNECTION}"
}
EOF

MCP_SERVER_DIR="${WORKSPACE}/.cortex/mcp-server"
if [ ! -d "${MCP_SERVER_DIR}/node_modules" ]; then
  echo "Installing SnowBirds MCP dependencies..."
  (cd "$MCP_SERVER_DIR" && npm install)
fi

MCP_CONFIG=$(cat <<EOF
{"mcpServers":{"birds":{"command":"node","args":["${WORKSPACE}/.cortex/mcp-server/server.js"],"transport":"stdio","env":{"PROJECT_DIR":"${WORKSPACE}","SNOWFLAKE_CONNECTION":"${SQL_CONNECTION}","SNOWFLAKE_WAREHOUSE":"DATA_BIRDS_WH","SNOWFLAKE_DATABASE":"DATA_BIRDS_DB","SNOWFLAKE_SCHEMA":"AVIARY"}}}}
EOF
)

exec cortex \
  -w "$WORKSPACE" \
  --connection "$SQL_CONNECTION" \
  --config "$SETTINGS_CONFIG" \
  --mcp-config "$MCP_CONFIG" \
  --allowed-tools \
    mcp__birds__start_canvas \
    mcp__birds__check_for_drawing \
    mcp__birds__process_bird \
    mcp__birds__generate_bird_data \
    mcp__birds__push_to_flock \
    "Bash(ls *)" \
    "Bash(cat *)" \
    "Bash(grep *)" \
    "Bash(find *)" \
    "Bash(head *)" \
    "Bash(tail *)" \
    Read \
    "$@"
