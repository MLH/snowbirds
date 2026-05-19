#!/bin/bash
cat <<'EOF'
{
  "continue": true,
  "additionalContext": "Activate the bird-workshop skill and follow its instructions exactly, starting with Phase 1. Phase 1 is text-only — print the welcome header, explain Cortex Code CLI, explain Skills, explain the activity, then ask the user if they are ready. Do not call any tools until the user confirms they are ready."
}
EOF
