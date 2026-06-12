# XYZ Studio

Interactive video generation platform: idea → transcript → (revise) → per-scene clips + voice → assembled video + publishing metadata.

Design doc: [`docs/initial_design/proposed_high_level_design.md`](docs/initial_design/proposed_high_level_design.md)

## Layout

```
apps/server     Fastify API + BullMQ worker (TypeScript, Drizzle/SQLite, better-auth)
apps/web        React + Vite frontend
packages/shared Zod schemas, cost model, provider interfaces (shared types)
```

## Development

```sh
corepack enable pnpm          # once
pnpm install
cp .env.example .env          # fill in at least ANTHROPIC_API_KEY, AUTH_SECRET, ALLOWLIST_EMAILS
docker compose up -d redis    # only redis is needed for dev
pnpm db:push                  # create/update the SQLite schema
pnpm dev                      # server on :3000, web on :5173
```

Sign up with an email present in `ALLOWLIST_EMAILS`, create a session, and generate a transcript (requires `ANTHROPIC_API_KEY`).

## Tests

```sh
pnpm test         # unit tests (no API keys or redis needed)
pnpm typecheck
```

## Full stack via Docker

```sh
docker compose --profile full up --build   # web on :8080, api on :3000
```

## Phase status

- **Phase 1 (this scaffold):** auth (allowlist), session creation (style/language/aspect/budget/voice), streaming transcript generation + revision chat with version history, live cost estimate.
- **Phase 2 (next):** style bible, per-scene clip generation (Remotion / gen-video routing), TTS, scene review gate, best-of-N.
- **Phase 3:** assembly (ffmpeg), publishing metadata, notifications.
