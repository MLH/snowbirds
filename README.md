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
- **Snowflake CLI** (`snow`) — install with `brew install snowflake-cli` or `pip install snowflake-cli`, then configure a connection in `~/.snowflake/connections.toml`

## Quick Start

### Per workshop laptop

```bash
git clone https://github.com/YOUR_ORG/SnowBirds && cd SnowBirds
./setup-laptop.sh         # writes ~/.snowflake/config.toml, .env, registers MCP server, smoke-tests
cortex
```

When `cortex` opens, type `$bird-workshop` to activate the workshop skill — the agent will take it from there.

That's it. `rsa_key.p8` ships in the repo (this is a private repo with a workshop-scoped credential — see "Rotating the booth keypair" below).

### One-time per Snowflake account (facilitator, before the event)

```bash
snow sql -f setup.sql   # as ACCOUNTADMIN — creates warehouse, DB, FLOCK table, DATA_BIRDS_USER, registers public key
```

### Auth model

Every booth laptop authenticates as the same `DATA_BIRDS_USER` via the same RSA private key. No password (no rotation drift, no password-policy rejections), no browser flow (no per-attendee OAuth popups), no MFA prompts.

### Rotating the booth keypair

The private key is committed to the repo, so anyone with repo access (current or future) can use the booth credential. After each event, rotate:

```bash
# 1. Generate a fresh keypair
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out rsa_key.p8 -nocrypt
openssl rsa -in rsa_key.p8 -pubout -out rsa_key.pub

# 2. Copy the new public key body (between BEGIN/END PUBLIC KEY, no newlines)
#    into setup.sql's ALTER USER ... SET RSA_PUBLIC_KEY = '...'

# 3. Push the new key to Snowflake (zero-downtime — Snowflake supports two active
#    public keys per user via RSA_PUBLIC_KEY + RSA_PUBLIC_KEY_2)
snow sql -f setup.sql

# 4. Commit + push the updated rsa_key.p8 / rsa_key.pub / setup.sql
git add rsa_key.p8 rsa_key.pub setup.sql && git commit -m "Rotate booth keypair"
```

Old git history still contains the old key — if you need to invalidate it fully, run `ALTER USER DATA_BIRDS_USER UNSET RSA_PUBLIC_KEY` after laptops are off the old key.

## Architecture

```
SnowBirds/
├── .cortex/                     ← Cortex Code CLI project config
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
├── setup-laptop.sh              ← Per-laptop booth setup (keypair config, MCP registration, smoke test)
├── setup-mcp.sh                 ← (legacy) MCP-only registration if you already have Snowflake configured
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
