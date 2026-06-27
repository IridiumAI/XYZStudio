import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestApp,
  signUp,
  FAKE_TRANSCRIPT,
  FakeSlideGeneratorProvider,
  FakeImageProvider,
} from "./helpers.js";
import * as schema from "../db/schema.js";
import { eq, and } from "drizzle-orm";

const PRES_SESSION_INPUT = {
  sessionType: "presentation",
  title: "Stock Exchange Explainer",
  ideaPrompt: "How to architect a stock exchange, informative and funny.",
  style: "cartoon",
  language: "en",
  aspect: "16x9",
};

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;

beforeAll(async () => {
  const slideProvider = new FakeSlideGeneratorProvider();
  const imageProvider = new FakeImageProvider();
  ctx = await createTestApp({ slideGeneratorProvider: slideProvider, imageProvider });
  ({ cookie } = await signUp(ctx.app, "allowed@example.com"));
});

afterAll(async () => {
  await ctx.app.close();
});

// ---------------------------------------------------------------------------
// Presentation session creation
// ---------------------------------------------------------------------------
describe("presentation session creation", () => {
  it("creates a presentation session with defaults", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: PRES_SESSION_INPUT,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      sessionType: string;
      revealTheme: string;
      imageProvider: string;
      presentationStylePrompt: string;
    }>();
    expect(body.sessionType).toBe("presentation");
    expect(body.revealTheme).toBe("white");
    expect(body.imageProvider).toBe("openai");
    expect(body.presentationStylePrompt).toContain("flat vector illustration");
  });

  it("accepts a custom style prompt", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: { ...PRES_SESSION_INPUT, stylePrompt: "dark neon cyberpunk, purple palette" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ presentationStylePrompt: string }>().presentationStylePrompt).toContain(
      "cyberpunk",
    );
  });

  it("accepts a custom reveal theme", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: { ...PRES_SESSION_INPUT, revealTheme: "moon" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ revealTheme: string }>().revealTheme).toBe("moon");
  });

  it("rejects an unknown revealTheme", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: { ...PRES_SESSION_INPUT, revealTheme: "galaxy" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown imageProvider", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: { ...PRES_SESSION_INPUT, imageProvider: "midjourney" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not require voiceId or budgetUsd", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: PRES_SESSION_INPUT,
    });
    expect(res.statusCode).toBe(201);
  });

  it("existing video session creation is unchanged", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: {
        title: "Video session",
        ideaPrompt: "A video about dogs.",
        style: "cartoon",
        language: "en",
        aspect: "16x9",
        voiceId: "en-narrator-m1",
        budgetUsd: 25,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ sessionType: string }>().sessionType).toBe("video");
  });
});

