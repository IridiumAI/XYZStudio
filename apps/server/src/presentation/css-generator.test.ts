import { describe, expect, it, vi } from "vitest";
import type { SlideGeneratorProvider } from "@xyzstudio/shared";
import { generateCssOverride } from "./css-generator.js";

function fakeProvider(css = ":root { --r-background-color: #fff; }"): SlideGeneratorProvider {
  return {
    generateCssOverride: vi.fn().mockResolvedValue({ css, costUsd: 0.001 }),
    generateSlideHtml: vi.fn(),
    generateDiagramHtml: vi.fn(),
  };
}

describe("generateCssOverride", () => {
  it("returns CSS string from provider", async () => {
    const result = await generateCssOverride("flat vector", fakeProvider());
    expect(result.css).toContain(":root");
  });

  it("passes the style prompt to the provider", async () => {
    const provider = fakeProvider();
    await generateCssOverride("dark neon cyberpunk", provider);
    expect(provider.generateCssOverride).toHaveBeenCalledWith("dark neon cyberpunk");
  });

  it("returns the provider cost", async () => {
    const result = await generateCssOverride("x", fakeProvider());
    expect(result.costUsd).toBeCloseTo(0.001);
  });
});
