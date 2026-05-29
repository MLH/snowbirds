// server.js — SnowBirds MCP Server
// Provides tools for the bird workshop: canvas, image processing,
// Cortex AI generation, and Snowflake persistence.
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Project root is two levels up from this file (.cortex/mcp-server/server.js).
// PROJECT_DIR env var can override (absolute path expected).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = process.env.PROJECT_DIR
  ? path.resolve(process.env.PROJECT_DIR)
  : path.resolve(__dirname, "..", "..");
loadEnv({ path: path.join(PROJECT_DIR, ".env"), quiet: true });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import crypto from "crypto";
import { spawn } from "node:child_process";

// Opens the given URL in the booth laptop's default browser. Best-effort —
// failures are silent so the agent's "click this URL" fallback still works.
function openInBrowser(url) {
  const cmd = process.platform === "darwin" ? "open"
            : process.platform === "win32"  ? "start"
            : "xdg-open";
  try {
    const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
}
import { CanvasServer } from "./canvas-server.js";
import { processBird } from "./bird-processor.js";
import {
  verifyConnection,
  generateBirdData,
  insertBird,
  checkProfanity,
} from "./snowflake-client.js";

const server = new McpServer({
  name: "snow-birds",
  version: "1.0.0",
});

let canvasServer = null;
let snowflakeVerified = false;

function imageDataUrl(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(imagePath).toString("base64")}`;
}

async function ensureSnowflake() {
  if (snowflakeVerified) return;
  const info = await verifyConnection();
  console.error(`[snowflake] Connected as ${info.U} on account ${info.A}`);
  snowflakeVerified = true;
}

// ── start_canvas ─────────────────────────────────────────────
server.registerTool(
  "start_canvas",
  {
    description:
      "Starts a local drawing canvas web server. Returns the URL immediately (non-blocking). " +
      "IMPORTANT: After calling this tool, you MUST show the URL to the user and tell them to " +
      "open it in their browser. Do NOT call any other tool until you have displayed the URL " +
      "to the user and explained what to do. After showing the URL, call wait_for_drawing.",
    inputSchema: z.object({}).shape,
  },
  async () => {
    // Clean up any previous canvas server
    if (canvasServer) {
      try { await canvasServer.stop(); } catch {}
      canvasServer = null;
    }

    const birdsDir = path.join(PROJECT_DIR, "birds");
    canvasServer = new CanvasServer({ birdsDir });
    const { port } = await canvasServer.start();
    const url = `http://localhost:${port}`;

    console.error(`[start_canvas] Canvas server started at ${url}`);
    openInBrowser(url);

    return {
      content: [{
        type: "text",
        text: `Canvas server started and auto-opened in the user's default browser. ` +
              `If the browser didn't pop up, the URL is ${url}. Tell the user the canvas should ` +
              `now be open in their browser and they should draw their bird, fill in name and origin, then click Done.\n\n` +
              `JSON: ${JSON.stringify({ url, auto_opened: true })}`,
      }],
    };
  }
);

// ── check_for_drawing ────────────────────────────────────────
// Non-blocking poll. Returns immediately with status: "waiting"
// or the drawing result. The agent polls this in a loop.
// We deliberately do NOT kill the canvas server on a poll-miss —
// the user is still drawing.
server.registerTool(
  "check_for_drawing",
  {
    description:
      "Non-blocking check for a finished drawing. Returns {status: 'waiting'} if " +
      "the user has not clicked Done yet, or {status: 'ready', image_path, bird_name, origin} " +
      "when they have. Call start_canvas first, then poll this tool every ~5 seconds " +
      "until status is 'ready'. The canvas server stays alive between polls.",
    inputSchema: z.object({}).shape,
  },
  async () => {
    if (!canvasServer) {
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "error", error: "Canvas not started. Call start_canvas first." }) }],
      };
    }

    const drawing = canvasServer.getLastDrawing();
    if (!drawing) {
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "waiting" }) }],
      };
    }

    // Drawing is ready — return it and stop the canvas server (done with this attendee)
    console.error(`[check_for_drawing] Drawing ready, stopping canvas server.`);
    try { await canvasServer.stop(); } catch {}
    canvasServer = null;
    return {
      content: [{ type: "text", text: JSON.stringify({ status: "ready", ...drawing }) }],
    };
  }
);

// ── process_bird ─────────────────────────────────────────────
server.registerTool(
  "process_bird",
  {
    description:
      "Processes a bird drawing: removes white background, crops, and saves to birds/ directory. " +
      "Returns the path to the processed image.",
    inputSchema: z.object({
      image_path: z.string().describe("Path to the raw drawing image"),
    }).shape,
  },
  async ({ image_path }) => {
    const ext = path.extname(image_path);
    const base = path.basename(image_path, ext);
    const outputPath = path.join(PROJECT_DIR, "birds", `${base}_processed.png`);

    try {
      await processBird(image_path, outputPath);
      return {
        content: [{ type: "text", text: JSON.stringify({ processed_path: outputPath }) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message, fallback_path: image_path }) }],
      };
    }
  }
);

