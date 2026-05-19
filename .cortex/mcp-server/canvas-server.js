import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANVAS_HTML = path.join(__dirname, "canvas.html");

export class CanvasServer {
  constructor({ birdsDir }) {
    this.birdsDir = birdsDir;
    this.server = null;
    this.port = null;
    this._drawingResolve = null;
    this._drawingReject = null;
    this._bufferedResult = null; // holds result if POST arrives before waitForDrawing
    this.lastDrawing = null; // stores the most recent drawing for non-blocking retrieval
  }

  start() {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(this.birdsDir, { recursive: true });

      this.server = http.createServer((req, res) => {
        if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
          const html = fs.readFileSync(CANVAS_HTML);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(html);
          return;
        }

        if (req.method === "POST" && req.url === "/submit") {
          this._handleSubmit(req, res);
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });

      this.server.listen(0, "127.0.0.1", () => {
        this.port = this.server.address().port;
        resolve({ port: this.port });
      });

      this.server.on("error", reject);
    });
  }

  async _handleSubmit(req, res) {
    try {
      const t0 = Date.now();
      console.error(`[canvas-server] POST /submit received`);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      console.error(`[canvas-server] Body received: ${body.length} bytes in ${Date.now() - t0}ms`);

      // Parse multipart form data manually (minimal, no dep)
      const contentType = req.headers["content-type"] || "";
      const boundary = contentType.split("boundary=")[1];
      if (!boundary) {
        res.writeHead(400);
        res.end("Missing boundary");
        return;
      }

      const parts = parseMultipart(body, boundary);
      const imagePart = parts.find((p) => p.name === "image");
      const birdName = parts.find((p) => p.name === "bird_name")?.value || "Anonymous";
      const origin = parts.find((p) => p.name === "origin")?.value || "Parts Unknown";

      if (!imagePart?.data) {
        res.writeHead(400);
        res.end("Missing image");
        return;
      }

      // Save image
      const filename = `drawing_${Date.now()}.png`;
      const imagePath = path.join(this.birdsDir, filename);
      fs.writeFileSync(imagePath, imagePart.data);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));

      console.error(`[canvas-server] Image saved to ${imagePath} in ${Date.now() - t0}ms`);

      // Store the drawing for non-blocking retrieval
      const result = { image_path: imagePath, bird_name: birdName, origin: origin };
      this.lastDrawing = result;
      console.error(`[canvas-server] Resolving promise at ${Date.now() - t0}ms`);

      // Also resolve the waiting promise if anyone is blocking on it
      if (this._drawingResolve) {
        this._drawingResolve(result);
        this._drawingResolve = null;
        this._drawingReject = null;
      } else {
        this._bufferedResult = result;
      }
    } catch (err) {
      res.writeHead(500);
      res.end("Server error");
    }
  }

  waitForDrawing(timeoutSeconds = 300) {
    // If drawing already arrived before this call, return it immediately
    if (this._bufferedResult) {
      const result = this._bufferedResult;
      this._bufferedResult = null;
      return Promise.resolve(result);
    }

    return new Promise((resolve, reject) => {
      this._drawingResolve = resolve;
      this._drawingReject = reject;

      setTimeout(() => {
        if (this._drawingReject) {
          this._drawingReject(new Error("timeout"));
          this._drawingResolve = null;
          this._drawingReject = null;
        }
      }, timeoutSeconds * 1000);
    });
  }

  getLastDrawing() {
    return this.lastDrawing;
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => this.server.close(resolve));
    }
  }
}

// Minimal multipart parser — no external dependency
function parseMultipart(body, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const segments = splitBuffer(body, boundaryBuf).slice(1); // skip preamble

  for (const segment of segments) {
    const str = segment.toString("latin1");
    if (str.startsWith("--")) break; // closing boundary

    const headerEnd = str.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headers = str.slice(0, headerEnd);
    const dataStart = headerEnd + 4; // skip \r\n\r\n
    // Remove trailing \r\n
    const data = segment.slice(dataStart, segment.length - 2);

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);

    if (filenameMatch) {
      parts.push({ name: nameMatch?.[1], filename: filenameMatch[1], data });
    } else {
      parts.push({ name: nameMatch?.[1], value: data.toString("utf-8") });
    }
  }
  return parts;
}

function splitBuffer(buf, sep) {
  const parts = [];
  let start = 0;
  while (true) {
    const idx = buf.indexOf(sep, start);
    if (idx === -1) {
      parts.push(buf.slice(start));
      break;
    }
    parts.push(buf.slice(start, idx));
    start = idx + sep.length;
  }
  return parts;
}
