import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { Transcript, type TranscriptRequest } from "@xyzstudio/shared";
import { requireUser, type AppDeps } from "../app.js";
import * as schema from "../db/schema.js";
import { appendTranscriptVersion } from "./sessions.js";
import { z } from "zod";

/** Streaming transcript generation/revision over SSE (design §2, §4.1).
 * POST + SSE response body: events are `data: <json>\n\n` with shapes
 *   {type:"delta", text}     — raw streamed JSON text from the model
 *   {type:"complete", version, transcript, costPlan}
 *   {type:"error", message}
 */
export async function transcriptRoutes(
  app: FastifyInstance,
  opts: { deps: AppDeps },
) {
  const { db, textProvider, config } = opts.deps;

  function startSse(reply: FastifyReply) {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": config.WEB_ORIGIN,
      "access-control-allow-credentials": "true",
    });
    const send = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    return { send, end: () => reply.raw.end() };
  }

  async function loadOwnedSession(userId: string, sessionId: string) {
    const [session] = await db
      .select()
      .from(schema.videoSessions)
      .where(
        and(
          eq(schema.videoSessions.id, sessionId),
          eq(schema.videoSessions.userId, userId),
        ),
      );
    return session ?? null;
  }

  async function recordLlmCost(sessionId: string, costUsd: number) {
    await db.insert(schema.costEntries).values({
      id: randomUUID(),
      sessionId,
      provider: "anthropic",
      actualCostUsd: costUsd,
    });
  }

  app.post("/api/sessions/:id/transcript/generate", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };

    const session = await loadOwnedSession(user.id, id);
    if (!session) return reply.status(404).send({ error: "Not found" });
    if (!textProvider) {
      return reply
        .status(503)
        .send({ error: "ANTHROPIC_API_KEY is not configured" });
    }
    if (session.status !== "drafting") {
      return reply
        .status(409)
        .send({ error: `Cannot generate while ${session.status}` });
    }

    const req: TranscriptRequest = {
      ideaPrompt: session.ideaPrompt,
      style: session.style,
      language: session.language as TranscriptRequest["language"],
      aspect: session.aspect,
      targetBudgetUsd: session.budgetUsd,
    };

    const sse = startSse(reply);
    try {
      const { transcript, costUsd } = await textProvider.generateTranscript(
        req,
        (text) => sse.send({ type: "delta", text }),
      );
      await recordLlmCost(id, costUsd);
      const version = await appendTranscriptVersion(opts.deps, {
        sessionId: id,
        source: "generated",
        transcript,
        budgetUsd: session.budgetUsd,
      });
      sse.send({
        type: "complete",
        version: version.version,
        transcript,
        costPlan: version.costPlan,
      });
    } catch (err) {
      request.log.error(err, "transcript generation failed");
      sse.send({
        type: "error",
        message: err instanceof Error ? err.message : "Generation failed",
      });
    } finally {
      sse.end();
    }
  });

  const ReviseBody = z.object({ feedback: z.string().min(1).max(10_000) });

  app.post("/api/sessions/:id/transcript/revise", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };

    const session = await loadOwnedSession(user.id, id);
    if (!session) return reply.status(404).send({ error: "Not found" });
    if (!textProvider) {
      return reply
        .status(503)
        .send({ error: "ANTHROPIC_API_KEY is not configured" });
    }
    if (session.status !== "drafting") {
      return reply
        .status(409)
        .send({ error: `Cannot revise while ${session.status}` });
    }

    const body = ReviseBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "feedback required" });
    }

    const [latest] = await db
      .select()
      .from(schema.transcriptVersions)
      .where(eq(schema.transcriptVersions.sessionId, id))
      .orderBy(desc(schema.transcriptVersions.version))
      .limit(1);
    if (!latest) {
      return reply
        .status(409)
        .send({ error: "No transcript to revise — generate one first" });
    }

    const priorFeedback = (
      await db
        .select({ feedback: schema.transcriptVersions.feedbackMessage })
        .from(schema.transcriptVersions)
        .where(eq(schema.transcriptVersions.sessionId, id))
        .orderBy(schema.transcriptVersions.version)
    )
      .filter((r) => r.feedback)
      .map((r) => ({ feedback: r.feedback! }));

    const sse = startSse(reply);
    try {
      const { transcript, costUsd } = await textProvider.reviseTranscript(
        {
          ideaPrompt: session.ideaPrompt,
          style: session.style,
          language: session.language as TranscriptRequest["language"],
          aspect: session.aspect,
          targetBudgetUsd: session.budgetUsd,
          currentTranscript: Transcript.parse(latest.content),
          feedback: body.data.feedback,
          priorFeedback,
        },
        (text) => sse.send({ type: "delta", text }),
      );
      await recordLlmCost(id, costUsd);
      const version = await appendTranscriptVersion(opts.deps, {
        sessionId: id,
        source: "llm_revision",
        transcript,
        budgetUsd: session.budgetUsd,
        feedbackMessage: body.data.feedback,
      });
      sse.send({
        type: "complete",
        version: version.version,
        transcript,
        costPlan: version.costPlan,
      });
    } catch (err) {
      request.log.error(err, "transcript revision failed");
      sse.send({
        type: "error",
        message: err instanceof Error ? err.message : "Revision failed",
      });
    } finally {
      sse.end();
    }
  });
}
