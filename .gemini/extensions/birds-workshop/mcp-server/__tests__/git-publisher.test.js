import { describe, it, expect } from "vitest";
import { buildManifestEntry, checkProfanity } from "../git-publisher.js";

describe("buildManifestEntry", () => {
  it("builds a valid manifest entry", () => {
    const entry = buildManifestEntry({
      imagePath: "birds/test_bird.png",
      birdName: "Testy",
      origin: "Testville",
      animation: {
        css_keyframes: "@keyframes fly_test { 0% { transform: translate(-20vw, 50vh); } 100% { transform: translate(120vw, 40vh); } }",
        animation_name: "fly_test",
        duration: "18s",
        timing_function: "ease-in-out",
      },
    });

    expect(entry.id).toMatch(/^bird_[a-f0-9]{8}$/);
    expect(entry.image).toBe("birds/test_bird.png");
    expect(entry.bird_name).toBe("Testy");
    expect(entry.origin).toBe("Testville");
    expect(entry.animation.animation_name).toBe("fly_test");
  });
});

describe("checkProfanity", () => {
  it("returns true for clean text", async () => {
    const result = await checkProfanity("Hello World");
    expect(result).toBe(true);
  }, 15000);

  it("returns false for profane text", async () => {
    const result = await checkProfanity("shit");
    expect(result).toBe(false);
  }, 15000);

  it("returns true for empty text", async () => {
    const result = await checkProfanity("");
    expect(result).toBe(true);
  });
});
