import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import type { TextProvider } from "@xyzstudio/shared";
import type { Auth } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { sessionRoutes } from "./routes/sessions.js";
import { transcriptRoutes } from "./routes/transcript.js";

export interface AppDeps {
  config: Config;
  db: Db;
  auth: Auth;
  /** Null when ANTHROPIC_API_KEY is unset — transcript routes return 503. */
  textProvider: TextProvider | null;
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
