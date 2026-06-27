import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, sum } from "drizzle-orm";
import {
  CreateSessionInput,
  PRESET_VOICES,
  Language,
  Transcript,
  estimateCostPlan,
} from "@xyzstudio/shared";
import { requireUser, type AppDeps } from "../app.js";
import * as schema from "../db/schema.js";

export async function sessionRoutes(
  app: FastifyInstance,
  opts: { deps: AppDeps },
) {
  const { db } = opts.deps;

  app.get("/api/voices", async (request, reply) => {
    const language = Language.safeParse(
      (request.query as { language?: string }).language ?? "en",
    );
    if (!language.success) {
      return reply.status(400).send({ error: "Unknown language" });
    }
    return PRESET_VOICES[language.data];
  });

  app.post("/api/sessions", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    const parsed = CreateSessionInput.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const input = parsed.data;
    const voices = PRESET_VOICES[input.language];
    if (!voices.some((v) => v.id === input.voiceId)) {
      return reply
        .status(400)
        .send({ error: "voiceId is not a preset voice for this language" });
    }

    const id = randomUUID();
    await db.insert(schema.videoSessions).values({
      id,
      userId: user.id,
      title: input.title,
      ideaPrompt: input.ideaPrompt,
      style: input.style,
      language: input.language,
      aspect: input.aspect,
      voiceId: input.voiceId,
      budgetUsd: input.budgetUsd,
      status: "drafting",
    });
    const [row] = await db
      .select()
      .from(schema.videoSessions)
      .where(eq(schema.videoSessions.id, id));
    return reply.status(201).send(row);
  });

  app.get("/api/sessions", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return db
      .select()
      .from(schema.videoSessions)
      .where(eq(schema.videoSessions.userId, user.id))
      .orderBy(desc(schema.videoSessions.createdAt));
  });

  app.get("/api/sessions/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };

    const [session] = await db
      .select()
      .from(schema.videoSessions)
      .where(
        and(
          eq(schema.videoSessions.id, id),
          eq(schema.videoSessions.userId, user.id),
        ),
      );
    if (!session) return reply.status(404).send({ error: "Not found" });

    const [latestVersion] = await db
      .select()
      .from(schema.transcriptVersions)
      .where(eq(schema.transcriptVersions.sessionId, id))
      .orderBy(desc(schema.transcriptVersions.version))
      .limit(1);

    const [costPlan] = await db
      .select()
      .from(schema.costPlans)
      .where(eq(schema.costPlans.sessionId, id));

    const [spend] = await db
      .select({ total: sum(schema.costEntries.actualCostUsd) })
      .from(schema.costEntries)
      .where(
        and(
          eq(schema.costEntries.sessionId, id),
          eq(schema.costEntries.isPreview, false),
        ),
      );

    return {
      ...session,
      latestVersion: latestVersion ?? null,
      costPlan: costPlan ?? null,
      actualSpendUsd: Number(spend?.total ?? 0),
    };
  });

  /** Direct user edit of the transcript → new immutable version (§5). */
  app.put("/api/sessions/:id/transcript", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };

    const [session] = await db
      .select()
      .from(schema.videoSessions)
      .where(
        and(
          eq(schema.videoSessions.id, id),
          eq(schema.videoSessions.userId, user.id),
        ),
      );
    if (!session) return reply.status(404).send({ error: "Not found" });
    if (session.status !== "drafting") {
      return reply
        .status(409)
        .send({ error: `Cannot edit transcript while ${session.status}` });
    }

    const parsed = Transcript.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid transcript", details: parsed.error.flatten() });
    }

    const version = await appendTranscriptVersion(opts.deps, {
      sessionId: id,
      source: "user_edit",
      transcript: parsed.data,
      budgetUsd: session.budgetUsd,
    });
    return reply.status(201).send(version);
  });

  app.get("/api/sessions/:id/versions", async (request, reply) => {
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
      .from(schema.transcriptVersions)
      .where(eq(schema.transcriptVersions.sessionId, id))
      .orderBy(desc(schema.transcriptVersions.version));
  });
}

/** Append an immutable transcript version and refresh the cost plan.
 * Shared by user edits (here) and LLM generation/revision (transcript routes). */
export async function appendTranscriptVersion(
  deps: AppDeps,
  args: {
    sessionId: string;
    source: "generated" | "user_edit" | "llm_revision";
    transcript: Transcript;
    budgetUsd: number;
    feedbackMessage?: string;
  },
) {
  const { db } = deps;
  const [latest] = await db
    .select({ version: schema.transcriptVersions.version })
    .from(schema.transcriptVersions)
    .where(eq(schema.transcriptVersions.sessionId, args.sessionId))
    .orderBy(desc(schema.transcriptVersions.version))
    .limit(1);
  const nextVersion = (latest?.version ?? 0) + 1;

  const id = randomUUID();
  await db.insert(schema.transcriptVersions).values({
    id,
    sessionId: args.sessionId,
    version: nextVersion,
    source: args.source,
    feedbackMessage: args.feedbackMessage ?? null,
    content: args.transcript,
  });

  const plan = estimateCostPlan(args.transcript.scenes, args.budgetUsd);
  await db
    .delete(schema.costPlans)
    .where(eq(schema.costPlans.sessionId, args.sessionId));
  await db.insert(schema.costPlans).values({
    id: randomUUID(),
    sessionId: args.sessionId,
    perSceneRouting: plan.perScene,
    estimatedTotalUsd: plan.estimatedTotalUsd,
  });

  await db
    .update(schema.videoSessions)
    .set({ updatedAt: new Date() })
    .where(eq(schema.videoSessions.id, args.sessionId));

  const [row] = await db
    .select()
    .from(schema.transcriptVersions)
    .where(eq(schema.transcriptVersions.id, id));
  return { ...row!, costPlan: plan };
}
