import Anthropic from "@anthropic-ai/sdk";
import type { Messages } from "@anthropic-ai/sdk/resources/messages/messages.js";
import {
  Transcript,
  type ReviseRequest,
  type TextProvider,
  type TextResult,
  type TranscriptRequest,
} from "@xyzstudio/shared";
import {
  TRANSCRIPT_SYSTEM_PROMPT,
  revisionUserPrompt,
  transcriptUserPrompt,
} from "../prompts/transcript.js";

const MODEL = "claude-opus-4-8";
// Opus 4.8 pricing per MTok (design §4.1); used for the cost ledger.
const INPUT_USD_PER_MTOK = 5;
const OUTPUT_USD_PER_MTOK = 25;

/** Plain JSON schema for the structured output — avoids the Zod 4 dependency
 * that `zodOutputFormat` from the SDK helper requires. Strict Zod validation
 * is done on the returned text via the shared `Transcript` schema instead. */
const TRANSCRIPT_OUTPUT_FORMAT: Messages.JSONOutputFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      logline: { type: "string" },
      scenes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: { type: "integer" },
            timestampStart: { type: "string" },
            timestampEnd: { type: "string" },
            narration: { type: "string" },
            visualDescription: { type: "string" },
            sceneClass: {
              type: "string",
              enum: ["diagram", "chart", "text", "character", "cinematic", "hybrid"],
            },
          },
          required: [
            "index",
            "timestampStart",
            "timestampEnd",
            "narration",
            "visualDescription",
            "sceneClass",
          ],
        },
      },
    },
    required: ["title", "logline", "scenes"],
  },
};

export class AnthropicTextProvider implements TextProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateTranscript(
    req: TranscriptRequest,
    onDelta?: (text: string) => void,
  ): Promise<TextResult> {
    return this.run(transcriptUserPrompt(req), onDelta);
  }

  async reviseTranscript(
    req: ReviseRequest,
    onDelta?: (text: string) => void,
  ): Promise<TextResult> {
    const prompt = revisionUserPrompt(
      JSON.stringify(req.currentTranscript, null, 2),
      req.feedback,
    );
    return this.run(prompt, onDelta);
  }

  private async run(
    userPrompt: string,
    onDelta?: (text: string) => void,
  ): Promise<TextResult> {
    const stream = this.client.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: TRANSCRIPT_SYSTEM_PROMPT,
          // Frozen system prompt, cached across all transcript calls (§4.1).
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: { format: TRANSCRIPT_OUTPUT_FORMAT },
      messages: [{ role: "user", content: userPrompt }],
    });

    if (onDelta) {
      stream.on("text", (delta) => onDelta(delta));
    }

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new Error("The model declined to generate this transcript.");
    }

    const text = message.content.find((b) => b.type === "text")?.text;
    if (!text) {
      throw new Error(
        `Transcript generation returned no text (stop_reason: ${message.stop_reason}).`,
      );
    }

    // Strict validation (timestamp format etc.) with a readable error.
    const transcript = Transcript.parse(JSON.parse(text));

    const usage = message.usage;
    const inputTokens =
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    const costUsd =
      (inputTokens / 1_000_000) * INPUT_USD_PER_MTOK +
      (usage.output_tokens / 1_000_000) * OUTPUT_USD_PER_MTOK;

    return { transcript, costUsd };
  }
}
