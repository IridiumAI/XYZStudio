import type { SlideGeneratorProvider } from "@xyzstudio/shared";

export async function generateCssOverride(
  stylePrompt: string,
  provider: SlideGeneratorProvider,
): Promise<{ css: string; costUsd: number }> {
  return provider.generateCssOverride(stylePrompt);
}
