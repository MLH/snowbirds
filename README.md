# 🐦 SnowBirds — Powered by Snowflake Cortex

An interactive art installation for tech conferences — draw a bird, let Snowflake Cortex AI animate it, and watch it fly across the big screen!

## How It Works

1. A booth volunteer types `cortex` in a terminal (an alias for `./start-workshop.sh`, installed by `setup-laptop.sh`)
2. The attendee types `$bird-workshop` to activate the workshop skill
3. The skill guides them through five phases:
   - **Draw** a bird in a browser canvas that auto-opens on the booth laptop
   - **Describe** how it should fly
   - **Snowflake Cortex** generates a Bird Passport + CSS flight animation via `CORTEX.COMPLETE()` (`mistral-large2`)
   - The bird gets **INSERT'd into a Snowflake table** and appears on the live projected display

Throughout the flow, the agent narrates what's happening — so attendees walk away understanding Cortex Code, MCP tool use, Snowflake Cortex, and Snowflake itself.

## Prerequisites

- **Snowflake account** with Cortex AI enabled (specifically `mistral-large2`)
- **Cortex Code CLI** (`cortex`) installed
- **Snowflake CLI** (`snow`) installed — `brew install snowflake-cli` or `pipx install snowflake-cli`
- **Node.js 18+** (for the MCP server / canvas)

`setup-laptop.sh` writes the Snowflake connection config for you — you don't need to run `snow connection add` manually.

## Quick Start

### 1. One-time per Snowflake account (facilitator, before the event)

```bash
snow sql -f setup.sql   # as ACCOUNTADMIN — creates warehouse, DB, FLOCK table, DATA_BIRDS_USER, registers public key
```

### 2. Per workshop laptop (one-time per machine)

```bash
git clone https://github.com/YOUR_ORG/SnowBirds && cd SnowBirds
./setup-laptop.sh
```

`setup-laptop.sh` does five things:
1. Adds a `databirds` connection to `~/.snowflake/config.toml` (keypair auth pointing at `DATA_BIRDS_USER`)
2. Creates `.env` from `.env.example`
3. Installs MCP server dependencies and registers the `birds` MCP server with `cortex`
4. Pre-approves the workshop's MCP tools in `~/.snowflake/cortex/permissions.json` so attendees never see permission prompts for `start_canvas`, `push_to_flock`, etc.
5. **Adds an alias to `~/.zshrc` and `~/.bashrc` that shadows `cortex` with `start-workshop.sh`** — so booth volunteers can just type `cortex` and get the scoped allowlist version

Open a new terminal (so the alias loads) and you're done.

### 3. Per attendee session

```bash
cortex                # aliased to start-workshop.sh
```

When cortex opens, the attendee types `$bird-workshop` to activate the skill. The browser canvas auto-opens during Phase 2 — no URL clicking needed.

That's it. `rsa_key.p8` ships in the repo (this is a private repo with a workshop-scoped credential — see "Rotating the booth keypair" below).

## Why the scripts exist

- **`setup-laptop.sh`** — one-time per laptop. Snowflake connection, MCP registration, pre-approvals, shell alias.
- **`start-workshop.sh`** — what the `cortex` alias actually runs. Launches `cortex --allowed-tools ...` with a scoped allowlist: the 5 workshop MCP tools, `Read`, and safe Bash patterns (`ls`, `cat`, `grep`, `find`, `head`, `tail`). Anything outside the list triggers a normal approval prompt — which is your signal the agent drifted off the skill's intended path.
- **`setup-mcp.sh`** — legacy. MCP-only registration. Use `setup-laptop.sh` instead.

## Auth model

Every booth laptop authenticates as the same `DATA_BIRDS_USER` via the same RSA private key. No password (no rotation drift, no password-policy rejections), no browser flow (no per-attendee OAuth popups), no MFA prompts. Combined with the `--allowed-tools` allowlist and the pre-approved MCP cache, attendees should see zero permission prompts during a normal workshop run.

## Rotating the booth keypair

The private key is committed to the repo, so anyone with repo access (current or future) can use the booth credential. After each event:

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
│   ├── skills/
│   │   └── bird-workshop/
│   │       └── SKILL.md         ← 5-phase workshop instructions
│   └── mcp-server/
│       ├── server.js            ← MCP server (canvas, Cortex AI, Snowflake)
│       ├── canvas-server.js     ← Local drawing canvas web server
│       ├── canvas.html          ← Browser-based drawing interface
│       ├── bird-processor.js    ← Background removal (sharp)
│       └── snowflake-client.js  ← Snow CLI wrapper for CORTEX.COMPLETE() + FLOCK ops
├── setup-laptop.sh              ← Per-laptop booth setup (one-time)
├── start-workshop.sh            ← Per-attendee launcher (what the `cortex` alias runs)
├── setup-mcp.sh                 ← (legacy) MCP-only registration
├── setup.sql                    ← Snowflake environment setup (one-time per account)
├── rsa_key.p8                   ← Booth private key (committed; rotate after each event)
├── rsa_key.pub                  ← Booth public key (also in setup.sql)
├── index.html                   ← Live projected display (reads manifest.json)
├── manifest.json                ← Local bird queue for the display
├── birds/                       ← Submitted bird images
├── .env.example                 ← Environment variable template
└── .mcp.json                    ← MCP server registration for the cortex CLI
```

## The Snowflake Backend

- **`FLOCK` table** — Every bird is a row with AI-generated fields (species, personality, flight animation)
- **`FLOCK_STATS` dynamic table** — Real-time aggregation of flock statistics
- **`HOURLY_SUBMISSIONS` dynamic table** — Hourly aggregates for forecasting / anomaly detection
- **`CORTEX.COMPLETE()`** — Calls `mistral-large2` to generate bird data + CSS animation
- **Keypair auth** — `DATA_BIRDS_USER` authenticates via RSA private key; no passwords, no MFA, no OAuth flow

## Credits

Forked from [MLH/BirdsBirdBirds](https://github.com/MLH/BirdsBirdBirds) (`gemini-cli-skill` branch by Jon).
Adapted for Snowflake Cortex by the team.

made with ♥ and ❄️
