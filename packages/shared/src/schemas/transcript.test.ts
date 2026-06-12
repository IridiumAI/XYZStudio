import { describe, expect, it } from "vitest";
import {
  Scene,
  Transcript,
  sceneDurationSeconds,
  timestampToSeconds,
  youtubeChapterList,
} from "./transcript.js";

describe("timestamps", () => {
  it("parses mm:ss", () => {
    expect(timestampToSeconds("0:00")).toBe(0);
    expect(timestampToSeconds("1:30")).toBe(90);
    expect(timestampToSeconds("12:05")).toBe(725);
  });

  it("rejects malformed timestamps", () => {
    expect(timestampToSeconds("1:99")).toBeNull();
    expect(timestampToSeconds("90")).toBeNull();
    expect(timestampToSeconds("1:2")).toBeNull();
  });

  it("computes scene duration", () => {
    expect(sceneDurationSeconds({ timestampStart: "0:10", timestampEnd: "0:25" })).toBe(15);
    expect(sceneDurationSeconds({ timestampStart: "0:25", timestampEnd: "0:10" })).toBeNull();
  });
});

describe("Transcript schema", () => {
  it("accepts a valid transcript", () => {
    const t = {
      title: "How to Architect a Stock Exchange",
      logline: "Matching engines explained with cartoons.",
      scenes: [
        {
          index: 0,
          timestampStart: "0:00",
          timestampEnd: "0:12",
          narration: "Hook!",
          visualDescription: "Cartoon trader panics.",
          sceneClass: "character",
        },
      ],
    };
    expect(Transcript.parse(t).scenes).toHaveLength(1);
  });

  it("rejects an unknown scene class", () => {
    const s = {
      index: 0,
      timestampStart: "0:00",
      timestampEnd: "0:10",
      narration: "x",
      visualDescription: "y",
      sceneClass: "explosion",
    };
    expect(() => Scene.parse(s)).toThrow();
  });
});

describe("youtubeChapterList", () => {
  const scenes = [
    { timestampStart: "0:05", narration: "a" }, // first chapter forced to 0:00
    { timestampStart: "0:30", narration: "b" },
    { timestampStart: "1:00", narration: "c" },
    { timestampStart: "1:05", narration: "d" }, // < 10s after previous → merged
    { timestampStart: "2:00", narration: "e" },
  ];

  it("formats chapters, forces 0:00, merges short ones", () => {
    const out = youtubeChapterList(scenes, ["Intro", "Setup", "Core", "Skip", "Outro"]);
    expect(out.split("\n")).toEqual(["0:00 Intro", "0:30 Setup", "1:00 Core", "2:00 Outro"]);
  });

  it("returns empty when fewer than 3 chapters survive", () => {
    const out = youtubeChapterList(scenes.slice(0, 2), ["A", "B"]);
    expect(out).toBe("");
  });
});
