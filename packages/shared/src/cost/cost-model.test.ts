import { describe, expect, it } from "vitest";
import type { Scene } from "../schemas/transcript.js";
import { DEFAULT_PRICING, estimateCostPlan } from "./cost-model.js";

function scene(index: number, sceneClass: Scene["sceneClass"], startSec: number, endSec: number): Scene {
  const ts = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return {
    index,
    timestampStart: ts(startSec),
    timestampEnd: ts(endSec),
    narration: "Some narration text for this scene that is reasonably long.",
    visualDescription: "desc",
    sceneClass,
  };
}

const SCENES: Scene[] = [
  scene(0, "character", 0, 8), // the hook
  scene(1, "diagram", 8, 30),
  scene(2, "chart", 30, 50),
  scene(3, "character", 50, 60),
  scene(4, "cinematic", 60, 70),
];

describe("estimateCostPlan", () => {
  it("routes everything to cheap paths at the $1-5 floor", () => {
    const plan = estimateCostPlan(SCENES, 3);
    expect(plan.perScene.every((r) => r.renderPath !== "gen_video")).toBe(true);
    expect(plan.perScene.find((r) => r.sceneIndex === 1)!.renderPath).toBe("remotion");
    expect(plan.perScene.find((r) => r.sceneIndex === 0)!.renderPath).toBe("animatic");
  });

  it("never routes diagram/chart/text scenes to gen_video at any budget", () => {
    const plan = estimateCostPlan(SCENES, 200);
    for (const idx of [1, 2]) {
      expect(plan.perScene.find((r) => r.sceneIndex === idx)!.renderPath).toBe("remotion");
    }
  });

  it("upgrades the hook scene first as budget grows", () => {
    // Enough for roughly one 8s gen-video scene above the floor.
    const oneSceneCost = 8 * DEFAULT_PRICING.genVideoPerSecondUsd + 2;
    const plan = estimateCostPlan(SCENES, Math.ceil(oneSceneCost + 2));
    const upgraded = plan.perScene.filter((r) => r.renderPath === "gen_video");
    expect(upgraded.length).toBeGreaterThanOrEqual(1);
    expect(upgraded[0]!.sceneIndex).toBe(0);
  });

  it("adds best-of-N candidates at high budgets", () => {
    const plan = estimateCostPlan(SCENES, 200);
    const candidates = plan.perScene
      .filter((r) => r.renderPath === "gen_video")
      .map((r) => r.candidates);
    expect(Math.max(...candidates)).toBeGreaterThan(1);
    expect(Math.max(...candidates)).toBeLessThanOrEqual(3);
  });

  it("keeps the estimate at or under budget (soft target planning)", () => {
    for (const budget of [1, 5, 20, 50, 100, 200]) {
      const plan = estimateCostPlan(SCENES, budget);
      // Floor costs (TTS, LLM, style bible) can exceed a $1 budget; otherwise
      // the plan must respect the budget.
      if (plan.estimatedTotalUsd > budget) {
        expect(plan.fixedUsd).toBeGreaterThan(budget - 1);
      }
    }
  });
});
