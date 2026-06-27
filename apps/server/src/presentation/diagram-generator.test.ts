import { describe, expect, it, vi } from "vitest";
import type { Scene, SlideGeneratorProvider } from "@xyzstudio/shared";
import { generateDiagramHtml } from "./diagram-generator.js";

const SCENE: Scene = {
  index: 2,
  timestampStart: "1:00",
  timestampEnd: "1:45",
  narration: "Watch how a bubble sort works step by step.",
  visualDescription: "Animated bubble sort with coloured bars.",
  sceneClass: "diagram",
  complexAnimation: true,
};

const SESSION = { presentationStylePrompt: "flat vector illustration, blue palette" };

function fakeProvider(): SlideGeneratorProvider {
  return {
    generateDiagramHtml: vi.fn().mockResolvedValue({
      html: "<!DOCTYPE html><body>GSAP animation</body>",
      costUsd: 0.005,
    }),
    generateSlideHtml: vi.fn(),
    generateCssOverride: vi.fn(),
  };
}

describe("generateDiagramHtml", () => {
  it("returns self-contained HTML", async () => {
    const { html } = await generateDiagramHtml(SCENE, SESSION, fakeProvider());
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });

  it("passes scene to provider", async () => {
    const provider = fakeProvider();
    await generateDiagramHtml(SCENE, SESSION, provider);
    expect(provider.generateDiagramHtml).toHaveBeenCalledWith({
      scene: SCENE,
      presentationStylePrompt: SESSION.presentationStylePrompt,
    });
  });

  it("returns provider cost", async () => {
    const { costUsd } = await generateDiagramHtml(SCENE, SESSION, fakeProvider());
    expect(costUsd).toBeCloseTo(0.005);
  });
});
