import type { Language, ImageProviderTier } from "../schemas/session.js";
import type { Scene, Transcript } from "../schemas/transcript.js";

/** Provider abstraction layer (design §4.3). One adapter per vendor; adapters
 * are the only code allowed to talk to external AI APIs. Everything above
 * this boundary runs in CI with mock implementations. */

export interface TranscriptRequest {
  ideaPrompt: string;
  style: string;
  language: Language;
  aspect: string;
  targetBudgetUsd: number;
}

export interface ReviseRequest extends TranscriptRequest {
  currentTranscript: Transcript;
  feedback: string;
  priorFeedback: { feedback: string }[];
}

export interface TextResult {
  transcript: Transcript;
  /** Actual LLM cost of this call, for the session cost ledger (§4.4). */
  costUsd: number;
}

export interface TextProvider {
  /** Generate a transcript, streaming raw text deltas via onDelta; resolves
   * with the parsed, schema-valid transcript. */
  generateTranscript(
    req: TranscriptRequest,
    onDelta?: (text: string) => void,
  ): Promise<TextResult>;
  reviseTranscript(
    req: ReviseRequest,
    onDelta?: (text: string) => void,
  ): Promise<TextResult>;
}

export interface ImageProvider {
  generateImage(req: {
    prompt: string;
    stylePrompt: string;
    referenceImagePaths?: string[];
    width: number;
    height: number;
    modelTier?: ImageProviderTier;
  }): Promise<{ filePath: string; costUsd: number }>;
}

export interface SlideGeneratorProvider {
  generateSlideHtml(req: {
    scene: Scene;
    sessionStyle: string;
    presentationStylePrompt: string;
  }): Promise<{ html: string; costUsd: number }>;

  generateCssOverride(
    stylePrompt: string,
  ): Promise<{ css: string; costUsd: number }>;

  generateDiagramHtml(req: {
    scene: Scene;
    presentationStylePrompt: string;
  }): Promise<{ html: string; costUsd: number }>;
}

export interface VideoProvider {
  /** Image→video from a style-locked keyframe (design §4.2). */
  generateClip(req: {
    keyframePath: string;
    motionPrompt: string;
    durationSeconds: number;
    width: number;
    height: number;
  }): Promise<{ filePath: string; costUsd: number }>;
}

export interface VoiceProvider {
  /** Voice cloning later = another voice source behind the same interface. */
  listVoices(language: Language): Promise<{ id: string; label: string }[]>;
  synthesize(req: {
    text: string;
    voiceId: string;
    language: Language;
  }): Promise<{
    filePath: string;
    costUsd: number;
    wordTimestamps: { word: string; startMs: number; endMs: number }[];
  }>;
}
