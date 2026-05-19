# 🐦 SnowBirds — Powered by Snowflake Cortex

An interactive art installation for tech conferences — draw a bird, let Snowflake Cortex AI animate it, and watch it fly across the big screen!

## How It Works

1. An attendee launches **Cortex Code CLI** (`cortex`) from this project directory
2. The `bird-workshop` skill auto-activates and guides them through:
   - **Drawing** a bird in a browser canvas
   - **Describing** how it should fly
   - **Snowflake Cortex** generates a Bird Passport + CSS flight animation via `CORTEX.COMPLETE()`
   - The bird gets **INSERT'd into a Snowflake table** and appears on the live display

## Prerequisites

- **Snowflake account** with Cortex AI enabled
- **Cortex Code CLI** (`cortex`) installed
- **Node.js 18+** (for the MCP server / canvas)
- **Snowflake CLI** (`snow`) configured with a connection in `~/.snowflake/connections.toml`

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_ORG/SnowBirds
cd SnowBirds

# 2. Run the Snowflake setup SQL (once, as ACCOUNTADMIN)
#    This creates the database, tables, role, and user
snow sql -f setup.sql

# 3. Configure your .env
cp .env.example .env
# Edit .env with your Snowflake account details and RSA key path

# 4. Install MCP server dependencies
cd .cortex-plugin/mcp-server && npm install && cd ../..

# 5. Launch the workshop!
cortex
```

The workshop skill activates automatically and walks the attendee through everything.

## Architecture

```
SnowBirds/
├── .cortex-plugin/              ← Cortex Code CLI plugin
│   ├── plugin.json              ← Plugin manifest (skills + MCP config)
│   ├── hooks/                   ← Session start hook (auto-activates workshop)
│   ├── skills/
│   │   └── bird-workshop/
│   │       └── SKILL.md         ← 5-phase workshop instructions
│   └── mcp-server/
│       ├── server.js            ← MCP server (canvas, Cortex AI, Snowflake)
│       ├── canvas-server.js     ← Local drawing canvas web server
│       ├── canvas.html          ← Browser-based drawing interface
│       ├── bird-processor.js    ← Background removal (Pillow/sharp)
│       └── snowflake-client.js  ← CORTEX.COMPLETE() + FLOCK table ops
├── index.html                   ← Live projected display (reads manifest.json)
├── manifest.json                ← Local bird queue for the display
├── setup.sql                    ← Snowflake environment setup
├── birds/                       ← Submitted bird images
└── .env.example                 ← Environment variable template
```

## The Snowflake Backend

- **`FLOCK` table** — Every bird is a row with AI-generated fields (species, personality, flight animation)
- **`FLOCK_STATS` dynamic table** — Real-time aggregation of flock statistics
- **`CORTEX.COMPLETE()`** — Calls `mistral-large2` to generate bird data + CSS animation
- **RSA key pair auth** — No MFA prompts during the workshop

## Credits

Forked from [MLH/BirdsBirdBirds](https://github.com/MLH/BirdsBirdBirds) (`gemini-cli-skill` branch by Jon).
Adapted for Snowflake Cortex by the team.

made with ♥ and ❄️
