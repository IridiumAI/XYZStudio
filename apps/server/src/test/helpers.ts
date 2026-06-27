import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type {
  ReviseRequest,
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

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      NODE_ENV: "test",
      AUTH_SECRET: "test-secret-test-secret",
      ALLOWLIST_EMAILS: "allowed@example.com",
      DATABASE_URL: "file::memory:",
    }),
    ...overrides,
  };
}

/** In-memory DB with the schema applied via drizzle-kit's programmatic API.
 * Note: drizzle-kit's `apply()` runs DDL through `.all()`, which
 * better-sqlite3 rejects — execute the generated statements directly. */
export async function createTestDb(): Promise<Db> {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  const { pushSQLiteSchema } = await import("drizzle-kit/api");
  const { statementsToExecute } = await pushSQLiteSchema(schema, db as never);
  for (const stmt of statementsToExecute) {
    sqlite.exec(stmt);
  }
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

export async function createTestApp(opts: { textProvider?: TextProvider } = {}) {
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
