import { existsSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { eq, and, desc } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { requireUser, type AppDeps } from "../app.js";
import * as schema from "../db/schema.js";
import { runPresentationExport } from "../workers/presentation-worker.js";

export async function presentationRoutes(
  app: FastifyInstance,
  opts: { deps: AppDeps },
) {
  const { db, config } = opts.deps;

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

  // ---------------------------------------------------------------------------
  // POST /api/sessions/:id/export/presentation  — trigger export, SSE progress
  // ---------------------------------------------------------------------------
  app.post(
    "/api/sessions/:id/export/presentation",
    async (request, reply) => {
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

      if (session.sessionType !== "presentation") {
        return reply.status(409).send({
          error: "Session is not a presentation session",
        });
      }

      const [latestVersion] = await db
        .select({ id: schema.transcriptVersions.id })
        .from(schema.transcriptVersions)
        .where(eq(schema.transcriptVersions.sessionId, id))
        .orderBy(desc(schema.transcriptVersions.version))
        .limit(1);

      if (!latestVersion) {
        return reply.status(409).send({ error: "No transcript found — generate one first" });
      }

      const sse = startSse(reply);

      try {
        await runPresentationExport(opts.deps, id, (event) => sse.send(event));
      } catch (err) {
        request.log.error(err, "presentation export failed");
        sse.send({
          type: "error",
          message: err instanceof Error ? err.message : "Export failed",
        });
      } finally {
        sse.end();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/sessions/:id/presentation/zip  — stream the pre-built zip
  // ---------------------------------------------------------------------------
  app.get(
    "/api/sessions/:id/presentation/zip",
    async (request, reply) => {
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

      // Find the presentation asset to locate the session directory
      const [asset] = await db
        .select()
        .from(schema.assets)
        .where(
          and(
            eq(schema.assets.sessionId, id),
            eq(schema.assets.kind, "presentation"),
          ),
        )
        .orderBy(desc(schema.assets.createdAt))
        .limit(1);

      if (!asset) {
        return reply.status(404).send({ error: "Presentation not yet generated" });
      }

      // Zip lives alongside index.html in the same directory
      const indexPath = join(config.STORAGE_ROOT, asset.path);
      const zipPath = indexPath.replace("index.html", "presentation.zip");

      if (!existsSync(zipPath)) {
        return reply.status(404).send({ error: "Zip file not found — re-export to regenerate" });
      }

      reply
        .header("content-type", "application/zip")
        .header("content-disposition", 'attachment; filename="presentation.zip"');
      return reply.send(createReadStream(zipPath));
    },
  );
}
