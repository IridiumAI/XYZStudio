import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, signUp, FAKE_TRANSCRIPT } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestApp();
  ({ cookie } = await signUp(ctx.app, "allowed@example.com"));
});

afterAll(async () => {
  await ctx.app.close();
});

const SESSION_INPUT = {
  title: "Stock exchange video",
  ideaPrompt: "How to architect a stock exchange, informative and funny.",
  style: "cartoon",
  language: "en",
  aspect: "16x9",
  voiceId: "en-narrator-m1",
  budgetUsd: 25,
};

describe("auth + allowlist", () => {
  it("rejects signup for non-allowlisted email", async () => {
    const { res } = await signUp(ctx.app, "stranger@example.com");
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("accepted the allowlisted email", () => {
    expect(cookie).toContain("better-auth");
  });

  it("requires auth on session routes", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(401);
  });
});

describe("sessions + transcript loop", () => {
  let sessionId: string;

  it("creates a session", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: SESSION_INPUT,
    });
    expect(res.statusCode).toBe(201);
    sessionId = res.json().id;
    expect(res.json().status).toBe("drafting");
  });

  it("rejects a voice that does not match the language", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: { ...SESSION_INPUT, language: "zh-Hans" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("generates a transcript over SSE and stores version 1 + cost plan", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/transcript/generate`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = res.payload
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.replace(/^data: /, "")));
    expect(events.some((e) => e.type === "delta")).toBe(true);
    const complete = events.find((e) => e.type === "complete");
    expect(complete).toBeDefined();
    expect(complete.version).toBe(1);
    expect(complete.transcript.scenes).toHaveLength(2);
    expect(complete.costPlan.perScene).toHaveLength(2);
  });

  it("revises with feedback and stores version 2", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/transcript/revise`,
      headers: { cookie },
      payload: { feedback: "Make the hook punchier" },
    });
    const events = res.payload
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.replace(/^data: /, "")));
    const complete = events.find((e) => e.type === "complete");
    expect(complete.version).toBe(2);
    expect(complete.transcript.logline).toContain("Make the hook punchier");
  });

  it("accepts a direct user edit as version 3", async () => {
    const edited = {
      ...FAKE_TRANSCRIPT,
      title: "Edited title",
    };
    const res = await ctx.app.inject({
      method: "PUT",
      url: `/api/sessions/${sessionId}/transcript`,
      headers: { cookie },
      payload: edited,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().version).toBe(3);
  });

  it("lists all versions newest-first", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/versions`,
      headers: { cookie },
    });
    const versions = res.json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(versions[2].source).toBe("generated");
    expect(versions[1].source).toBe("llm_revision");
    expect(versions[0].source).toBe("user_edit");
  });

  it("records LLM spend in the cost ledger", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
      headers: { cookie },
    });
    const detail = res.json();
    expect(detail.actualSpendUsd).toBeCloseTo(0.2, 5); // 0.12 + 0.08
    expect(detail.latestVersion.version).toBe(3);
    expect(detail.costPlan).not.toBeNull();
  });

  it("scopes sessions per user (user B cannot see user A's session)", async () => {
    // Add a second allowlisted user directly via the DB-backed allowlist.
    const schema = await import("../db/schema.js");
    await ctx.db.insert(schema.allowlist).values({ email: "second@example.com" });
    const { cookie: cookieB } = await signUp(ctx.app, "second@example.com");
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
      headers: { cookie: cookieB },
    });
    expect(res.statusCode).toBe(404);
  });
});