// ---------------------------------------------------------------------------
// Presentation export pipeline
// ---------------------------------------------------------------------------
describe("presentation export pipeline", () => {
  let sessionId: string;

  beforeAll(async () => {
    // Create + generate transcript
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: PRES_SESSION_INPUT,
    });
    sessionId = createRes.json<{ id: string }>().id;

    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/transcript/generate`,
      headers: { cookie },
    });
  });

  it("export returns SSE with content-type text/event-stream", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/export/presentation`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
  });

  it("SSE emits progress events and a complete event with assetId", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/export/presentation`,
      headers: { cookie },
    });
    const events = res.payload
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.replace(/^data: /, "")) as {
        type: string;
        sceneIndex?: number;
        total?: number;
        assetId?: string;
      });

    const progressEvents = events.filter((e) => e.type === "progress");
    expect(progressEvents.length).toBe(FAKE_TRANSCRIPT.scenes.length);

    const complete = events.find((e) => e.type === "complete");
    expect(complete).toBeDefined();
    expect(complete!.assetId).toBeTruthy();
  });

  it("inserts an asset row with kind=presentation", async () => {
    // Re-export to get the assetId (previous test already ran one)
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/export/presentation`,
      headers: { cookie },
    });
    const events = res.payload
      .split("\n\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l.replace(/^data: /, "")) as { type: string; assetId?: string });
    const { assetId } = events.find((e) => e.type === "complete")!;

    const [asset] = await ctx.db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, assetId!));

    expect(asset).toBeDefined();
    expect(asset!.kind).toBe("presentation");
  });

  it("index.html file is written to storage", async () => {
    const [asset] = await ctx.db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.sessionId, sessionId),
          eq(schema.assets.kind, "presentation"),
        ),
      )
      .limit(1);

    const filePath = join(ctx.config.STORAGE_ROOT, asset!.path);
    expect(existsSync(filePath)).toBe(true);
  });

  it("index.html contains speaker notes from scene narration", async () => {
    const [asset] = await ctx.db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.sessionId, sessionId),
          eq(schema.assets.kind, "presentation"),
        ),
      )
      .limit(1);

    const html = readFileSync(join(ctx.config.STORAGE_ROOT, asset!.path), "utf8");
    expect(html).toContain(FAKE_TRANSCRIPT.scenes[0]!.narration);
  });

  it("index.html contains the reveal theme", async () => {
    const [asset] = await ctx.db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.sessionId, sessionId),
          eq(schema.assets.kind, "presentation"),
        ),
      )
      .limit(1);

    const html = readFileSync(join(ctx.config.STORAGE_ROOT, asset!.path), "utf8");
    expect(html).toContain("/theme/white.css");
  });

  it("storyboard.json is written alongside index.html", async () => {
    const [asset] = await ctx.db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.sessionId, sessionId),
          eq(schema.assets.kind, "presentation"),
        ),
      )
      .limit(1);

    const storyboardPath = join(ctx.config.STORAGE_ROOT, asset!.path).replace(
      "index.html",
      "storyboard.json",
    );
    expect(existsSync(storyboardPath)).toBe(true);
    const entries = JSON.parse(readFileSync(storyboardPath, "utf8")) as unknown[];
    expect(entries).toHaveLength(FAKE_TRANSCRIPT.scenes.length);
  });

  it("records cost entries for the export", async () => {
    const entries = await ctx.db
      .select()
      .from(schema.costEntries)
      .where(eq(schema.costEntries.sessionId, sessionId));
    const exportEntries = entries.filter((e) => !e.isPreview);
    expect(exportEntries.length).toBeGreaterThan(0);
  });

  it("rejects export for a video session", async () => {
    const videoRes = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: {
        title: "Video",
        ideaPrompt: "dogs",
        style: "cartoon",
        language: "en",
        aspect: "16x9",
        voiceId: "en-narrator-m1",
        budgetUsd: 25,
      },
    });
    const videoId = videoRes.json<{ id: string }>().id;

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${videoId}/export/presentation`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects export when no transcript exists", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: PRES_SESSION_INPUT,
    });
    const emptyId = createRes.json<{ id: string }>().id;

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${emptyId}/export/presentation`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
  });

  it("returns 404 for another user's session", async () => {
    await ctx.db.insert(schema.allowlist).values({ email: "other@example.com" });
    const { cookie: otherCookie } = await signUp(ctx.app, "other@example.com");

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/export/presentation`,
      headers: { cookie: otherCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Complex scene — standalone diagram
// ---------------------------------------------------------------------------
describe("presentation export — complex scenes", () => {
  let sessionId: string;

  beforeAll(async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: PRES_SESSION_INPUT,
    });
    sessionId = createRes.json<{ id: string }>().id;

    // Generate transcript
    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/transcript/generate`,
      headers: { cookie },
    });

    // Toggle scene 1 to complexAnimation
    await ctx.app.inject({
      method: "PUT",
      url: `/api/sessions/${sessionId}/scenes/1`,
      headers: { cookie },
      payload: { complexAnimation: true },
    });
  });

  it("complex scene produces a standalone diagram file", async () => {
    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/export/presentation`,
      headers: { cookie },
    });

    const [asset] = await ctx.db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.sessionId, sessionId),
          eq(schema.assets.kind, "presentation"),
        ),
      )
      .limit(1);

    const sessionDir = join(ctx.config.STORAGE_ROOT, asset!.path).replace("index.html", "");
    const diagramPath = join(sessionDir, "diagrams", "diagram-1.html");
    expect(existsSync(diagramPath)).toBe(true);
  });

  it("complex scene slide in index.html is a placeholder with correct link", async () => {
    const [asset] = await ctx.db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.sessionId, sessionId),
          eq(schema.assets.kind, "presentation"),
        ),
      )
      .limit(1);

    const html = readFileSync(join(ctx.config.STORAGE_ROOT, asset!.path), "utf8");
    expect(html).toContain("Open animated diagram →");
    expect(html).toContain('href="diagrams/diagram-1.html"');
  });
});

// ---------------------------------------------------------------------------
// Zip download
// ---------------------------------------------------------------------------
describe("presentation zip download", () => {
  let sessionId: string;

  beforeAll(async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: PRES_SESSION_INPUT,
    });
    sessionId = createRes.json<{ id: string }>().id;
    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/transcript/generate`,
      headers: { cookie },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/export/presentation`,
      headers: { cookie },
    });
  });

  it("returns 200 with application/zip content-type", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/presentation/zip`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/zip");
  });

  it("content-disposition is attachment with filename", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/presentation/zip`,
      headers: { cookie },
    });
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("presentation.zip");
  });

  it("zip body starts with PK magic bytes", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/presentation/zip`,
      headers: { cookie },
    });
    const buf = Buffer.from(res.rawPayload);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("returns 404 before export is run", async () => {
    const newRes = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: PRES_SESSION_INPUT,
    });
    const newId = newRes.json<{ id: string }>().id;
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${newId}/presentation/zip`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for unknown session", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/sessions/not-real/presentation/zip",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
