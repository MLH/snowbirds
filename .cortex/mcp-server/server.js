// server.js — SnowBirds MCP Server
// Provides tools for the bird workshop: canvas, image processing,
// Cortex AI generation, and Snowflake persistence.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { CanvasServer } from "./canvas-server.js";
import { processBird } from "./bird-processor.js";
import {
  connect,
  generateBirdData,
  insertBird,
  checkProfanity,
} from "./snowflake-client.js";

const PROJECT_DIR = process.env.PROJECT_DIR || process.cwd();

const server = new McpServer({
  name: "snow-birds",
  version: "1.0.0",
});

let canvasServer = null;
let snowflakeConn = null;

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
    return {
      content: [{
        type: "text",
        text: `Canvas server started! IMPORTANT: Tell the user to open this URL in their browser: ${url}\n\nJSON: ${JSON.stringify({ url })}`,
      }],
    };
  }
);

// ── wait_for_drawing ─────────────────────────────────────────
server.registerTool(
  "wait_for_drawing",
  {
    description:
      "Blocks until the user finishes drawing in the canvas and clicks Done. " +
      "Call start_canvas first, output the URL as text to the user, then call this tool sequentially (not in parallel). " +
      "Automatically detects when the user clicks Done in the browser — no terminal input needed. " +
      "Returns the saved image path, bird name, and origin.",
    inputSchema: z.object({
      timeout_seconds: z
        .number()
        .optional()
        .describe("Max seconds to wait. Default 300."),
    }).shape,
  },
  async ({ timeout_seconds }) => {
    if (!canvasServer) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Canvas not started. Call start_canvas first." }) }],
      };
    }

    try {
      console.error(`[wait_for_drawing] Blocking until drawing arrives...`);
      const result = await canvasServer.waitForDrawing(timeout_seconds ?? 300);
      console.error(`[wait_for_drawing] Drawing received! Stopping canvas server...`);
      await canvasServer.stop();
      canvasServer = null;
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (err) {
      await canvasServer.stop();
      canvasServer = null;
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      };
    }
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
      // Lazy-connect to Snowflake
      if (!snowflakeConn) {
        console.error("[generate_bird_data] Connecting to Snowflake...");
        snowflakeConn = await connect();
        console.error("[generate_bird_data] Connected!");
      }

      console.error("[generate_bird_data] Calling CORTEX.COMPLETE()...");
      const birdData = await generateBirdData(snowflakeConn, {
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
      // Lazy-connect to Snowflake
      if (!snowflakeConn) {
        console.error("[push_to_flock] Connecting to Snowflake...");
        snowflakeConn = await connect();
        console.error("[push_to_flock] Connected!");
      }

      // Determine image filename (relative path in birds/)
      const imageFilename = path.basename(image_path);

      // Insert into Snowflake FLOCK table
      console.error("[push_to_flock] Inserting into FLOCK table...");
      const birdId = await insertBird(snowflakeConn, {
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
        image: `birds/${imageFilename}`,
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
