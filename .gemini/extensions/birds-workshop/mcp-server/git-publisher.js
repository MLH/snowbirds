import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const PURGOMALUM_URL = "https://www.purgomalum.com/service/containsprofanity?text=";
const MAX_PUSH_RETRIES = 5;
const DISPLAY_URL = "https://mpsiebert.github.io/BirdsBirdBirds/";

/**
 * Checks text for profanity using PurgoMalum API.
 * Returns true if clean, false if profane. Defaults to true on API failure.
 */
export async function checkProfanity(text) {
  if (!text) return true;
  try {
    const res = await fetch(PURGOMALUM_URL + encodeURIComponent(text));
    const body = await res.text();
    return body.trim() === "false";
  } catch {
    return true; // allow on API failure
  }
}

/**
 * Builds a manifest entry object.
 */
export function buildManifestEntry({ imagePath, birdName, origin, animation }) {
  const id = "bird_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return {
    id,
    image: imagePath,
    bird_name: birdName,
    origin,
    animation,
  };
}

/**
 * Pushes a bird to the flock: validates, updates manifest, commits, pushes.
 */
export async function pushToFlock({ imagePath, birdName, origin, animation, projectDir }) {
  // Profanity check
  const nameClean = await checkProfanity(birdName);
  const originClean = await checkProfanity(origin);
  if (!nameClean || !originClean) {
    return { success: false, error: "profanity" };
  }

  const entry = buildManifestEntry({ imagePath, birdName, origin, animation });
  const manifestPath = path.join(projectDir, "manifest.json");

  // Detect current branch
  let branch = "main";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: projectDir, encoding: "utf-8" }).trim();
  } catch {
    // Fall back to main
  }

  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    try {
      // Reset manifest to avoid conflicts from previous attempt
      execSync("git checkout -- manifest.json", { cwd: projectDir, stdio: "ignore" });
    } catch {
      // May fail if manifest isn't tracked yet — that's fine
    }

    try {
      execSync(`git pull origin ${branch} --rebase`, { cwd: projectDir, stdio: "pipe" });
    } catch {
      // Pull failed — try to proceed anyway
    }

    // Read fresh manifest
    let manifest = [];
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      } catch {
        manifest = [];
      }
    }

    // Remove duplicate by ID, append new entry
    manifest = manifest.filter((b) => b.id !== entry.id);
    manifest.push(entry);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    try {
      execSync("git add manifest.json birds/", { cwd: projectDir, stdio: "pipe" });
      execSync(`git commit -m "Add ${birdName}'s bird 🐦"`, { cwd: projectDir, stdio: "pipe" });
      execSync(`git push origin ${branch}`, { cwd: projectDir, stdio: "pipe" });

      return { success: true, url: DISPLAY_URL };
    } catch {
      // Push failed — undo commit and retry
      try {
        execSync("git reset HEAD~1", { cwd: projectDir, stdio: "ignore" });
      } catch {
        // reset failed — will retry anyway
      }
      if (attempt < MAX_PUSH_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
      }
    }
  }

  return { success: false, error: "push_failed_after_retries" };
}
