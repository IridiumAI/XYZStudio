import type { Scene, SlideGeneratorProvider } from "@xyzstudio/shared";

export interface SlideGeneratorSession {
  presentationStylePrompt: string;
  style: string;
}

function placeholderSlide(scene: Scene): string {
  const title = scene.visualDescription.slice(0, 80);
  return [
    `<section>`,
    `  <h3>${escapeHtml(title)}</h3>`,
    `  <p>Animated diagram for this scene.</p>`,
    `  <a href="diagrams/diagram-${scene.index}.html" target="_blank">Open animated diagram →</a>`,
    `  <aside class="notes">${escapeHtml(scene.narration)}</aside>`,
    `</section>`,
  ].join("\n");
}

function wrapMermaid(code: string, narration: string): string {
  return [
    `<section>`,
    `  <div class="mermaid">${escapeHtml(code)}</div>`,
    `  <aside class="notes">${escapeHtml(narration)}</aside>`,
    `</section>`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function generateSlideHtml(
  scene: Scene,
  session: SlideGeneratorSession,
  provider: SlideGeneratorProvider,
  imageAssetPath: string | null,
): Promise<{ html: string; costUsd: number }> {
  // Complex scenes always get a placeholder — no LLM call needed.
  if (scene.complexAnimation) {
    return { html: placeholderSlide(scene), costUsd: 0 };
  }

  // Diagram/chart scenes with pre-emitted code bypass the slide LLM call.
  const slideType = scene.presentationSlideType ?? "bullets";
  if (
    (slideType === "diagram" || slideType === "chart") &&
    scene.diagramCode
  ) {
    return { html: wrapMermaid(scene.diagramCode, scene.narration), costUsd: 0 };
  }

  const result = await provider.generateSlideHtml({
    scene,
    sessionStyle: session.style,
    presentationStylePrompt: session.presentationStylePrompt,
  });

  // Ensure speaker notes from narration are always present. If the provider
  // already included them, this is a no-op; otherwise inject them.
  const html = result.html.includes("<aside class=\"notes\">")
    ? result.html
    : result.html.replace(
        "</section>",
        `  <aside class="notes">${escapeHtml(scene.narration)}</aside>\n</section>`,
      );

  return { html, costUsd: result.costUsd };
}
