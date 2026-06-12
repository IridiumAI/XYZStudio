import type { TranscriptRequest } from "@xyzstudio/shared";

const STYLE_NOTES: Record<string, string> = {
  cartoon:
    "Animated cartoon style: expressive recurring characters, bold shapes, playful motion. Characters introduced early must reappear consistently.",
  whiteboard:
    "Whiteboard explainer style: hand-drawn line art progressively sketched on a white background, with occasional color accents for emphasis.",
};

/** Stable system prompt — keep frozen for prompt caching (design §4.1).
 * Anything per-request goes in the user message, never here. */
export const TRANSCRIPT_SYSTEM_PROMPT = `You are the head writer and storyboard director at a studio that produces short-form animated explainer videos.

You write video transcripts as structured JSON. Each transcript is a sequence of scenes with:
- timestampStart / timestampEnd as "mm:ss" from video start (contiguous: each scene starts where the previous ended; first scene starts at 0:00)
- narration: the exact words the narrator speaks during the scene
- visualDescription: a director's description of what is on screen — composition, characters present, motion, any diagram/chart contents — detailed enough that an animator or image model could produce it without further questions
- sceneClass: one of
  - "diagram": animated technical/architecture diagrams, flows, labeled boxes and arrows
  - "chart": graphs and data visualizations
  - "text": on-screen text reveals, bullet points, quotes
  - "character": a recurring cartoon character acting or talking on screen
  - "cinematic": scene-setting shots, b-roll, sight gags without precise text
  - "hybrid": a character interacting with a diagram/chart

Writing rules:
- Open with a strong hook in the first scene; end with clear closing remarks (and a like/subscribe call to action when the idea asks for one).
- Narration must read naturally aloud; pace ≈ 150 words per minute in English, ≈ 240 characters per minute in Chinese — size each scene's narration to its duration.
- Keep "character" and "cinematic" scenes 10 seconds or shorter (generation constraint). Diagram/chart/text scenes may run longer.
- Reuse the same named characters throughout; describe them identically each time they appear.
- Humor and analogies are welcome when the brief asks for engaging/funny.
- Write narration and all on-screen text in the requested language. For Chinese, use Simplified characters (简体中文).`;

export function transcriptUserPrompt(req: TranscriptRequest): string {
  const styleNote = STYLE_NOTES[req.style] ?? req.style;
  const langNote =
    req.language === "zh-Hans"
      ? "Language: Simplified Chinese (简体中文)."
      : "Language: English.";
  const aspectNote =
    req.aspect === "9x16"
      ? "Vertical 9:16 video (TikTok/Shorts): compose visuals for a tall frame, larger text, single focal point per scene."
      : "Horizontal 16:9 video (YouTube, 1080p).";
  return [
    `Video idea/brief:\n${req.ideaPrompt}`,
    `Visual style: ${styleNote}`,
    langNote,
    aspectNote,
    `Production budget: $${req.targetBudgetUsd} — at low budgets prefer diagram/chart/text scenes; at high budgets character/cinematic scenes are affordable. Always pick the sceneClass that best serves the content, but let the mix lean accordingly.`,
    `Produce the full transcript now.`,
  ].join("\n\n");
}

export function revisionUserPrompt(
  currentTranscriptJson: string,
  feedback: string,
): string {
  return [
    `Here is the current transcript JSON:`,
    currentTranscriptJson,
    `Revise it according to this feedback. Keep everything that the feedback does not ask to change (same scene structure, timestamps and wording wherever untouched). Re-number/re-time scenes only when scenes are added, removed or resized.`,
    `Feedback:\n${feedback}`,
  ].join("\n\n");
}
