import { describe, expect, it, vi } from "vitest";
import type { Scene, SlideGeneratorProvider } from "@xyzstudio/shared";
import { generateSlideHtml } from "./slide-generator.js";

const BASE_SCENE: Scene = {
  index: 0,
  timestampStart: "0:00",
  timestampEnd: "0:30",
  narration: "Welcome to the show.",
  visualDescription: "A cartoon host waves.",
  sceneClass: "character",
  presentationSlideType: "bullets",
};

const SESSION = {
  presentationStylePrompt: "flat vector illustration",
  style: "cartoon",
};

function fakeProvider(): SlideGeneratorProvider {
  return {
    generateSlideHtml: vi.fn().mockResolvedValue({
      html: "<section><h2>Slide</h2></section>",
      costUsd: 0.002,
    }),
    generateCssOverride: vi.fn(),
    generateDiagramHtml: vi.fn(),
  };
}

describe("generateSlideHtml", () => {
  it("calls provider for a bullets scene", async () => {
    const provider = fakeProvider();
    await generateSlideHtml(BASE_SCENE, SESSION, provider, null);
    expect(provider.generateSlideHtml).toHaveBeenCalledOnce();
  });

  it("injects speaker notes when provider omits them", async () => {
    const provider = fakeProvider();
    const { html } = await generateSlideHtml(BASE_SCENE, SESSION, provider, null);
    expect(html).toContain('<aside class="notes">');
    expect(html).toContain("Welcome to the show.");
  });

  it("does not duplicate notes when provider already includes them", async () => {
    const provider: SlideGeneratorProvider = {
      generateSlideHtml: vi.fn().mockResolvedValue({
        html: '<section><aside class="notes">Already here.</aside></section>',
        costUsd: 0.002,
      }),
      generateCssOverride: vi.fn(),
      generateDiagramHtml: vi.fn(),
    };
    const { html } = await generateSlideHtml(BASE_SCENE, SESSION, provider, null);
    const count = (html.match(/<aside class="notes">/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("returns placeholder and zero cost for complexAnimation scene", async () => {
    const provider = fakeProvider();
    const scene: Scene = { ...BASE_SCENE, complexAnimation: true };
    const { html, costUsd } = await generateSlideHtml(scene, SESSION, provider, null);
    expect(html).toContain("Open animated diagram →");
    expect(html).toContain('href="diagrams/diagram-0.html"');
    expect(costUsd).toBe(0);
    expect(provider.generateSlideHtml).not.toHaveBeenCalled();
  });

  it("placeholder link uses correct scene index", async () => {
    const provider = fakeProvider();
    const scene: Scene = { ...BASE_SCENE, index: 3, complexAnimation: true };
    const { html } = await generateSlideHtml(scene, SESSION, provider, null);
    expect(html).toContain('href="diagrams/diagram-3.html"');
  });

  it("skips provider call for diagram scene with diagramCode", async () => {
    const provider = fakeProvider();
    const scene: Scene = {
      ...BASE_SCENE,
      sceneClass: "diagram",
      presentationSlideType: "diagram",
      diagramCode: "flowchart LR\n  A --> B",
    };
    const { html, costUsd } = await generateSlideHtml(scene, SESSION, provider, null);
    expect(provider.generateSlideHtml).not.toHaveBeenCalled();
    expect(html).toContain("flowchart LR");
    expect(html).toContain('<div class="mermaid">');
    expect(costUsd).toBe(0);
  });

  it("skips provider call for chart scene with diagramCode", async () => {
    const provider = fakeProvider();
    const scene: Scene = {
      ...BASE_SCENE,
      sceneClass: "chart",
      presentationSlideType: "chart",
      diagramCode: "pie\n  A: 30\n  B: 70",
    };
    const { costUsd } = await generateSlideHtml(scene, SESSION, provider, null);
    expect(provider.generateSlideHtml).not.toHaveBeenCalled();
    expect(costUsd).toBe(0);
  });

  it("calls provider for diagram scene without diagramCode", async () => {
    const provider = fakeProvider();
    const scene: Scene = {
      ...BASE_SCENE,
      sceneClass: "diagram",
      presentationSlideType: "diagram",
    };
    await generateSlideHtml(scene, SESSION, provider, null);
    expect(provider.generateSlideHtml).toHaveBeenCalledOnce();
  });

  it("returns provider cost", async () => {
    const provider = fakeProvider();
    const { costUsd } = await generateSlideHtml(BASE_SCENE, SESSION, provider, null);
    expect(costUsd).toBeCloseTo(0.002);
  });
});
