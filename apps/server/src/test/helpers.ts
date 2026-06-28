import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type {
  ImageProvider,
  ImageProviderTier,
  ReviseRequest,
  Scene,
  SlideGeneratorProvider,
  TextProvider,
  TextResult,
  Transcript,
  TranscriptRequest,
} from "@xyzstudio/shared";
import { buildApp } from "../app.js";
import { createAuth } from "../auth.js";
import { loadConfig, type Config } from "../config.js";
import * as schema from "../db/schema.js";
import type { Db } from "../db/client.js";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

// Minimal 1×1 white PNG
const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009001" +
    "2e000000000c4944415408d76360f8ff000001010057010057" +
    "0000000049454e44ae426082",
  "hex",
);

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      NODE_ENV: "test",
      AUTH_SECRET: "test-secret-test-secret",
      ALLOWLIST_EMAILS: "allowed@example.com",
      // DB_* vars not used in tests (PGlite bypasses the real DB connection)
      DB_HOST_NAME: "localhost",
      DB_PORT: "5432",
      DB_NAME: "postgres",
      DB_USERNAME: "postgres",
      DB_PASSWORD: "",
    }),
    ...overrides,
  };
}

/** In-memory PG database via PGlite with the schema applied via migrations. */
export async function createTestDb(): Promise<Db> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

export const FAKE_TRANSCRIPT: Transcript = {
  title: "Test Video",
  logline: "A test.",
  scenes: [
    {
      index: 0,
      timestampStart: "0:00",
      timestampEnd: "0:10",
      narration: "Hook narration.",
      visualDescription: "A cartoon host waves.",
      sceneClass: "character",
    },
    {
      index: 1,
      timestampStart: "0:10",
      timestampEnd: "0:40",
      narration: "Diagram narration.",
      visualDescription: "An architecture diagram animates in.",
      sceneClass: "diagram",
    },
  ],
};

export class FakeTextProvider implements TextProvider {
  async generateTranscript(
    _req: TranscriptRequest,
    onDelta?: (text: string) => void,
  ): Promise<TextResult> {
    onDelta?.('{"title":');
    onDelta?.('"Test Video", ...}');
    return { transcript: FAKE_TRANSCRIPT, costUsd: 0.12 };
  }

  async reviseTranscript(
    req: ReviseRequest,
    onDelta?: (text: string) => void,
  ): Promise<TextResult> {
    onDelta?.("{...}");
    const revised: Transcript = {
      ...req.currentTranscript,
      logline: `Revised: ${req.feedback}`,
    };
    return { transcript: revised, costUsd: 0.08 };
  }
}

export class FakeSlideGeneratorProvider implements SlideGeneratorProvider {
  readonly calls: { method: string; args: unknown }[] = [];

  async generateSlideHtml(req: {
    scene: Scene;
    sessionStyle: string;
    presentationStylePrompt: string;
  }): Promise<{ html: string; costUsd: number }> {
    this.calls.push({ method: "generateSlideHtml", args: req });
    return {
      html: `<section><h2>Scene ${req.scene.index}</h2><aside class="notes">${req.scene.narration}</aside></section>`,
      costUsd: 0.002,
    };
  }

  async generateCssOverride(stylePrompt: string): Promise<{ css: string; costUsd: number }> {
    this.calls.push({ method: "generateCssOverride", args: stylePrompt });
    return { css: ":root { --r-background-color: #fff; }", costUsd: 0.001 };
  }

  async generateDiagramHtml(req: {
    scene: Scene;
    presentationStylePrompt: string;
  }): Promise<{ html: string; costUsd: number }> {
    this.calls.push({ method: "generateDiagramHtml", args: req });
    return {
      html: `<!DOCTYPE html><body>diagram-${req.scene.index}</body>`,
      costUsd: 0.005,
    };
  }
}

export class FakeImageProvider implements ImageProvider {
  readonly calls: unknown[] = [];

  async generateImage(req: {
    prompt: string;
    stylePrompt: string;
    width: number;
    height: number;
    modelTier?: ImageProviderTier;
  }): Promise<{ filePath: string; costUsd: number }> {
    this.calls.push(req);
    const filePath = join(tmpdir(), `fake-image-${randomUUID()}.png`);
    writeFileSync(filePath, PNG_1X1);
    return { filePath, costUsd: 0.04 };
  }
}

export async function createTestApp(opts: {
  textProvider?: TextProvider;
  slideGeneratorProvider?: SlideGeneratorProvider;
  imageProvider?: ImageProvider;
} = {}) {
  const config = testConfig();
  const db = await createTestDb();
  const auth = createAuth(db, config);
  const app = await buildApp({
    config,
    db,
    auth,
    textProvider: opts.textProvider ?? new FakeTextProvider(),
    voiceProvider: null,
    videoProvider: null,
    slideGeneratorProvider: opts.slideGeneratorProvider ?? new FakeSlideGeneratorProvider(),
    imageProvider: opts.imageProvider ?? null,
  });
  return { app, db, config };
}

/** Sign up via the real better-auth endpoint; returns the session cookie. */
export async function signUp(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  email: string,
  password = "password-123",
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password, name: email.split("@")[0] },
  });
  const setCookie = res.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie])
    .filter(Boolean)
    .map((c) => String(c).split(";")[0])
    .join("; ");
  return { res, cookie };
}
