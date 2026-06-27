import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPresentationZip } from "./zip-builder.js";

// Minimal 1×1 white PNG
const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009001" +
    "2e000000000c4944415408d76360f8ff000001010057010057" +
    "0000000049454e44ae426082",
  "hex",
);

function writeTempPng(): string {
  const p = join(tmpdir(), `test-${randomUUID()}.png`);
  writeFileSync(p, PNG_1X1);
  return p;
}

async function unzipEntryNames(buf: Buffer): Promise<string[]> {
  // Parse zip central directory to extract entry names without a zip library.
  const entries: string[] = [];
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x04034b50) {
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const name = buf.toString("utf8", i + 30, i + 30 + nameLen);
      entries.push(name);
      const compressedSize = buf.readUInt32LE(i + 18);
      i = i + 30 + nameLen + extraLen + compressedSize;
    } else {
      i++;
    }
  }
  return entries;
}

describe("buildPresentationZip", () => {
  it("returns a buffer starting with PK magic bytes", async () => {
    const buf = await buildPresentationZip({
      indexHtml: "<html></html>",
      storyboardJson: "[]",
      imagePaths: new Map(),
      diagramFiles: new Map(),
    });
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
  });

  it("zip contains index.html", async () => {
    const buf = await buildPresentationZip({
      indexHtml: "<html></html>",
      storyboardJson: "[]",
      imagePaths: new Map(),
      diagramFiles: new Map(),
    });
    const names = await unzipEntryNames(buf);
    expect(names).toContain("index.html");
  });

  it("zip contains storyboard.json", async () => {
    const buf = await buildPresentationZip({
      indexHtml: "<html></html>",
      storyboardJson: "[]",
      imagePaths: new Map(),
      diagramFiles: new Map(),
    });
    const names = await unzipEntryNames(buf);
    expect(names).toContain("storyboard.json");
  });

  it("zip contains image for scene with image path", async () => {
    const imgPath = writeTempPng();
    const buf = await buildPresentationZip({
      indexHtml: "<html></html>",
      storyboardJson: "[]",
      imagePaths: new Map([[2, imgPath]]),
      diagramFiles: new Map(),
    });
    const names = await unzipEntryNames(buf);
    expect(names.some((n) => n.includes("scene-2-bg"))).toBe(true);
  });

  it("zip contains diagram HTML for complex scene", async () => {
    const buf = await buildPresentationZip({
      indexHtml: "<html></html>",
      storyboardJson: "[]",
      imagePaths: new Map(),
      diagramFiles: new Map([[4, "<!DOCTYPE html><body>anim</body>"]]),
    });
    const names = await unzipEntryNames(buf);
    expect(names).toContain("diagrams/diagram-4.html");
  });

  it("zip does not contain Reveal.js library files", async () => {
    const buf = await buildPresentationZip({
      indexHtml: "<html><script src='reveal.js'></script></html>",
      storyboardJson: "[]",
      imagePaths: new Map(),
      diagramFiles: new Map(),
    });
    const names = await unzipEntryNames(buf);
    expect(names.every((n) => !n.includes("reveal.js") || n === "index.html")).toBe(true);
  });
});
