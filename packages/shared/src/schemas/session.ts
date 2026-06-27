import { z } from "zod";

export const SessionType = z.enum(["video", "presentation"]);
export type SessionType = z.infer<typeof SessionType>;

export const ImageProviderTier = z.enum([
  "openai",
  "gemini-nano",
  "gemini-flash",
  "gemini-pro",
]);
export type ImageProviderTier = z.infer<typeof ImageProviderTier>;

export const RevealTheme = z.enum([
  "white",
  "black",
  "moon",
  "night",
  "sky",
  "beige",
  "simple",
]);
export type RevealTheme = z.infer<typeof RevealTheme>;

export const DEFAULT_STYLE_PROMPT =
  "flat vector illustration, tech aesthetic, blue and white color palette, " +
  "clean lines, minimal shading, no text, no watermarks";

export const DEFAULT_REVEAL_THEME: RevealTheme = "white";
export const DEFAULT_IMAGE_PROVIDER: ImageProviderTier = "openai";

export const Language = z.enum(["en", "zh-Hans"]);
export type Language = z.infer<typeof Language>;

export const Aspect = z.enum(["16x9", "9x16"]);
export type Aspect = z.infer<typeof Aspect>;

export const VideoStyle = z.enum(["cartoon", "whiteboard"]);
export type VideoStyle = z.infer<typeof VideoStyle>;

export const SessionStatus = z.enum([
  "drafting",
  "approved",
  "generating",
  "scene_review",
  "assembling",
  "complete",
  "failed",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const BUDGET_MIN_USD = 1;
export const BUDGET_MAX_USD = 200;

export const CreateSessionInput = z.object({
  title: z.string().min(1).max(200),
  ideaPrompt: z.string().min(1).max(20_000),
  style: VideoStyle,
  language: Language,
  aspect: Aspect,
  voiceId: z.string().min(1),
  budgetUsd: z.number().min(BUDGET_MIN_USD).max(BUDGET_MAX_USD),
});
export type CreateSessionInput = z.infer<typeof CreateSessionInput>;

export const CreatePresentationSessionInput = z.object({
  sessionType: z.literal("presentation"),
  title: z.string().min(1).max(200),
  ideaPrompt: z.string().min(1).max(20_000),
  style: VideoStyle,
  language: Language,
  aspect: Aspect,
  stylePrompt: z.string().min(1).max(2_000).default(DEFAULT_STYLE_PROMPT),
  revealTheme: RevealTheme.default(DEFAULT_REVEAL_THEME),
  imageProvider: ImageProviderTier.default(DEFAULT_IMAGE_PROVIDER),
});
export type CreatePresentationSessionInput =
  z.infer<typeof CreatePresentationSessionInput>;

/** Resolution derived from aspect — 1080p class in both orientations. */
export function resolutionFor(aspect: Aspect): { width: number; height: number } {
  return aspect === "16x9"
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
}

/** Preset narration voices, curated per language (decision D/7). IDs map to
 * ElevenLabs voices in the server's voice provider config. */
export const PRESET_VOICES: Record<Language, { id: string; label: string }[]> = {
  en: [
    { id: "en-narrator-m1", label: "Adam — warm male narrator" },
    { id: "en-narrator-f1", label: "Rachel — clear female narrator" },
    { id: "en-energetic-m1", label: "Josh — energetic male" },
  ],
  "zh-Hans": [
    { id: "zh-narrator-m1", label: "晓辰 — 沉稳男声" },
    { id: "zh-narrator-f1", label: "晓晴 — 清晰女声" },
  ],
};
