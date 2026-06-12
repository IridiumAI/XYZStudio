import type { RenderPath, Scene } from "../schemas/transcript.js";
import { sceneDurationSeconds } from "../schemas/transcript.js";

/** Per-unit provider pricing (design §4.4). Config-driven: replace via
 * `estimateCostPlan(..., { pricing })` as providers change prices.
 * ⚠️ Indicative values — re-verify against provider price pages. */
export interface PricingTable {
  /** $ per generated video second (e.g. Veo-class image→video). */
  genVideoPerSecondUsd: number;
  /** $ per generated image (keyframes, sketches, character sheets). */
  imageUsd: number;
  /** $ per 1K characters of TTS narration. */
  ttsPer1kCharsUsd: number;
  /** Flat LLM overhead per video (transcript + revisions + routing + code). */
  llmFlatUsd: number;
  /** Remotion render cost per scene (compute; effectively free). */
  remotionPerSceneUsd: number;
}

export const DEFAULT_PRICING: PricingTable = {
  genVideoPerSecondUsd: 0.35,
  imageUsd: 0.05,
  ttsPer1kCharsUsd: 0.15,
  llmFlatUsd: 0.75,
  remotionPerSceneUsd: 0.01,
};

export interface SceneRouting {
  sceneIndex: number;
  renderPath: RenderPath;
  /** Best-of-N candidates for gen_video scenes (decision F); 1 otherwise. */
  candidates: number;
  estimatedUsd: number;
}

export interface CostPlan {
  perScene: SceneRouting[];
  /** Voice, style bible, LLM overhead. */
  fixedUsd: number;
  estimatedTotalUsd: number;
  budgetUsd: number;
}

/** Scenes whose class benefits from generative video, by descending benefit:
 * hook (first scene) and character/cinematic moments rank high; diagrams,
 * charts and text are better in Remotion regardless of budget (design §4.2). */
function genVideoBenefit(scene: Scene, sceneCount: number): number {
  let score = 0;
  if (scene.sceneClass === "character") score += 3;
  if (scene.sceneClass === "cinematic") score += 3;
  if (scene.sceneClass === "hybrid") score += 1;
  if (scene.index === 0) score += 2; // the hook
  if (scene.index === sceneCount - 1) score += 1; // closing remarks
  return score;
}

const CHEAP_PATH: Record<Scene["sceneClass"], RenderPath> = {
  diagram: "remotion",
  chart: "remotion",
  text: "remotion",
  hybrid: "hybrid",
  character: "animatic",
  cinematic: "animatic",
};

export interface EstimateOptions {
  pricing?: PricingTable;
}

/** Pure budget router (design §4.4): plans which scenes get generative video
 * under the user's soft budget. Deterministic and unit-testable. */
export function estimateCostPlan(
  scenes: Scene[],
  budgetUsd: number,
  opts: EstimateOptions = {},
): CostPlan {
  const pricing = opts.pricing ?? DEFAULT_PRICING;

  const narrationChars = scenes.reduce((n, s) => n + s.narration.length, 0);
  // Fixed costs: LLM + TTS + style bible/character sheets (~4 images) +
  // one keyframe per non-remotion scene is counted per-scene below.
  const fixedUsd =
    pricing.llmFlatUsd +
    (narrationChars / 1000) * pricing.ttsPer1kCharsUsd +
    4 * pricing.imageUsd;

  // Start everything on the cheap path.
  const routing: SceneRouting[] = scenes.map((s) => {
    const path = CHEAP_PATH[s.sceneClass];
    const estimatedUsd =
      path === "remotion"
        ? pricing.remotionPerSceneUsd
        : // animatic/hybrid: keyframe image(s) + remotion compositing
          2 * pricing.imageUsd + pricing.remotionPerSceneUsd;
    return { sceneIndex: s.index, renderPath: path, candidates: 1, estimatedUsd };
  });

  let remaining =
    budgetUsd - fixedUsd - routing.reduce((n, r) => n + r.estimatedUsd, 0);

  // Spend remaining budget down the benefit-ranked list (gen-video upgrades).
  const ranked = scenes
    .map((s) => ({ scene: s, benefit: genVideoBenefit(s, scenes.length) }))
    .filter((x) => x.benefit > 0 && CHEAP_PATH[x.scene.sceneClass] !== "remotion")
    .sort((a, b) => b.benefit - a.benefit);

  for (const { scene } of ranked) {
    const duration = sceneDurationSeconds(scene) ?? 8;
    const genCost = duration * pricing.genVideoPerSecondUsd + pricing.imageUsd;
    const entry = routing.find((r) => r.sceneIndex === scene.index)!;
    const upgradeCost = genCost - entry.estimatedUsd;
    if (upgradeCost <= remaining) {
      entry.renderPath = scene.sceneClass === "hybrid" ? "hybrid" : "gen_video";
      entry.estimatedUsd = genCost;
      remaining -= upgradeCost;
    }
  }

  // High budget: spend what's still left on best-of-N candidates (decision F).
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (const entry of routing) {
      if (entry.renderPath !== "gen_video" || entry.candidates >= 3) continue;
      const scene = scenes.find((s) => s.index === entry.sceneIndex)!;
      const duration = sceneDurationSeconds(scene) ?? 8;
      const extra = duration * pricing.genVideoPerSecondUsd;
      if (extra <= remaining) {
        entry.candidates += 1;
        entry.estimatedUsd += extra;
        remaining -= extra;
        progressed = true;
      }
    }
  }

  const estimatedTotalUsd =
    fixedUsd + routing.reduce((n, r) => n + r.estimatedUsd, 0);

  return {
    perScene: routing,
    fixedUsd: round2(fixedUsd),
    estimatedTotalUsd: round2(estimatedTotalUsd),
    budgetUsd,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
