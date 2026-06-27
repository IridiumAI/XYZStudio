import { z } from "zod";

/** What the scene visually is — drives the rendering path (design §4.2). */
export const SceneClass = z.enum([
  "diagram",
  "chart",
  "text",
  "character",
  "cinematic",
  "hybrid",
]);
export type SceneClass = z.infer<typeof SceneClass>;

/** How the scene will be rendered — assigned by the budget router (§4.4). */
export const RenderPath = z.enum([
  "remotion",
  "gen_video",
  "animatic",
  "hybrid",
  "presentation",      // Reveal.js slide HTML
  "animated_diagram",  // standalone HTML animation file
]);
export type RenderPath = z.infer<typeof RenderPath>;

export const SceneReviewStatus = z.enum(["pending", "approved", "regenerate"]);
export type SceneReviewStatus = z.infer<typeof SceneReviewStatus>;

export const PresentationSlideType = z.enum([
  "title",
  "bullets",
  "diagram",
  "chart",
  "image",
  "code",
  "split",
  "timeline",
]);
export type PresentationSlideType = z.infer<typeof PresentationSlideType>;

/** A single scene as produced by the LLM (structured output schema).
 * Keep this minimal and JSON-schema-friendly: no refinements/transforms,
 * additionalProperties false is applied by the SDK helper. */
export const Scene = z.object({
  index: z.number().int(),
  /** "mm:ss" from video start. */
  timestampStart: z.string().regex(/^\d{1,3}:\d{2}$/),
  timestampEnd: z.string().regex(/^\d{1,3}:\d{2}$/),
  /** Spoken narration for this scene, in the session language. */
  narration: z.string(),
  /** Director's description of what is on screen: composition, motion,
   * characters present, any animation. Detailed enough to drive generation. */
  visualDescription: z.string(),
  sceneClass: SceneClass,
  /** Presentation mode: slide layout type. Assigned by LLM; user-overridable. */
  presentationSlideType: PresentationSlideType.optional(),
  /** Presentation mode: user opt-in for a standalone animated diagram file. */
  complexAnimation: z.boolean().optional(),
  /** Presentation mode: Mermaid/Chart.js code emitted directly by the LLM. */
  diagramCode: z.string().optional(),
});
export type Scene = z.infer<typeof Scene>;

/** Full transcript — the LLM's structured output for generation/revision. */
export const Transcript = z.object({
  /** Working title for the video (may differ from session title). */
  title: z.string(),
  /** One-line logline of the video's angle. */
  logline: z.string(),
  scenes: z.array(Scene),
});
export type Transcript = z.infer<typeof Transcript>;

export const TranscriptVersionSource = z.enum([
  "generated",
  "user_edit",
  "llm_revision",
]);
export type TranscriptVersionSource = z.infer<typeof TranscriptVersionSource>;

/** Parse "mm:ss" to seconds. Returns null when malformed. */
export function timestampToSeconds(ts: string): number | null {
  const m = /^(\d{1,3}):(\d{2})$/.exec(ts);
  if (!m) return null;
  const mins = Number(m[1]);
  const secs = Number(m[2]);
  if (secs >= 60) return null;
  return mins * 60 + secs;
}

export function sceneDurationSeconds(scene: Pick<Scene, "timestampStart" | "timestampEnd">): number | null {
  const start = timestampToSeconds(scene.timestampStart);
  const end = timestampToSeconds(scene.timestampEnd);
  if (start === null || end === null || end < start) return null;
  return end - start;
}

/** YouTube chapter list from scene timestamps (design §1): first chapter
 * forced to 0:00; chapters shorter than 10s are merged into the previous one;
 * YouTube needs >= 3 chapters to render them. Returns "" when not viable. */
export function youtubeChapterList(
  scenes: Pick<Scene, "timestampStart" | "narration">[],
  chapterTitles: string[],
): string {
  if (scenes.length === 0 || scenes.length !== chapterTitles.length) return "";
  const entries: { start: number; title: string }[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const start = i === 0 ? 0 : timestampToSeconds(scenes[i]!.timestampStart);
    if (start === null) return "";
    const title = chapterTitles[i]!.trim();
    const prev = entries[entries.length - 1];
    if (prev && start - prev.start < 10) continue; // merge short chapters
    entries.push({ start, title });
  }
  if (entries.length < 3) return "";
  return entries
    .map((e) => {
      const mins = Math.floor(e.start / 60);
      const secs = e.start % 60;
      return `${mins}:${String(secs).padStart(2, "0")} ${e.title}`;
    })
    .join("\n");
}
