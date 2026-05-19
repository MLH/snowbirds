// bird-processor.js
// Background removal only — no AI image cleanup (keeping it 100% Snowflake-powered for AI).
import sharp from "sharp";
import fs from "fs";

/**
 * Removes near-white pixels (R,G,B all > 235) by setting alpha to 0,
 * then crops to the bounding box of remaining content.
 */
export async function processBird(inputPath, outputPath) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) {
      data[i + 3] = 0;
    }
  }

  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outputPath);

  return outputPath;
}
