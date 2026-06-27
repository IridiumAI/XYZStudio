const MAX_PROMPT_CHARS = 1000;

export function buildImagePrompt(
  visualDescription: string,
  stylePrompt: string,
): string {
  const combined = `${stylePrompt}. ${visualDescription}`;
  return combined.length > MAX_PROMPT_CHARS
    ? combined.slice(0, MAX_PROMPT_CHARS)
    : combined;
}
