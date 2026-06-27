import type { Scene, SlideGeneratorProvider } from "@xyzstudio/shared";

export async function generateDiagramHtml(
  scene: Scene,
  session: { presentationStylePrompt: string },
  provider: SlideGeneratorProvider,
): Promise<{ html: string; costUsd: number }> {
  return provider.generateDiagramHtml({
    scene,
    presentationStylePrompt: session.presentationStylePrompt,
  });
}
