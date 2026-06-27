import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { eq } from "drizzle-orm";
import type { TextProvider, VoiceProvider, VideoProvider, SlideGeneratorProvider, ImageProvider } from "@xyzstudio/shared";
import { isEmailAllowed, type Auth } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import * as schema from "./db/schema.js";
import { sessionRoutes } from "./routes/sessions.js";
import { transcriptRoutes } from "./routes/transcript.js";
import { sceneRoutes } from "./routes/scene.js";
import { presentationRoutes } from "./routes/presentation.js";

export interface AppDeps {
  config: Config;
  db: Db;
  auth: Auth;
  /** Null when ANTHROPIC_API_KEY is unset — transcript routes return 503. */
  textProvider: TextProvider | null;
  /** Null when ELEVENLABS_API_KEY is unset — narration generation returns 503. */
  voiceProvider: VoiceProvider | null;
  /** Null when video provider key is unset — video generation returns 503. */
  videoProvider: VideoProvider | null;
  /** Null when ANTHROPIC_API_KEY is unset — presentation export returns 503. */
  slideGeneratorProvider: SlideGeneratorProvider | null;
  /** Null when no image provider key configured — image scenes skipped. */
  imageProvider: ImageProvider | null;
}

export interface AuthedUser {
  id: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthedUser | null;
  }
}

function toWebHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.append(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

export async function buildApp(deps: AppDeps) {
  const { config, auth } = deps;
  const app = Fastify({ logger: config.NODE_ENV !== "test" });

  await app.register(cors, {
    origin: [config.WEB_ORIGIN],
    credentials: true,
  });

  // ------------------------------------------------------------------
  // Allowlist auto-signup: POST /api/auth/allowlist-login
  // If the email is allowlisted and the password matches ALLOWLIST_PASSWORD,
  // the account is created automatically so the user can skip the sign-up step.
  // ------------------------------------------------------------------
  app.post("/api/auth/allowlist-login", async (request, reply) => {
    const { email, password } = request.body as { email?: string; password?: string };
    if (!email || !password) {
      return reply.status(400).send({ error: "email and password required" });
    }
    if (password !== config.ALLOWLIST_PASSWORD) {
      return reply.status(401).send({ error: "Invalid allowlist password" });
    }
    if (!(await isEmailAllowed(deps.db, config, email))) {
      return reply.status(403).send({ error: "Email not on allowlist" });
    }
    const existing = await deps.db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.email, email.trim().toLowerCase()))
      .limit(1);
    if (existing.length === 0) {
      const res = await auth.api.signUpEmail({
        body: { email, password, name: email },
        asResponse: true,
      });
      if (!res.ok) {
        return reply.status(res.status).send(await res.text());
      }
    }
    return reply.status(200).send({ ok: true });
  });

  // ------------------------------------------------------------------
  // better-auth catch-all (sign-up/sign-in/sign-out/session endpoints)
  // ------------------------------------------------------------------
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(
        request.url,
        `http://${request.headers.host ?? "localhost"}`,
      );
      const webRequest = new Request(url.toString(), {
        method: request.method,
        headers: toWebHeaders(request),
        body:
          request.method === "POST" && request.body !== undefined
            ? JSON.stringify(request.body)
            : undefined,
      });
      const response = await auth.handler(webRequest);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      reply.send(response.body ? await response.text() : null);
    },
  });

  // ------------------------------------------------------------------
  // Session resolution for all other /api routes
  // ------------------------------------------------------------------
  app.decorateRequest("user", null);
  app.addHook("preHandler", async (request) => {
    if (request.url.startsWith("/api/auth/")) return;
    const session = await auth.api.getSession({
      headers: toWebHeaders(request),
    });
    request.user = session
      ? { id: session.user.id, email: session.user.email }
      : null;
  });

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(sessionRoutes, { deps });
  await app.register(transcriptRoutes, { deps });
  await app.register(sceneRoutes, { deps });
  await app.register(presentationRoutes, { deps });

  return app;
}

export function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
): AuthedUser | null {
  if (!request.user) {
    reply.status(401).send({ error: "Not signed in" });
    return null;
  }
  return request.user;
}
