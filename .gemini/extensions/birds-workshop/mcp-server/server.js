// server.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "path";
import { CanvasServer } from "./canvas-server.js";
import { processBird } from "./bird-processor.js";
import { pushToFlock } from "./git-publisher.js";

const PROJECT_DIR = process.env.PROJECT_DIR || process.cwd();
const API_KEY = process.env.GOOGLE_GEMINI_API_KEY || "";

const server = new McpServer({
  name: "birds-workshop",
  version: "1.0.0",
});

let canvasServer = null;

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

    return {
      content: [{ type: "text", text: JSON.stringify({ url }) }],
    };
  }
);

// ── wait_for_drawing ─────────────────────────────────────────
server.registerTool(
  "wait_for_drawing",
  {
    description:
      "Blocks until the user finishes drawing in the canvas and clicks Done. " +
      "Call start_canvas first and show the user the URL before calling this. " +
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
      console.error(`[wait_for_drawing] Returning result to Gemini CLI`);
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
      "Processes a bird drawing: cleans up lines with AI (Gemini 3.1 Flash), " +
      "removes white background, crops, and saves to birds/ directory. " +
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
      await processBird(image_path, outputPath, API_KEY);
      return {
        content: [{ type: "text", text: JSON.stringify({ processed_path: outputPath }) }],
      };
    } catch (err) {
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
      "Pushes a bird to the live display. Checks name/origin for profanity, " +
      "updates manifest.json, and git commits + pushes. Returns success status and display URL.",
    inputSchema: z.object({
      image_path: z.string().describe("Path to the processed bird image (relative to project root, e.g. birds/name.png)"),
      bird_name: z.string().describe("The attendee's name"),
      origin: z.string().describe("Where the attendee is from"),
      animation: z
        .object({
          css_keyframes: z.string(),
          animation_name: z.string(),
          duration: z.string(),
          timing_function: z.string(),
        })
        .describe("Animation object with css_keyframes, animation_name, duration, timing_function"),
    }).shape,
  },
  async ({ image_path, bird_name, origin, animation }) => {
    const result = await pushToFlock({
      imagePath: image_path,
      birdName: bird_name,
      origin,
      animation,
      projectDir: PROJECT_DIR,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
);

// ── Start ────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
