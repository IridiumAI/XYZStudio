import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { desc, eq } from "drizzle-orm";
import { Transcript, type ImageProviderTier } from "@xyzstudio/shared";
import type { AppDeps } from "../app.js";
import * as schema from "../db/schema.js";
import { buildImagePrompt } from "../presentation/image-prompt-builder.js";
import { generateCssOverride } from "../presentation/css-generator.js";
import { generateSlideHtml } from "../presentation/slide-generator.js";
import { generateDiagramHtml } from "../presentation/diagram-generator.js";
import { assemblePresentation } from "../presentation/assembler.js";
import { buildPresentationZip } from "../presentation/zip-builder.js";

export type ProgressCallback = (event: {
  type: "progress";
  sceneIndex: number;
  total: number;
} | {
  type: "complete";
  assetId: string;
} | {
  type: "error";
  message: string;
}) => void;

const IMAGE_SCENE_CLASSES = new Set(["character", "cinematic", "hybrid", "image"]);

export async function runPresentationExport(
  deps: AppDeps,
  sessionId: string,
  onProgress: ProgressCallback,
): Promise<void> {
  const { db, config, slideGeneratorProvider, imageProvider } = deps;

  if (!slideGeneratorProvider) {
    onProgress({ type: "error", message: "Slide generator provider not configured" });
    return;
  }

  const [session] = await db
    .select()
    .from(schema.videoSessions)
    .where(eq(schema.videoSessions.id, sessionId));

  if (!session || session.sessionType !== "presentation") {
    onProgress({ type: "error", message: "Not a presentation session" });
    return;
  }

  const [latestVersion] = await db
    .select()
    .from(schema.transcriptVersions)
    .where(eq(schema.transcriptVersions.sessionId, sessionId))
    .orderBy(desc(schema.transcriptVersions.version))
    .limit(1);

  if (!latestVersion) {
    onProgress({ type: "error", message: "No transcript found — generate one first" });
    return;
  }

  const transcript = Transcript.parse(latestVersion.content);
  const scenes = transcript.scenes;
  const stylePrompt = session.presentationStylePrompt ?? "";
  const revealTheme = session.revealTheme ?? "white";
  const imageProviderTier = (session.imageProvider ?? "openai") as ImageProviderTier;

  const sessionDir = join(
    config.STORAGE_ROOT,
    "users",
    session.userId,
    "sessions",
    sessionId,
    "presentation",
  );
  mkdirSync(join(sessionDir, "assets"), { recursive: true });
  mkdirSync(join(sessionDir, "diagrams"), { recursive: true });

  let totalCostUsd = 0;
  const slides: string[] = [];
  const imagePaths = new Map<number, string>();
  const diagramFiles = new Map<number, string>();

  // Process scenes in parallel
  await Promise.all(
    scenes.map(async (scene) => {
      // Image generation for visual scenes
      let imageAssetPath: string | null = null;
      if (IMAGE_SCENE_CLASSES.has(scene.sceneClass) && imageProvider) {
        try {
          const prompt = buildImagePrompt(scene.visualDescription, stylePrompt);
          const { filePath, costUsd } = await imageProvider.generateImage({
            prompt,
            stylePrompt,
            width: 1920,
            height: 1080,
            modelTier: imageProviderTier,
          });
          imageAssetPath = filePath;
          imagePaths.set(scene.index, filePath);
          totalCostUsd += costUsd;
          await db.insert(schema.assets).values({
            id: randomUUID(),
            sessionId,
            sceneIndex: scene.index,
            kind: "sketch",
            path: relative(config.STORAGE_ROOT, filePath),
          });
        } catch {
          // Image generation failure is non-fatal; slide is generated without image
        }
      }

      // Standalone diagram for complex scenes
      if (scene.complexAnimation) {
        const { html, costUsd } = await generateDiagramHtml(
          scene,
          { presentationStylePrompt: stylePrompt },
          slideGeneratorProvider,
        );
        const diagramPath = join(sessionDir, "diagrams", `diagram-${scene.index}.html`);
        writeFileSync(diagramPath, html);
        diagramFiles.set(scene.index, html);
        totalCostUsd += costUsd;
      }

      // Slide HTML
      const { html: slideHtml, costUsd: slideCost } = await generateSlideHtml(
        scene,
        { presentationStylePrompt: stylePrompt, style: session.style },
        slideGeneratorProvider,
        imageAssetPath,
      );
      slides[scene.index] = slideHtml;
      totalCostUsd += slideCost;

      onProgress({ type: "progress", sceneIndex: scene.index, total: scenes.length });
    }),
  );

  // CSS override from style prompt
  const { css: cssOverride, costUsd: cssCost } = await generateCssOverride(
    stylePrompt,
    slideGeneratorProvider,
  );
  totalCostUsd += cssCost;

  // Assemble
  const { indexHtml, storyboardJson } = assemblePresentation(
    {
      sessionTitle: transcript.title,
      revealTheme,
      cssOverride,
      slides: slides.filter(Boolean),
      diagramFiles,
    },
    scenes,
  );

  // Write files
  writeFileSync(join(sessionDir, "index.html"), indexHtml);
  writeFileSync(join(sessionDir, "storyboard.json"), storyboardJson);

  // Build and cache zip
  const zipBuffer = await buildPresentationZip({
    indexHtml,
    storyboardJson,
    imagePaths,
    diagramFiles,
  });
  writeFileSync(join(sessionDir, "presentation.zip"), zipBuffer);

  // Insert asset row
  const assetId = randomUUID();
  const relPath = relative(config.STORAGE_ROOT, join(sessionDir, "index.html"));
  await db.insert(schema.assets).values({
    id: assetId,
    sessionId,
    sceneIndex: null,
    kind: "presentation",
    path: relPath,
  });

  // Record cost
  if (totalCostUsd > 0) {
    await db.insert(schema.costEntries).values({
      id: randomUUID(),
      sessionId,
      provider: "presentation_export",
      actualCostUsd: totalCostUsd,
      isPreview: false,
    });
  }

  onProgress({ type: "complete", assetId });
}
