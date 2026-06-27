import { describe, expect, it } from "vitest";
import { buildImagePrompt } from "./image-prompt-builder.js";

const STYLE = "flat vector illustration, blue and white";
const DESC = "A cartoon host waves hello to the audience.";

describe("buildImagePrompt", () => {
  it("concatenates style prompt and visual description", () => {
    const result = buildImagePrompt(DESC, STYLE);
    expect(result).toContain(STYLE);
    expect(result).toContain(DESC);
  });

  it("truncates to 1000 characters", () => {
    const longDesc = "A".repeat(1200);
    const result = buildImagePrompt(longDesc, STYLE);
    expect(result.length).toBeLessThanOrEqual(1000);
  });

  it("does not truncate when combined length is under limit", () => {
    const result = buildImagePrompt(DESC, STYLE);
    expect(result.length).toBeLessThan(1000);
  });

  it("uses style prompt when visual description is empty", () => {
    const result = buildImagePrompt("", STYLE);
    expect(result).toContain(STYLE);
  });
});
