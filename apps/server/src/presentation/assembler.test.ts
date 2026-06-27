import { describe, expect, it } from "vitest";
import { assemblePresentation } from "./assembler.js";
import type { Scene } from "@xyzstudio/shared";

const SCENES: Pick<Scene, "index" | "timestampStart" | "timestampEnd" | "narration">[] = [
  { index: 0, timestampStart: "0:00", timestampEnd: "0:30", narration: "Intro narration." },
  { index: 1, timestampStart: "0:30", timestampEnd: "1:00", narration: "Main content." },
];

const BASE_OPTS = {
  sessionTitle: "My Test Presentation",
  revealTheme: "white",
  cssOverride: ":root { --r-background-color: #fff; }",
  slides: [
    "<section><h2>Slide 0</h2></section>",
    "<section><h2>Slide 1</h2></section>",
  ],
  diagramFiles: new Map<number, string>(),
};

describe("assemblePresentation", () => {
  it("includes Reveal.js CDN script", () => {
    const { indexHtml } = assemblePresentation(BASE_OPTS, SCENES);
    expect(indexHtml).toContain("cdn.jsdelivr.net/npm/reveal.js");
  });

  it("includes Mermaid plugin script", () => {
    const { indexHtml } = assemblePresentation(BASE_OPTS, SCENES);
    expect(indexHtml).toContain("mermaid");
  });

  it("includes selected theme stylesheet", () => {
    const { indexHtml } = assemblePresentation(BASE_OPTS, SCENES);
    expect(indexHtml).toContain("/theme/white.css");
  });

  it("uses a different theme when specified", () => {
    const { indexHtml } = assemblePresentation(
      { ...BASE_OPTS, revealTheme: "moon" },
      SCENES,
    );
    expect(indexHtml).toContain("/theme/moon.css");
  });

  it("injects cssOverride after theme stylesheet", () => {
    const { indexHtml } = assemblePresentation(BASE_OPTS, SCENES);
    const themePos = indexHtml.indexOf("/theme/white.css");
    const cssPos = indexHtml.indexOf("--r-background-color");
    expect(themePos).toBeGreaterThan(-1);
    expect(cssPos).toBeGreaterThan(themePos);
  });

  it("includes all slide fragments", () => {
    const { indexHtml } = assemblePresentation(BASE_OPTS, SCENES);
    expect(indexHtml).toContain("Slide 0");
    expect(indexHtml).toContain("Slide 1");
  });

  it("storyboardJson is valid JSON with correct length", () => {
    const { storyboardJson } = assemblePresentation(BASE_OPTS, SCENES);
    const parsed = JSON.parse(storyboardJson) as unknown[];
    expect(parsed).toHaveLength(2);
  });

  it("storyboard entries have required fields", () => {
    const { storyboardJson } = assemblePresentation(BASE_OPTS, SCENES);
    const entries = JSON.parse(storyboardJson) as {
      index: number;
      timestampStart: string;
      timestampEnd: string;
      narration: string;
    }[];
    for (const e of entries) {
      expect(e).toHaveProperty("index");
      expect(e).toHaveProperty("timestampStart");
      expect(e).toHaveProperty("timestampEnd");
      expect(e).toHaveProperty("narration");
    }
  });

  it("diagram file content is not inlined into indexHtml", () => {
    const diagramFiles = new Map([[1, "<!DOCTYPE html><body>GSAP code</body>"]]);
    const { indexHtml } = assemblePresentation({ ...BASE_OPTS, diagramFiles }, SCENES);
    expect(indexHtml).not.toContain("GSAP code");
  });

  it("escapes session title in HTML", () => {
    const { indexHtml } = assemblePresentation(
      { ...BASE_OPTS, sessionTitle: "<script>alert(1)</script>" },
      SCENES,
    );
    expect(indexHtml).not.toContain("<script>alert(1)</script>");
    expect(indexHtml).toContain("&lt;script&gt;");
  });

  it("includes Highlight.js for code scenes", () => {
    const { indexHtml } = assemblePresentation(BASE_OPTS, SCENES);
    expect(indexHtml).toContain("highlight");
  });
});
