// __tests__/bird-processor.test.js
import { describe, it, expect, afterEach } from "vitest";
import { removeWhiteBackground } from "../bird-processor.js";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(__dirname, "test-processing");

describe("removeWhiteBackground", () => {
  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  it("makes near-white pixels transparent", async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const inputPath = path.join(TEST_DIR, "input.png");
    const outputPath = path.join(TEST_DIR, "output.png");

    // Create a 4x4 test image: top-left 2x2 red, rest white
    const pixels = Buffer.alloc(4 * 4 * 4); // 4x4 RGBA
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        if (x < 2 && y < 2) {
          pixels[i] = 255;     // R
          pixels[i + 1] = 0;   // G
          pixels[i + 2] = 0;   // B
          pixels[i + 3] = 255; // A
        } else {
          pixels[i] = 240;     // R (near-white)
          pixels[i + 1] = 240; // G
          pixels[i + 2] = 240; // B
          pixels[i + 3] = 255; // A
        }
      }
    }

    await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } })
      .png()
      .toFile(inputPath);

    await removeWhiteBackground(inputPath, outputPath);

    // Read output and check that it was cropped (should be ~2x2 now)
    const meta = await sharp(outputPath).metadata();
    expect(meta.width).toBe(2);
    expect(meta.height).toBe(2);

    // Check that the pixels are red and opaque
    const { data } = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(255);   // R
    expect(data[3]).toBe(255);   // A (opaque)
  });
});
