import type { Scene } from "@xyzstudio/shared";

const CDN = {
  revealCss: "https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css",
  revealJs: "https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js",
  mermaidPlugin:
    "https://cdn.jsdelivr.net/npm/reveal.js-mermaid-plugin@2/plugin/mermaid/mermaid.js",
  highlightCss:
    "https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/highlight/monokai.css",
  highlightJs:
    "https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/highlight/highlight.js",
  chartJs: "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js",
  roughNotation:
    "https://cdn.jsdelivr.net/npm/rough-notation@0.6.1/lib/rough-notation.iife.js",
};

export interface AssembleOptions {
  sessionTitle: string;
  revealTheme: string;
  cssOverride: string;
  slides: string[];
  diagramFiles: Map<number, string>;
}

export interface AssembleResult {
  indexHtml: string;
  storyboardJson: string;
}

export function assemblePresentation(
  opts: AssembleOptions,
  scenes: Pick<Scene, "index" | "timestampStart" | "timestampEnd" | "narration">[],
): AssembleResult {
  const { sessionTitle, revealTheme, cssOverride, slides } = opts;
  const themeUrl = `https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/${revealTheme}.css`;

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(sessionTitle)}</title>
  <link rel="stylesheet" href="${CDN.revealCss}" />
  <link rel="stylesheet" href="${themeUrl}" />
  <link rel="stylesheet" href="${CDN.highlightCss}" />
  <style>
${cssOverride}
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
${slides.map(indentSlide).join("\n")}
    </div>
  </div>
  <script src="${CDN.revealJs}"></script>
  <script src="${CDN.mermaidPlugin}"></script>
  <script src="${CDN.highlightJs}"></script>
  <script src="${CDN.chartJs}"></script>
  <script src="${CDN.roughNotation}"></script>
  <script>
    Reveal.initialize({
      hash: true,
      plugins: [RevealMermaid, RevealHighlight],
    });
  </script>
</body>
</html>`;

  const storyboard = scenes.map((s) => ({
    index: s.index,
    timestampStart: s.timestampStart,
    timestampEnd: s.timestampEnd,
    narration: s.narration,
  }));

  return {
    indexHtml,
    storyboardJson: JSON.stringify(storyboard, null, 2),
  };
}

function indentSlide(html: string): string {
  return html
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
