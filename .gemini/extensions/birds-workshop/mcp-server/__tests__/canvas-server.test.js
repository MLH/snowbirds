import { describe, it, expect, afterEach } from "vitest";
import { CanvasServer } from "../canvas-server.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_BIRDS_DIR = path.join(__dirname, "test-birds");

describe("CanvasServer", () => {
  let server;

  afterEach(async () => {
    if (server) await server.stop();
    if (fs.existsSync(TEST_BIRDS_DIR)) {
      fs.rmSync(TEST_BIRDS_DIR, { recursive: true });
    }
  });

  it("starts on a random port and serves canvas.html at /", async () => {
    server = new CanvasServer({ birdsDir: TEST_BIRDS_DIR });
    const { port } = await server.start();
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Draw Your Bird");
  });

  it("accepts a POST to /submit and resolves the drawing promise", async () => {
    server = new CanvasServer({ birdsDir: TEST_BIRDS_DIR });
    const { port } = await server.start();

    const drawingPromise = server.waitForDrawing(10);

    // Simulate the canvas POST with a small PNG
    const form = new FormData();
    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    form.append("image", new Blob([pngBuffer], { type: "image/png" }), "bird.png");
    form.append("bird_name", "Testy");
    form.append("origin", "Testville");

    await fetch(`http://localhost:${port}/submit`, {
      method: "POST",
      body: form,
    });

    const result = await drawingPromise;
    expect(result.bird_name).toBe("Testy");
    expect(result.origin).toBe("Testville");
    expect(fs.existsSync(result.image_path)).toBe(true);
  });

  it("times out if no drawing is submitted", async () => {
    server = new CanvasServer({ birdsDir: TEST_BIRDS_DIR });
    await server.start();

    await expect(server.waitForDrawing(1)).rejects.toThrow("timeout");
  });
});
