// snowflake-client.js
// Talks to Snowflake via the `snow` CLI (Snowflake CLI).
//
// Why: the previous implementation used the snowflake-sdk Node library with
// password auth from .env. That couples every booth laptop to a single shared
// password that drifts whenever the user is rotated in Snowflake. Shelling
// out to `snow` instead reuses whatever connection the user already configured
// in ~/.snowflake/config.toml (OAuth, password, keypair — all handled by snow).
//
// Connection selection: SNOWFLAKE_CONNECTION env var, else snow's default.
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const CONNECTION_NAME = process.env.SNOWFLAKE_CONNECTION || null;
const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE || "DATA_BIRDS_WH";
const DATABASE = process.env.SNOWFLAKE_DATABASE || "DATA_BIRDS_DB";
const SCHEMA = process.env.SNOWFLAKE_SCHEMA || "AVIARY";
const FLOCK_TABLE = `${DATABASE}.${SCHEMA}.FLOCK`;

/**
 * Runs a SQL statement via `snow sql -i --format json` and returns parsed rows.
 * SQL is piped through stdin so we don't have to escape user content for argv.
 * Bind variables aren't supported by the CLI the same way the SDK does them —
 * caller must safely interpolate values (use snowQuote() for strings).
 */
export function executeSQL(sql) {
  return new Promise((resolve, reject) => {
    const args = ["sql", "-i", "--format", "json"];
    if (CONNECTION_NAME) args.push("-c", CONNECTION_NAME);

    // Prepend a USE WAREHOUSE so the session has compute even when the
    // connection's default warehouse is unset (e.g. OAuth Cortex connections).
    const fullSQL = `USE WAREHOUSE ${WAREHOUSE};\n${sql}`;

    const child = spawn("snow", args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("error", (err) => reject(new Error(`snow CLI not available: ${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`snow sql failed (exit ${code}): ${stderr.trim() || stdout.trim()}`));
        return;
      }
      try {
        const start = stdout.indexOf("[");
        const json = start >= 0 ? stdout.slice(start) : stdout;
        const parsed = JSON.parse(json);
        // Multi-statement input (USE WAREHOUSE + actual query) returns an array
        // of result sets. We only care about the last statement's rows — that's
        // the caller's real query.
        const lastResult = Array.isArray(parsed[0]) ? parsed[parsed.length - 1] : parsed;
        resolve(lastResult);
      } catch (err) {
        reject(new Error(`Failed to parse snow sql output: ${err.message}\nOutput: ${stdout}`));
      }
    });

    child.stdin.write(fullSQL);
    child.stdin.end();
  });
}

/** Escapes a string for safe inclusion in a Snowflake SQL literal. */
export function snowQuote(s) {
  if (s === null || s === undefined) return "NULL";
  return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
}

/**
 * Verifies the configured snow connection works. Throws a clear error if not.
 */
export async function verifyConnection() {
  const rows = await executeSQL("SELECT CURRENT_USER() AS U, CURRENT_ACCOUNT() AS A");
  return rows[0];
}

/**
 * Calls CORTEX.COMPLETE() to generate bird passport data + CSS animation.
 */
export async function generateBirdData({ artistName, originCity, flightDescription }) {
  const prompt = `You are a whimsical ornithologist AND a CSS animation expert. An attendee at a tech conference drew a bird and described its flight as: "${flightDescription}"

The artist's name is "${artistName}" and they are from "${originCity}".

Return a single JSON object with EXACTLY these top-level keys (no grouping, no nesting, no section headers):
- "species": a creative species name (can be fictional/fun)
- "flight_style": one of: "soaring", "gliding", "darting", "fluttering", "swooping", "hovering"
- "speed_kmh": a number between 10 and 200
- "altitude": one of: "treetop", "mid-sky", "cloud-level", "stratosphere"
- "personality": a fun 1-sentence personality trait
- "fun_fact": a witty 1-sentence fact about this bird species
- "latitude": approximate latitude of ${originCity} as a float
- "longitude": approximate longitude of ${originCity} as a float
- "animation": an object with EXACTLY these keys:
  - "css_keyframes": a CSS @keyframes rule string. MUST start at translate(-20vw, Y) and end at translate(120vw, Y) where Y is a random height between 10vh and 90vh. Use 5 keyframe stops (0%, 25%, 50%, 75%, 100%) with varying heights and rotation angles. Match the description: "${flightDescription}". Use a unique animation name like fly_XXXX where XXXX is a 4-letter word.
  - "animation_name": the @keyframes name (must match the one inside css_keyframes)
  - "duration": between "12s" and "22s"
  - "timing_function": a CSS timing function (e.g. "ease-in-out", "linear")

Example shape (values are placeholders):
{"species":"...","flight_style":"...","speed_kmh":50,"altitude":"...","personality":"...","fun_fact":"...","latitude":0.0,"longitude":0.0,"animation":{"css_keyframes":"...","animation_name":"fly_abcd","duration":"15s","timing_function":"ease-in-out"}}

Return ONLY the JSON object. No markdown, no explanation, no code fences, no grouping keys.`;

  const sql = `SELECT SNOWFLAKE.CORTEX.COMPLETE('mistral-large2', ${snowQuote(prompt)}) AS response`;
  const rows = await executeSQL(sql);
  const raw = rows[0].RESPONSE;

  // Strip ```json fences if Cortex added them.
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }

  return JSON.parse(cleaned);
}

/**
 * Inserts a bird record into the FLOCK table.
 */
export async function insertBird(birdData) {
  const birdId = "bird_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  const sql = `
    INSERT INTO ${FLOCK_TABLE} (
      BIRD_ID, ARTIST_NAME, ORIGIN_CITY, LATITUDE, LONGITUDE,
      BIRD_DESCRIPTION, SPECIES, FLIGHT_STYLE, SPEED_KMH,
      ALTITUDE, PERSONALITY, FUN_FACT, IMAGE_FILENAME, ANIMATION_JSON
    )
    SELECT
      ${snowQuote(birdId)},
      ${snowQuote(birdData.artistName)},
      ${snowQuote(birdData.originCity)},
      ${Number(birdData.latitude ?? 37.7749)},
      ${Number(birdData.longitude ?? -122.4194)},
      ${snowQuote(birdData.flightDescription || "")},
      ${snowQuote(birdData.species || "Mystery Bird")},
      ${snowQuote(birdData.flightStyle || "gliding")},
      ${Number(birdData.speedKmh ?? 50)},
      ${snowQuote(birdData.altitude || "mid-sky")},
      ${snowQuote(birdData.personality || "A free spirit")},
      ${snowQuote(birdData.funFact || "Every bird is unique!")},
      ${snowQuote(birdData.imageFilename || "")},
      PARSE_JSON(${snowQuote(JSON.stringify(birdData.animation || {}))})
  `;

  await executeSQL(sql);
  return birdId;
}

/**
 * Checks text for profanity using PurgoMalum API.
 */
export async function checkProfanity(text) {
  if (!text) return true;
  try {
    const url = "https://www.purgomalum.com/service/containsprofanity?text=" + encodeURIComponent(text);
    const res = await fetch(url);
    const body = await res.text();
    return body.trim() === "false";
  } catch {
    return true; // allow on API failure
  }
}
