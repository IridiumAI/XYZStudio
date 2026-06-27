import { createReadStream, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  SceneClass,
  Transcript,
  sceneDurationSeconds,
  type TranscriptRequest,
  PresentationSlideType,
} from "@xyzstudio/shared";
import { requireUser, type AppDeps } from "../app.js";
import * as schema from "../db/schema.js";
import { appendTranscriptVersion } from "./sessions.js";

const SceneEditBody = z.object({
  timestampStart: z
    .string()
    .regex(/^\d{1,3}:\d{2}$/)
    .optional(),
  timestampEnd: z
    .string()
    .regex(/^\d{1,3}:\d{2}$/)
    .optional(),
  narration: z.string().optional(),
  visualDescription: z.string().optional(),
  sceneClass: SceneClass.optional(),
  presentationSlideType: PresentationSlideType.optional(),
  complexAnimation: z.boolean().optional(),
  diagramCode: z.string().optional(),
});

const SelectionBody = z.object({
  narrationAssetId: z.string().nullable().optional(),
  videoAssetId: z.string().nullable().optional(),
});

const ChatBody = z.object({ message: z.string().min(1).max(10_000) });

export async function sceneRoutes(
  app: FastifyInstance,
  opts: { deps: AppDeps },
) {
  const { db, config, textProvider } = opts.deps;
  const { voiceProvider, videoProvider } = opts.deps;

  function startSse(reply: FastifyReply) {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": config.WEB_ORIGIN,
      "access-control-allow-credentials": "true",
    });
    const send = (event: unknown) =>
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    return { send, end: () => reply.raw.end() };
  }

  /** Load session + latest transcript + a specific scene, verifying ownership. */
  async function loadScene(userId: string, sessionId: string, idx: number) {
    const [session] = await db
      .select()
      .from(schema.videoSessions)
      .where(
        and(
          eq(schema.videoSessions.id, sessionId),
          eq(schema.videoSessions.userId, userId),
        ),
      );
    if (!session) return null;

    const [latestVersion] = await db
      .select()
      .from(schema.transcriptVersions)
      .where(eq(schema.transcriptVersions.sessionId, sessionId))
      .orderBy(desc(schema.transcriptVersions.version))
      .limit(1);
    if (!latestVersion) return null;

    const transcript = Transcript.parse(latestVersion.content);
    const scene = transcript.scenes.find((s) => s.index === idx);
    if (!scene) return null;

    return { session, transcript, scene };
  }

  function parseIdx(raw: string): number | null {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // -------------------------------------------------------------------------
  // GET /api/sessions/:id/scenes/:sceneIndex/assets
  // -------------------------------------------------------------------------
  app.get(
    "/api/sessions/:id/scenes/:sceneIndex/assets",
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const { id, sceneIndex } = request.params as {
        id: string;
        sceneIndex: string;
      };
      const idx = parseIdx(sceneIndex);
      if (idx === null) return reply.status(400).send({ error: "Invalid scene index" });

      const [session] = await db
        .select({ id: schema.videoSessions.id })
        .from(schema.videoSessions)
        .where(
          and(
            eq(schema.videoSessions.id, id),
            eq(schema.videoSessions.userId, user.id),
          ),
        );
      if (!session) return reply.status(404).send({ error: "Not found" });

      const allAssets = await db
        .select()
        .from(schema.assets)
        .where(
          and(
            eq(schema.assets.sessionId, id),
            eq(schema.assets.sceneIndex, idx),
          ),
        )
        .orderBy(desc(schema.assets.createdAt));

      const narrationAssets = allAssets.filter((a) => a.kind === "voice");
      const videoAssets = allAssets.filter((a) => a.kind === "clip");

      const [sel] = await db
        .select()
        .from(schema.sceneSelections)
        .where(
          and(
            eq(schema.sceneSelections.sessionId, id),
            eq(schema.sceneSelections.sceneIndex, idx),
          ),
        );

      return {
        narrationAssets,
        videoAssets,
        selection: sel
          ? {
              selectedNarrationAssetId: sel.selectedNarrationAssetId,
              selectedVideoAssetId: sel.selectedVideoAssetId,
            }
          : { selectedNarrationAssetId: null, selectedVideoAssetId: null },
      };
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/sessions/:id/scene-selections  (lightweight — used by storyboard badges)
  // -------------------------------------------------------------------------
  app.get(
    "/api/sessions/:id/scene-selections",
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const { id } = request.params as { id: string };

      const [session] = await db
        .select({ id: schema.videoSessions.id })
        .from(schema.videoSessions)
        .where(
          and(
            eq(schema.videoSessions.id, id),
            eq(schema.videoSessions.userId, user.id),
          ),
        );
      if (!session) return reply.status(404).send({ error: "Not found" });

      return db
        .select()
        .from(schema.sceneSelections)
        .where(eq(schema.sceneSelections.sessionId, id));
    },
  );

  // -------------------------------------------------------------------------
  // PUT /api/sessions/:id/scenes/:sceneIndex  — direct field edit
  // -------------------------------------------------------------------------
  app.put(
    "/api/sessions/:id/scenes/:sceneIndex",
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const { id, sceneIndex } = request.params as {
        id: string;
        sceneIndex: string;
      };
      const idx = parseIdx(sceneIndex);
      if (idx === null) return reply.status(400).send({ error: "Invalid scene index" });

      const loaded = await loadScene(user.id, id, idx);
      if (!loaded) return reply.status(404).send({ error: "Not found" });
      const { session, transcript, scene } = loaded;

      if (session.status !== "drafting") {
        return reply
          .status(409)
          .send({ error: `Cannot edit scene while session is ${session.status}` });
      }

      const body = SceneEditBody.safeParse(request.body);
      if (!body.success)
        return reply.status(400).send({ error: "Invalid input", details: body.error.flatten() });

      const updatedScene = { ...scene, ...body.data };
      const updatedTranscript: Transcript = {
        ...transcript,
        scenes: transcript.scenes.map((s) => (s.index === idx ? updatedScene : s)),
      };

      const version = await appendTranscriptVersion(opts.deps, {
        sessionId: id,
        source: "user_edit",
        transcript: updatedTranscript,
        budgetUsd: session.budgetUsd,
      });
      return reply.status(201).send(version);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sessions/:id/scenes/:sceneIndex/chat  — SSE LLM scene revision
  // -------------------------------------------------------------------------
  app.post(
    "/api/sessions/:id/scenes/:sceneIndex/chat",
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const { id, sceneIndex } = request.params as {
        id: string;
        sceneIndex: string;
      };
      const idx = parseIdx(sceneIndex);
      if (idx === null) return reply.status(400).send({ error: "Invalid scene index" });

      if (!textProvider) {
        return reply.status(503).send({ error: "ANTHROPIC_API_KEY is not configured" });
      }

      const loaded = await loadScene(user.id, id, idx);
      if (!loaded) return reply.status(404).send({ error: "Not found" });
      const { session, transcript, scene } = loaded;

      const body = ChatBody.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: "message required" });

      const priorFeedback = (
        await db
          .select({ feedback: schema.transcriptVersions.feedbackMessage })
          .from(schema.transcriptVersions)
          .where(eq(schema.transcriptVersions.sessionId, id))
          .orderBy(schema.transcriptVersions.version)
      )
        .filter((r) => r.feedback)
        .map((r) => ({ feedback: r.feedback! }));

      const scopedFeedback = `[Scene ${idx} (${scene.timestampStart}–${scene.timestampEnd})]: ${body.data.message}`;

      const sse = startSse(reply);
      try {
        const { transcript: revised, costUsd } =
          await textProvider.reviseTranscript(
            {
              ideaPrompt: session.ideaPrompt,
              style: session.style,
              language: session.language as TranscriptRequest["language"],
              aspect: session.aspect,
              targetBudgetUsd: session.budgetUsd,
              currentTranscript: transcript,
              feedback: scopedFeedback,
              priorFeedback,
            },
            (text) => sse.send({ type: "delta", text }),
          );

        // Scene chat LLM cost counts toward the session budget (it's a legitimate revision)
        await db.insert(schema.costEntries).values({
          id: randomUUID(),
          sessionId: id,
          provider: "anthropic",
          actualCostUsd: costUsd,
          isPreview: false,
        });

        const version = await appendTranscriptVersion(opts.deps, {
          sessionId: id,
          source: "llm_revision",
          transcript: revised,
          budgetUsd: session.budgetUsd,
          feedbackMessage: scopedFeedback,
        });
        sse.send({
          type: "complete",
          version: version.version,
          transcript: revised,
          costPlan: version.costPlan,
        });
      } catch (err) {
        request.log.error(err, "scene chat revision failed");
        sse.send({
          type: "error",
          message: err instanceof Error ? err.message : "Revision failed",
        });
      } finally {
        sse.end();
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sessions/:id/scenes/:sceneIndex/narration  — SSE voice preview
  // -------------------------------------------------------------------------
  app.post(
    "/api/sessions/:id/scenes/:sceneIndex/narration",
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const { id, sceneIndex } = request.params as {
        id: string;
        sceneIndex: string;
      };
      const idx = parseIdx(sceneIndex);
      if (idx === null) return reply.status(400).send({ error: "Invalid scene index" });

      if (!voiceProvider) {
        return reply.status(503).send({ error: "Voice provider not configured" });
      }

      const loaded = await loadScene(user.id, id, idx);
      if (!loaded) return reply.status(404).send({ error: "Not found" });
      const { session, scene } = loaded;

      const sse = startSse(reply);
      try {
        const { filePath, costUsd } = await voiceProvider.synthesize({
          text: scene.narration,
          voiceId: session.voiceId,
          language: session.language as TranscriptRequest["language"],
        });

        const assetId = randomUUID();
        const relPath = relative(config.STORAGE_ROOT, filePath);
        await db.insert(schema.assets).values({
          id: assetId,
          sessionId: id,
          sceneIndex: idx,
          kind: "voice",
          language: session.language,
          path: relPath,
        });

        // Preview cost — does NOT count toward budget/actualSpendUsd
        await db.insert(schema.costEntries).values({
          id: randomUUID(),
          sessionId: id,
          provider: "elevenlabs",
          actualCostUsd: costUsd,
          isPreview: true,
        });

        const [asset] = await db
          .select()
          .from(schema.assets)
          .where(eq(schema.assets.id, assetId));
        sse.send({ type: "complete", asset });
      } catch (err) {
        request.log.error(err, "narration preview generation failed");
        sse.send({
          type: "error",
          message: err instanceof Error ? err.message : "Generation failed",
        });
      } finally {
        sse.end();
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/sessions/:id/scenes/:sceneIndex/video  — SSE video clip preview
  // -------------------------------------------------------------------------
  app.post(
    "/api/sessions/:id/scenes/:sceneIndex/video",
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const { id, sceneIndex } = request.params as {
        id: string;
        sceneIndex: string;
      };
      const idx = parseIdx(sceneIndex);
      if (idx === null) return reply.status(400).send({ error: "Invalid scene index" });

      if (!videoProvider) {
        return reply.status(503).send({ error: "Video provider not configured" });
      }

      const loaded = await loadScene(user.id, id, idx);
      if (!loaded) return reply.status(404).send({ error: "Not found" });
      const { session, scene } = loaded;

      // Require a keyframe to drive video generation
      const [keyframe] = await db
        .select()
        .from(schema.assets)
        .where(
          and(
            eq(schema.assets.sessionId, id),
            eq(schema.assets.sceneIndex, idx),
            eq(schema.assets.kind, "keyframe"),
          ),
        )
        .limit(1);

      if (!keyframe) {
        return reply.status(409).send({
          error: "No keyframe available for this scene — generate a sketch first",
        });
      }

      const { width, height } =
        session.aspect === "16x9"
          ? { width: 1920, height: 1080 }
          : { width: 1080, height: 1920 };

      const durationSeconds =
        sceneDurationSeconds(scene) ?? 8;

      const keyframePath = join(config.STORAGE_ROOT, keyframe.path);

      const sse = startSse(reply);
      try {
        const { filePath, costUsd } = await videoProvider.generateClip({
          keyframePath,
          motionPrompt: scene.visualDescription,
          durationSeconds,
          width,
          height,
        });

        const assetId = randomUUID();
        const relPath = relative(config.STORAGE_ROOT, filePath);
        await db.insert(schema.assets).values({
          id: assetId,
          sessionId: id,
          sceneIndex: idx,
          kind: "clip",
          path: relPath,
        });

        // Preview cost — does NOT count toward budget/actualSpendUsd
        await db.insert(schema.costEntries).values({
          id: randomUUID(),
          sessionId: id,
          provider: "google",
          actualCostUsd: costUsd,
          isPreview: true,
        });

        const [asset] = await db
          .select()
          .from(schema.assets)
          .where(eq(schema.assets.id, assetId));
        sse.send({ type: "complete", asset });
      } catch (err) {
        request.log.error(err, "video preview generation failed");
        sse.send({
          type: "error",
          message: err instanceof Error ? err.message : "Generation failed",
        });
      } finally {
        sse.end();
      }
    },
  );

  // -------------------------------------------------------------------------
  // PUT /api/sessions/:id/scenes/:sceneIndex/selection
  // -------------------------------------------------------------------------
  app.put(
    "/api/sessions/:id/scenes/:sceneIndex/selection",
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const { id, sceneIndex } = request.params as {
        id: string;
        sceneIndex: string;
      };
      const idx = parseIdx(sceneIndex);
      if (idx === null) return reply.status(400).send({ error: "Invalid scene index" });

      const [session] = await db
        .select({ id: schema.videoSessions.id })
        .from(schema.videoSessions)
        .where(
          and(
            eq(schema.videoSessions.id, id),
            eq(schema.videoSessions.userId, user.id),
          ),
        );
      if (!session) return reply.status(404).send({ error: "Not found" });

      const body = SelectionBody.safeParse(request.body);
      if (!body.success)
        return reply.status(400).send({ error: "Invalid body", details: body.error.flatten() });

      const [existing] = await db
        .select()
        .from(schema.sceneSelections)
        .where(
          and(
            eq(schema.sceneSelections.sessionId, id),
            eq(schema.sceneSelections.sceneIndex, idx),
          ),
        );

      if (existing) {
        const update: Record<string, unknown> = { updatedAt: new Date() };
        if ("narrationAssetId" in body.data)
          update.selectedNarrationAssetId = body.data.narrationAssetId ?? null;
        if ("videoAssetId" in body.data)
          update.selectedVideoAssetId = body.data.videoAssetId ?? null;
        await db
          .update(schema.sceneSelections)
          .set(update)
          .where(eq(schema.sceneSelections.id, existing.id));
      } else {
        await db.insert(schema.sceneSelections).values({
          id: randomUUID(),
          sessionId: id,
          sceneIndex: idx,
          selectedNarrationAssetId: body.data.narrationAssetId ?? null,
          selectedVideoAssetId: body.data.videoAssetId ?? null,
        });
      }

      const [sel] = await db
        .select()
        .from(schema.sceneSelections)
        .where(
          and(
            eq(schema.sceneSelections.sessionId, id),
            eq(schema.sceneSelections.sceneIndex, idx),
          ),
        );
      return sel;
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/assets/:assetId  — serve or download a preview asset
  // -------------------------------------------------------------------------
  app.get("/api/assets/:assetId", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { assetId } = request.params as { assetId: string };
    const download = (request.query as { download?: string }).download === "1";

    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, assetId));
    if (!asset) return reply.status(404).send({ error: "Not found" });

    const [ownerSession] = await db
      .select({ userId: schema.videoSessions.userId })
      .from(schema.videoSessions)
      .where(eq(schema.videoSessions.id, asset.sessionId));
    if (!ownerSession || ownerSession.userId !== user.id) {
      return reply.status(404).send({ error: "Not found" });
    }

    const filePath = join(config.STORAGE_ROOT, asset.path);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "File not found" });
    }

    const contentType =
      asset.kind === "voice"
        ? "audio/mpeg"
        : asset.kind === "clip"
          ? "video/mp4"
          : "application/octet-stream";

    const ext = asset.kind === "voice" ? ".mp3" : asset.kind === "clip" ? ".mp4" : "";
    if (download) {
      reply.header(
        "content-disposition",
        `attachment; filename="${assetId}${ext}"`,
      );
    }

    return reply.type(contentType).send(createReadStream(filePath));
  });
}
