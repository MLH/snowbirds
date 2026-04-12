// bird-processor.js
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const CLEANUP_PROMPT =
  "Clean up the lines of this bird drawing, keeping the original hand-drawn style exactly as it is. " +
  "OUTPUT THE IMAGE ON A SOLID PURE WHITE BACKGROUND. " +
  "DO NOT attempt to make the background transparent, and DO NOT add a fake checkered background!";

/**
 * Calls Gemini to clean up the bird drawing, then removes the white background.
 * Falls back to background-removal-only if the AI call fails.
 */
export async function processBird(inputPath, outputPath, apiKey) {
  let imageToProcess = inputPath;

  // Phase 1: AI cleanup (best-effort)
  if (apiKey) {
    try {
      const cleanedPath = inputPath.replace(/\.png$/i, "_cleaned.png");
      await cleanupWithGemini(inputPath, cleanedPath, apiKey);
      imageToProcess = cleanedPath;
    } catch (err) {
      console.error("AI cleanup failed, falling back to raw image:", err.message);
    }
  }

  // Phase 2: Programmatic background removal
  await removeWhiteBackground(imageToProcess, outputPath);

  // Clean up intermediate file
  if (imageToProcess !== inputPath && fs.existsSync(imageToProcess)) {
    fs.unlinkSync(imageToProcess);
  }

  return outputPath;
}

/**
 * Uses Gemini image generation to clean up drawing lines.
 */
async function cleanupWithGemini(inputPath, outputPath, apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-image-preview" });

  const imageData = fs.readFileSync(inputPath);
  const base64Image = imageData.toString("base64");

  const result = await model.generateContent([
    { text: CLEANUP_PROMPT },
    { inlineData: { mimeType: "image/png", data: base64Image } },
  ]);

  const response = result.response;
  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData?.mimeType?.startsWith("image/")
  );

  if (!imagePart) {
    throw new Error("Gemini did not return an image");
  }

  const outputBuffer = Buffer.from(imagePart.inlineData.data, "base64");
  fs.writeFileSync(outputPath, outputBuffer);
}

/**
 * Removes near-white pixels (R,G,B all > 235) by setting alpha to 0,
 * then crops to the bounding box of remaining content.
 */
export async function removeWhiteBackground(inputPath, outputPath) {
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
}
