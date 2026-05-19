// snowflake-client.js
// Handles all Snowflake interactions: Cortex AI calls and FLOCK table operations.
import snowflake from "snowflake-sdk";
import fs from "fs";
import crypto from "crypto";

// Snowflake SDK can be noisy — suppress info logs
snowflake.configure({ logLevel: "ERROR" });

/**
 * Creates a Snowflake connection using RSA key pair auth (no MFA).
 */
export function createConnection() {
  const keyPath = process.env.SNOWFLAKE_PRIVATE_KEY_PATH || "rsa_key.p8";
  const privateKeyData = fs.readFileSync(keyPath, "utf-8");

  return snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USER,
    privateKey: privateKeyData,
    authenticator: "SNOWFLAKE_JWT",
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || "DATA_BIRDS_WH",
    database: process.env.SNOWFLAKE_DATABASE || "DATA_BIRDS_DB",
    schema: process.env.SNOWFLAKE_SCHEMA || "AVIARY",
    role: process.env.SNOWFLAKE_ROLE || "DATA_BIRDS_ROLE",
  });
}

/**
 * Connects and returns a promise-wrapped connection.
 */
export function connect() {
  return new Promise((resolve, reject) => {
    const conn = createConnection();
    conn.connect((err, conn) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });
}

/**
 * Executes a SQL statement and returns all rows.
 */
function executeSQL(conn, sql, binds = []) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds,
      complete: (err, stmt, rows) => {
        if (err) reject(err);
        else resolve(rows);
      },
    });
  });
}

/**
 * Calls CORTEX.COMPLETE() to generate bird passport data + CSS animation.
 * Returns the parsed JSON response.
 */
export async function generateBirdData(conn, { artistName, originCity, flightDescription }) {
  const prompt = `You are a whimsical ornithologist AND a CSS animation expert. An attendee at a tech conference drew a bird and described its flight as: "${flightDescription}"

The artist's name is "${artistName}" and they are from "${originCity}".

Generate a JSON object with these exact keys:

BIRD PASSPORT DATA:
- "species": a creative species name for this bird (can be fictional/fun)
- "flight_style": one of: "soaring", "gliding", "darting", "fluttering", "swooping", "hovering"
- "speed_kmh": a number between 10 and 200 (match the bird's personality)
- "altitude": one of: "treetop", "mid-sky", "cloud-level", "stratosphere"
- "personality": a fun 1-sentence personality trait for this bird
- "fun_fact": a witty 1-sentence fact about this bird species
- "latitude": approximate latitude of ${originCity} as a float
- "longitude": approximate longitude of ${originCity} as a float

CSS ANIMATION DATA:
- "animation": an object with these exact keys:
  - "css_keyframes": a CSS @keyframes rule string. The animation MUST start at translate(-20vw, Y) and end at translate(120vw, Y) where Y is a random height between 10vh and 90vh. Use at least 5 keyframe stops (0%, 25%, 50%, 75%, 100%) with varying heights and rotation angles. Make the flight path match the description: "${flightDescription}". Use a unique animation name like fly_XXXX where XXXX is a unique 4-letter word.
  - "animation_name": the name of the @keyframes rule (must match what's in css_keyframes)
  - "duration": between "12s" and "22s"
  - "timing_function": an appropriate CSS timing function (e.g. "ease-in-out", "linear")

Return ONLY valid JSON. No markdown, no explanation, no code fences.`;

  const sql = `SELECT SNOWFLAKE.CORTEX.COMPLETE('mistral-large2', ?) AS response`;
  const rows = await executeSQL(conn, sql, [prompt]);
  const raw = rows[0].RESPONSE;

  // Parse — strip markdown fences if Cortex added them
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    const parts = cleaned.split("```");
    if (parts.length >= 2) cleaned = parts[1];
    if (cleaned.startsWith("json")) cleaned = cleaned.slice(4);
    cleaned = cleaned.strip ? cleaned.strip() : cleaned.trim();
  }

  return JSON.parse(cleaned);
}

/**
 * Inserts a bird record into the FLOCK table.
 */
export async function insertBird(conn, birdData) {
  const birdId = "bird_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  const sql = `
    INSERT INTO FLOCK (
      BIRD_ID, ARTIST_NAME, ORIGIN_CITY, LATITUDE, LONGITUDE,
      BIRD_DESCRIPTION, SPECIES, FLIGHT_STYLE, SPEED_KMH,
      ALTITUDE, PERSONALITY, FUN_FACT, IMAGE_FILENAME, ANIMATION_JSON
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?))
  `;

  await executeSQL(conn, sql, [
    birdId,
    birdData.artistName,
    birdData.originCity,
    birdData.latitude || 37.7749,
    birdData.longitude || -122.4194,
    birdData.flightDescription || "",
    birdData.species || "Mystery Bird",
    birdData.flightStyle || "gliding",
    birdData.speedKmh || 50,
    birdData.altitude || "mid-sky",
    birdData.personality || "A free spirit",
    birdData.funFact || "Every bird is unique!",
    birdData.imageFilename || "",
    JSON.stringify(birdData.animation || {}),
  ]);

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
