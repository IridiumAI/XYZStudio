# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
pnpm dev          # start server (port 3000) + web (port 5173) in parallel
pnpm test         # unit + integration tests — no API keys or Redis required
pnpm typecheck    # TypeScript check across all packages
pnpm build        # compile all packages
pnpm db:push      # apply Drizzle schema to SQLite (run once after schema changes)
```

Run a single package's tests or typecheck:
```sh
pnpm --filter @xyzstudio/server test
pnpm --filter @xyzstudio/shared test
pnpm --filter @xyzstudio/server typecheck
```

Full stack via Docker (web on :8080, API on :3000):
```sh
docker compose --profile full up --build
```

## Architecture

pnpm monorepo with three packages:

| Package | Path | Role |
|---|---|---|
| `@xyzstudio/server` | `apps/server/` | Fastify REST + SSE API, BullMQ job topology, Drizzle/SQLite, better-auth |
| `@xyzstudio/web` | `apps/web/` | React 18 + Vite + TanStack Query frontend |
| `@xyzstudio/shared` | `packages/shared/` | Zod schemas, cost model, provider interfaces — shared by both |

### Provider abstraction boundary

`packages/shared/src/providers/types.ts` defines four interfaces: `TextProvider`, `ImageProvider`, `VideoProvider`, `VoiceProvider`. **Only adapter files** (e.g., `apps/server/src/providers/anthropic.ts`) are allowed to call external AI APIs. Everything above this boundary runs in CI with mock implementations (`FakeTextProvider` in tests). When `ANTHROPIC_API_KEY` is absent, `textProvider` is `null` and transcript routes return 503.

### Request flow

1. Auth routes (`/api/auth/*`) are handled by better-auth's catch-all handler, bridged from Fastify's native request to the Web Request API.
2. All other `/api` routes run a `preHandler` hook that resolves the session cookie into `request.user` (null if unauthenticated). `requireUser()` enforces auth and returns 401.
3. `sessionRoutes` and `transcriptRoutes` are registered as Fastify plugins, each receiving an `AppDeps` object (`config`, `db`, `auth`, `textProvider`).

### Transcript + versioning

Transcripts are immutable. Every change — LLM generation, LLM revision, or direct user edit — calls `appendTranscriptVersion()` in `sessions.ts`, which writes a new `transcript_versions` row (`source`: `generated | user_edit | llm_revision`) and atomically replaces the session's `cost_plans` row.

### Budget routing

`estimateCostPlan(scenes, budgetUsd)` in `packages/shared/src/cost/cost-model.ts` is a pure, deterministic function. It starts every scene on its "cheap path" (Remotion for diagrams/charts/text, animatic for character/cinematic), then upgrades scenes to `gen_video` by descending benefit score until the budget is exhausted, then spends remaining budget on best-of-N candidates (max 3).

### Job queue (Phase 2)

`apps/server/src/queue/index.ts` establishes the BullMQ topology: `sketch`, `scene_clip`, `voice`, `assemble` queues on Redis. Consumers live in `src/worker.ts` (Phase 2 placeholder). Job retry: 3 attempts, exponential backoff starting at 5s.

### Auth + allowlist

Signup is gated by `ALLOWLIST_EMAILS` (env, comma-separated) or rows in the `allowlist` DB table. The check runs in a `better-auth` `databaseHooks.user.create.before` hook. The `allowlist` table can be extended at runtime by inserting rows directly.

### Database

SQLite via Drizzle ORM. The app's video sessions live in `video_sessions` (not `session`) to avoid colliding with better-auth's own `session` table. Schema file: `apps/server/src/db/schema.ts`.

### Testing

Tests use in-memory SQLite (via `drizzle-kit`'s `pushSQLiteSchema` API) and `FakeTextProvider` — no real API keys, Redis, or network needed. The test helper `createTestApp()` wires everything up; `signUp()` exercises the real better-auth signup endpoint.

## Development Setup

Minimum: `ANTHROPIC_API_KEY`, `AUTH_SECRET` (`openssl rand -base64 32`), and `ALLOWLIST_EMAILS`. Copy `.env.example` to `.env` before running. Redis is required for the job queue; the quickest path is `docker compose up -d redis`.

## Roadmap State

- **Phase 1 (complete)**: Auth, session creation, streaming transcript generation + revision with version history, cost estimation.
- **Phase 2 (next)**: Style bible generation, per-scene asset jobs (sketch → clip → voice), scene review gate.
- **Phase 3**: ffmpeg assembly, platform metadata, background-session UX.