// ── generate_bird_data ───────────────────────────────────────
server.registerTool(
  "generate_bird_data",
  {
    description:
      "Calls Snowflake CORTEX.COMPLETE() with the mistral-large2 model to generate " +
      "BOTH a 'Bird Passport' (species, personality, fun fact, etc.) AND a CSS @keyframes " +
      "flight animation — all in one AI call. Returns the complete bird data as JSON.",
    inputSchema: z.object({
      artist_name: z.string().describe("The attendee's name"),
      origin_city: z.string().describe("Where the attendee is from"),
      flight_description: z.string().describe("How the user described their bird's flight style"),
    }).shape,
  },
  async ({ artist_name, origin_city, flight_description }) => {
    try {
      await ensureSnowflake();

      console.error("[generate_bird_data] Calling CORTEX.COMPLETE()...");
      const birdData = await generateBirdData({
        artistName: artist_name,
        originCity: origin_city,
        flightDescription: flight_description,
      });
      console.error("[generate_bird_data] Got response from Cortex!");

      return {
        content: [{ type: "text", text: JSON.stringify(birdData) }],
      };
    } catch (err) {
      console.error("[generate_bird_data] Error:", err.message);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      };
    }
  }
);

// ── push_to_flock ────────────────────────────────────────────
server.registerTool(
  "push_to_flock",
  {
    description:
      "Saves a bird to the live display. Checks name/origin for profanity, " +
      "INSERTs the bird record into the Snowflake FLOCK table (with all passport data " +
      "and animation JSON), and also updates the local manifest.json for the display. " +
      "Returns success status.",
    inputSchema: z.object({
      image_path: z.string().describe("Path to the processed bird image"),
      bird_name: z.string().describe("The attendee's name"),
      origin: z.string().describe("Where the attendee is from"),
      flight_description: z.string().describe("The user's flight description"),
      bird_data: z.object({
        species: z.string(),
        flight_style: z.string(),
        speed_kmh: z.number(),
        altitude: z.string(),
        personality: z.string(),
        fun_fact: z.string(),
        latitude: z.number(),
        longitude: z.number(),
      }).describe("Bird passport data from generate_bird_data"),
      animation: z.object({
        css_keyframes: z.string(),
        animation_name: z.string(),
        duration: z.string(),
        timing_function: z.string(),
      }).describe("Animation data from generate_bird_data"),
    }).shape,
  },
  async ({ image_path, bird_name, origin, flight_description, bird_data, animation }) => {
    // Profanity check
    const nameClean = await checkProfanity(bird_name);
    const originClean = await checkProfanity(origin);
    if (!nameClean || !originClean) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "profanity" }) }],
      };
    }

    try {
      await ensureSnowflake();

      // Determine image filename (relative path in birds/)
      const imageFilename = path.basename(image_path);
      const dataUrl = imageDataUrl(image_path);

      // Insert into Snowflake FLOCK table
      console.error("[push_to_flock] Inserting into FLOCK table...");
      const birdId = await insertBird({
        artistName: bird_name,
        originCity: origin,
        latitude: bird_data.latitude,
        longitude: bird_data.longitude,
        flightDescription: flight_description,
        species: bird_data.species,
        flightStyle: bird_data.flight_style,
        speedKmh: bird_data.speed_kmh,
        altitude: bird_data.altitude,
        personality: bird_data.personality,
        funFact: bird_data.fun_fact,
        imageFilename: imageFilename,
        imageDataUrl: dataUrl,
        animation: animation,
      });
      console.error(`[push_to_flock] Inserted bird ${birdId} into Snowflake!`);

      // Also update local manifest.json for the HTML display
      const manifestPath = path.join(PROJECT_DIR, "manifest.json");
      let manifest = [];
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        } catch {
          manifest = [];
        }
      }

      const entry = {
        id: birdId,
        image: dataUrl,
        bird_name,
        origin,
        species: bird_data.species,
        personality: bird_data.personality,
        animation,
      };
      manifest.push(entry);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            bird_id: birdId,
            message: `${bird_name}'s bird has been saved to Snowflake and added to the display!`,
          }),
        }],
      };
    } catch (err) {
      console.error("[push_to_flock] Error:", err.message);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }],
      };
    }
  }
);

// ── Start ────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

// Fire-and-forget startup check: surface auth problems in the MCP server log
// before the agent even touches a Snowflake tool. Doesn't block startup so
// canvas-only demos still work if Snowflake is unreachable.
ensureSnowflake().catch((err) => {
  console.error(`[snowflake] STARTUP CHECK FAILED: ${err.message}`);
  console.error(`[snowflake] Set SNOWFLAKE_CONNECTION in .env to pick a specific connection from ~/.snowflake/config.toml, or run \`snow connection test\` to debug.`);
});
