import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import JSZip from "jszip";

export interface ZipOptions {
  indexHtml: string;
  storyboardJson: string;
  /** sceneIndex → absolute file path on disk */
  imagePaths: Map<number, string>;
  /** sceneIndex → HTML string content */
  diagramFiles: Map<number, string>;
}

export async function buildPresentationZip(opts: ZipOptions): Promise<Buffer> {
  const { indexHtml, storyboardJson, imagePaths, diagramFiles } = opts;

  const zip = new JSZip();
  zip.file("index.html", indexHtml);
  zip.file("storyboard.json", storyboardJson);

  for (const [sceneIndex, filePath] of imagePaths) {
    if (existsSync(filePath)) {
      const ext = basename(filePath).split(".").pop() ?? "png";
      zip.file(`assets/scene-${sceneIndex}-bg.${ext}`, readFileSync(filePath));
    }
  }

  for (const [sceneIndex, html] of diagramFiles) {
    zip.file(`diagrams/diagram-${sceneIndex}.html`, html);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return buffer;
}
