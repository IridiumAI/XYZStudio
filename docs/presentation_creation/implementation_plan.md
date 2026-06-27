# Presentation Mode — Implementation & Test Plan

**Date:** 2026-06-27  
**Status:** Ready for implementation  
**Prerequisite:** Research decisions fully settled in `workflow_research.md`.

---

## 0. Guiding conventions

- All new server code lives under `apps/server/src/presentation/` (a new module directory).
- New shared types go in `packages/shared/src/schemas/`.
- Existing patterns are reused exactly: `app.inject()` for integration tests, `FakeTextProvider` extended for new provider interfaces, `pushSQLiteSchema` for in-memory DB in tests.
- Run `pnpm db:push` after any schema change.
- Run `pnpm typecheck` after every phase before moving to the next.

---

## 1. Implementation Phases

### Phase 1 — Schema & DB (low effort, ~2–3 h)

#### 1.1 `packages/shared/src/schemas/transcript.ts`

Add to `RenderPath` enum:
```ts
export const RenderPath = z.enum([
  "remotion", "gen_video", "animatic", "hybrid",
  "presentation",      // new — Reveal.js slide fragment
  "animated_diagram",  // new — standalone HTML animation
]);
```

Add to `Scene` object:
```ts
presentationSlideType: z.enum([
  "title", "bullets", "diagram", "chart", "image", "code", "split", "timeline",
]).optional(),
complexAnimation: z.boolean().optional(), // user opt-in for standalone diagram
diagramCode: z.string().optional(),       // Mermaid / Chart.js code if LLM emits it
```

#### 1.2 `packages/shared/src/schemas/session.ts`

Add new types and schemas:
```ts
export const SessionType = z.enum(["video", "presentation"]);
export type SessionType = z.infer<typeof SessionType>;

export const ImageProvider = z.enum([
  "openai", "gemini-nano", "gemini-flash", "gemini-pro",
]);
export type ImageProvider = z.infer<typeof ImageProvider>;

export const RevealTheme = z.enum([
  "white", "black", "moon", "night", "sky", "beige", "simple",
]);
export type RevealTheme = z.infer<typeof RevealTheme>;

export const DEFAULT_STYLE_PROMPT =
  "flat vector illustration, tech aesthetic, blue and white color palette, " +
  "clean lines, minimal shading, no text, no watermarks";

export const DEFAULT_REVEAL_THEME: RevealTheme = "white";
export const DEFAULT_IMAGE_PROVIDER: ImageProvider = "openai";
```

Add `CreatePresentationSessionInput` alongside the existing `CreateSessionInput`:
```ts
export const CreatePresentationSessionInput = z.object({
  title: z.string().min(1).max(200),
  ideaPrompt: z.string().min(1).max(20_000),
  style: VideoStyle,
  language: Language,
  aspect: Aspect,
  stylePrompt: z.string().min(1).max(2_000).default(DEFAULT_STYLE_PROMPT),
  revealTheme: RevealTheme.default(DEFAULT_REVEAL_THEME),
  imageProvider: ImageProvider.default(DEFAULT_IMAGE_PROVIDER),
});
export type CreatePresentationSessionInput =
  z.infer<typeof CreatePresentationSessionInput>;
```

#### 1.3 `apps/server/src/db/schema.ts`

Extend `videoSessions` table with nullable presentation fields:
```ts
// add to videoSessions:
sessionType: text("session_type").notNull().default("video"), // "video" | "presentation"
presentationStylePrompt: text("presentation_style_prompt"),
revealTheme: text("reveal_theme"),
imageProvider: text("image_provider"),
```

Extend `assets.kind` comment to include new values:
```ts
kind: text("kind").notNull(),
// now: sketch | keyframe | clip | voice | final_video | thumbnail
//      | presentation | diagram   ← new
```

Run: `pnpm db:push`

#### 1.4 `packages/shared/src/providers/types.ts`

Add `PresentationProvider` interface (wraps the Claude calls specific to slide generation so they can be faked in tests):
```ts
export interface SlideGeneratorProvider {
  generateSlideHtml(req: {
    scene: Scene;
    sessionStyle: string;
    presentationStylePrompt: string;
  }): Promise<{ html: string; costUsd: number }>;

  generateCssOverride(stylePrompt: string): Promise<{ css: string; costUsd: number }>;

  generateDiagramHtml(req: {
    scene: Scene;
    presentationStylePrompt: string;
  }): Promise<{ html: string; costUsd: number }>;
}
```

Add `ImageProvider` model-selection field:
```ts
// Extend existing ImageProvider interface:
export interface ImageProvider {
  generateImage(req: {
    prompt: string;
    stylePrompt: string;
    referenceImagePaths?: string[];
    width: number;
    height: number;
    /** Which backend model to use — adapter maps this to the real model ID. */
    modelTier?: "openai" | "gemini-nano" | "gemini-flash" | "gemini-pro";
  }): Promise<{ filePath: string; costUsd: number }>;
}
```

---

### Phase 2 — Core Presentation Logic (medium effort, ~8–10 h)

New directory: `apps/server/src/presentation/`

#### 2.1 `image-prompt-builder.ts`

```ts
export function buildImagePrompt(
  visualDescription: string,
  stylePrompt: string,
): string
```

Concatenates `stylePrompt` + `visualDescription` into the final generation prompt. Truncates to 1000 chars. Pure function — no I/O.

#### 2.2 `css-generator.ts`

```ts
export async function generateCssOverride(
  stylePrompt: string,
  provider: SlideGeneratorProvider,
): Promise<{ css: string; costUsd: number }>
```

Calls `provider.generateCssOverride(stylePrompt)`. The Anthropic adapter sends a short system prompt asking for CSS variable overrides only (≤20 lines). In tests, the fake returns a minimal valid CSS string.

#### 2.3 `slide-generator.ts`

```ts
export async function generateSlideHtml(
  scene: Scene,
  session: { presentationStylePrompt: string; style: string },
  provider: SlideGeneratorProvider,
  imageAssetPath: string | null,  // pre-generated image path, null if no image scene
): Promise<{ html: string; costUsd: number }>
```

Routes by `scene.presentationSlideType`:
- `title` / `bullets` / `code` / `split` / `timeline` → calls `provider.generateSlideHtml()`; injects `imageAssetPath` into prompt if provided
- `diagram` → if `scene.diagramCode` is already set, wraps it in a `<div class="mermaid">` section without an LLM call; otherwise calls `provider.generateSlideHtml()`
- `chart` → same pattern: use `scene.diagramCode` if present, else call provider

For `scene.complexAnimation === true`: returns a **placeholder** slide fragment without calling the provider:
```html
<section>
  <h3>{scene title from visualDescription}</h3>
  <p>Animated diagram for this scene.</p>
  <a href="diagrams/diagram-{scene.index}.html" target="_blank">
    Open animated diagram →
  </a>
  <aside class="notes">{scene.narration}</aside>
</section>
```

Speaker notes (`<aside class="notes">`) are always populated from `scene.narration`.

#### 2.4 `diagram-generator.ts`

```ts
export async function generateDiagramHtml(
  scene: Scene,
  session: { presentationStylePrompt: string },
  provider: SlideGeneratorProvider,
): Promise<{ html: string; costUsd: number }>
```

Only called for scenes with `complexAnimation === true`. Calls `provider.generateDiagramHtml()` with `effort: "high"` in the Anthropic adapter. Returns a self-contained HTML file with GSAP/D3.js CDN links and the animation code embedded.

#### 2.5 `assembler.ts`

```ts
export function assemblePresentation(opts: {
  sessionTitle: string;
  revealTheme: string;
  cssOverride: string;
  slides: string[];           // ordered array of <section>…</section> fragments
  diagramFiles: Map<number, string>; // sceneIndex → diagram HTML content
}): { indexHtml: string; storyboardJson: string }
```

Pure function. Produces:

**`indexHtml`** — a complete Reveal.js HTML document:
- CDN links: Reveal.js 5.x, RevealMermaid, Chart.js 4.x, Highlight.js, Rough Notation
- Selected theme stylesheet: `https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/{revealTheme}.css`
- `cssOverride` injected in a `<style>` tag after the theme link
- All `slides` inserted into `<div class="slides">`
- `Reveal.initialize({ plugins: [RevealMermaid, RevealHighlight], ... })`

**`storyboardJson`** — `JSON.stringify` of an array of `{ index, timestampStart, timestampEnd, narration }` objects for all scenes (the user's reference during screen recording).

#### 2.6 `zip-builder.ts`

```ts
export async function buildPresentationZip(opts: {
  indexHtml: string;
  storyboardJson: string;
  imagePaths: Map<number, string>; // sceneIndex → absolute file path
  diagramFiles: Map<number, string>; // sceneIndex → HTML string
  storageRoot: string;
}): Promise<Buffer>
```

Uses the `archiver` npm package (already available or add it). Builds a zip in memory:
```
index.html
storyboard.json
assets/scene-{N}-bg.png   ← each generated image
diagrams/diagram-{N}.html  ← each complex scene diagram
```

CDN links inside `index.html` are left as-is (no bundling).

---

### Phase 3 — API Layer (medium effort, ~4–5 h)

#### 3.1 `apps/server/src/routes/presentation.ts`

New Fastify plugin registered in `app.ts`:
```ts
await app.register(presentationRoutes, { deps });
```

Routes:

**`POST /api/sessions` for presentation type** — handled inside existing `sessionRoutes` by detecting `sessionType: "presentation"` in the request body and branching to `CreatePresentationSessionInput`. Inserts `voiceId: ""` and `budgetUsd: 0` as sentinel values (or make them nullable in the schema — see DB note below). Returns session row with `sessionType: "presentation"`.

> DB note: make `voiceId` and `budgetUsd` nullable in the `video_sessions` schema (add `.nullable()` to Drizzle column definition, `pnpm db:push`). Existing `CreateSessionInput` validation continues to enforce them for video sessions at the route layer.

**`POST /api/sessions/:id/export/presentation`**
- Auth-gated; ownership check.
- Verifies `session.sessionType === "presentation"` and `session.status === "drafting"` (transcript must exist).
- Enqueues a `presentation_export` BullMQ job.
- Opens SSE response; publishes `{ type: "progress", sceneIndex, total }` per scene as they complete, then `{ type: "complete", assetId }` on success or `{ type: "error", message }` on failure.

**`GET /api/sessions/:id/presentation/zip`**
- Streams the zip built by `buildPresentationZip()`.
- Sets `content-disposition: attachment; filename="presentation.zip"`.
- Loads the stored `presentation` asset from the assets table, reads the generated files from disk.

#### 3.2 `apps/server/src/workers/presentation-worker.ts`

BullMQ processor for `presentation_export` jobs:

```
1. Load session + latest transcript from DB.
2. For each scene in parallel (Promise.all):
   a. If scene needs image: call imageProvider.generateImage(); save to disk; insert asset row.
   b. Generate slide HTML via slideGeneratorProvider.generateSlideHtml(); accumulate cost.
   c. If scene.complexAnimation: generate diagram HTML via generateDiagramHtml(); save to disk.
   d. Push SSE progress event.
3. Generate CSS override: generateCssOverride(session.presentationStylePrompt).
4. Call assembler.assemblePresentation() with all slides + diagram files.
5. Write index.html + storyboard.json to storage path:
   data/users/{userId}/sessions/{sessionId}/presentation/
6. Insert asset row: kind="presentation", path=relative path to index.html.
7. Insert cost entries for all LLM + image provider calls.
8. Push SSE complete event with assetId.
```

#### 3.3 `apps/server/src/app.ts`

- Add `slideGeneratorProvider: SlideGeneratorProvider | null` to `AppDeps`.
- Register `presentationRoutes` plugin.

---

### Phase 4 — UI (low-medium effort, ~4–6 h)

Files: `apps/web/src/`

#### 4.1 Session creation form (`pages/NewSession.tsx` or equivalent)

- Add session type toggle: "Video" / "Presentation" (radio or tab).
- **Video branch:** unchanged (existing form).
- **Presentation branch:** hide budget slider + voice picker; show:
  - Style prompt `<textarea>` (default value from `DEFAULT_STYLE_PROMPT`).
  - Reveal.js theme `<select>` (7 options with descriptions).
  - Image provider `<select>` (OpenAI default, Gemini tiers).
- POST to `/api/sessions` with the appropriate payload shape.

#### 4.2 Session detail page (`pages/SessionEditor.tsx`)

- Detect `session.sessionType === "presentation"` and render an "Export as Presentation" button (replacing or alongside the video "Approve" button).
- Per-scene: add a "Make animated diagram" toggle checkbox (sets `scene.complexAnimation = true` via a `PUT /api/sessions/:id/scenes/:sceneIndex` edit).
- On "Export": POST to `/api/sessions/:id/export/presentation`; open SSE stream; show per-scene progress bar.

#### 4.3 Presentation preview panel

After export completes:
- Show an `<iframe src="/api/assets/{assetId}?inline=1">` panel below the scene list.
- "Download as zip" button → `GET /api/sessions/:id/presentation/zip`.
- The iframe renders the full Reveal.js presentation interactively (fully navigable).

---

## 2. Test Plan

### 2.1 Unit Tests

All unit tests live alongside the module file (e.g. `slide-generator.test.ts` beside `slide-generator.ts`). Run with `pnpm --filter @xyzstudio/server test`. No I/O — provider calls replaced by simple inline fakes.

---

#### `packages/shared/src/schemas/transcript.test.ts` — extend existing file

| Test | Assertion |
|---|---|
| Scene accepts valid `presentationSlideType` | `Scene.parse({ ...validScene, presentationSlideType: "bullets" })` succeeds |
| Scene rejects unknown `presentationSlideType` | `Scene.parse({ ...validScene, presentationSlideType: "flashcard" })` throws |
| Scene accepts missing `presentationSlideType` | Field is optional; existing scenes parse without it |
| Scene accepts `complexAnimation: true` | New boolean field parses |
| `RenderPath` includes `"presentation"` and `"animated_diagram"` | `RenderPath.parse("presentation")` succeeds |

---

#### `apps/server/src/presentation/image-prompt-builder.test.ts`

| Test | Assertion |
|---|---|
| Concatenates style prompt + visual description | Output contains both strings |
| Truncates to 1000 chars | 1200-char input → output.length ≤ 1000 |
| Empty visual description still uses style prompt | Output starts with style prompt |

---

#### `apps/server/src/presentation/css-generator.test.ts`

Fake provider returns `{ css: ":root { --r-background-color: #fff; }", costUsd: 0.001 }`.

| Test | Assertion |
|---|---|
| Returns CSS string from provider | `result.css` contains `:root` |
| Passes style prompt to provider | Provider call recorded with correct `stylePrompt` argument |
| Accumulates cost | `result.costUsd === 0.001` |

---

#### `apps/server/src/presentation/slide-generator.test.ts`

Fake provider returns `{ html: "<section>fake</section>", costUsd: 0.002 }`.

| Test | Assertion |
|---|---|
| `bullets` scene: provider called, speaker notes injected | Output `<section>` contains `<aside class="notes">narration text</aside>` |
| `diagram` scene with `diagramCode` set: no provider call | Provider call count = 0; output wraps `scene.diagramCode` in `<div class="mermaid">` |
| `diagram` scene without `diagramCode`: provider called | Provider call count = 1 |
| `complexAnimation: true` scene: returns placeholder, no provider call | Output contains `"Open animated diagram →"` link; provider not called |
| Placeholder slide link uses correct scene index | `href="diagrams/diagram-3.html"` for scene index 3 |
| `image` scene with `imageAssetPath`: path included in prompt | Provider called with prompt containing asset path |
| Costs accumulate across multiple calls | Sum of `costUsd` matches provider calls × 0.002 |

---

#### `apps/server/src/presentation/diagram-generator.test.ts`

Fake provider returns `{ html: "<!DOCTYPE html>…GSAP code…", costUsd: 0.005 }`.

| Test | Assertion |
|---|---|
| Returns self-contained HTML | `result.html` starts with `<!DOCTYPE html>` |
| Passes scene `visualDescription` to provider | Provider recorded with correct scene arg |
| Accumulates cost | `result.costUsd === 0.005` |

---

#### `apps/server/src/presentation/assembler.test.ts`

Pure function — no fakes needed.

| Test | Assertion |
|---|---|
| Output contains Reveal.js CDN script tag | `indexHtml` includes `cdn.jsdelivr.net/npm/reveal.js` |
| Output contains selected theme stylesheet link | `indexHtml` includes `/theme/moon.css` when `revealTheme = "moon"` |
| CSS override injected after theme link | CSS block appears after the theme `<link>` in document order |
| All slide fragments present | Each string from `slides[]` appears in `indexHtml` |
| `storyboardJson` is valid JSON array | `JSON.parse(storyboardJson)` succeeds; length matches scene count |
| `storyboardJson` entries have `index`, `timestampStart`, `timestampEnd`, `narration` | All four fields present on each entry |
| Diagram files not embedded in `indexHtml` | `diagrams/diagram-1.html` content not present inline; only linked via placeholder slide |
| Mermaid plugin script tag present | `indexHtml` includes `revealjs-mermaid-plugin` or equivalent CDN |

---

#### `apps/server/src/presentation/zip-builder.test.ts`

| Test | Assertion |
|---|---|
| Zip contains `index.html` | Unzip buffer; entry list includes `index.html` |
| Zip contains `storyboard.json` | Entry list includes `storyboard.json` |
| Zip contains image for scene with image | Entry `assets/scene-2-bg.png` present when scene 2 has image |
| Zip contains diagram HTML for complex scene | Entry `diagrams/diagram-4.html` present |
| Zip does NOT contain Reveal.js library files | No entry matches `reveal.js` or `plugin/` |
| Zip is a valid zip buffer | `Buffer` starts with PK magic bytes `0x50 0x4B` |

---

### 2.2 Integration Tests

**File:** `apps/server/src/test/presentation.test.ts`

Uses the existing `createTestApp()` / `signUp()` / `app.inject()` pattern. Extends `AppDeps` with a `FakeSlideGeneratorProvider` and `FakeImageProvider`.

#### Fake providers (add to `test/helpers.ts`)

```ts
export class FakeSlideGeneratorProvider implements SlideGeneratorProvider {
  calls: { method: string; args: unknown }[] = [];

  async generateSlideHtml(req) {
    this.calls.push({ method: "generateSlideHtml", args: req });
    return {
      html: `<section><h2>Slide</h2><aside class="notes">${req.scene.narration}</aside></section>`,
      costUsd: 0.002,
    };
  }
  async generateCssOverride(stylePrompt) {
    this.calls.push({ method: "generateCssOverride", args: stylePrompt });
    return { css: ":root { --r-background-color: #fff; }", costUsd: 0.001 };
  }
  async generateDiagramHtml(req) {
    this.calls.push({ method: "generateDiagramHtml", args: req });
    return { html: "<!DOCTYPE html><body>diagram</body>", costUsd: 0.005 };
  }
}

export class FakeImageProvider implements ImageProvider {
  calls: unknown[] = [];
  async generateImage(req) {
    this.calls.push(req);
    // Write a 1×1 PNG placeholder to a temp file so file-existence checks pass
    const filePath = join(tmpdir(), `fake-image-${randomUUID()}.png`);
    writeFileSync(filePath, PNG_1X1_BUFFER);
    return { filePath, costUsd: 0.04 };
  }
}
```

#### Test suite structure

```
describe("presentation session creation")
describe("presentation export pipeline")
describe("presentation zip download")
describe("cost ledger")
describe("auth scoping")
```

---

**`describe("presentation session creation")`**

| Test | Setup | Assertion |
|---|---|---|
| Creates presentation session with defaults | POST `/api/sessions` with `sessionType: "presentation"`, no voiceId/budgetUsd | 201; row has `sessionType="presentation"`, `presentationStylePrompt` = default, `revealTheme="white"`, `imageProvider="openai"` |
| Rejects presentation session if `sessionType` missing (existing video path) | POST with video payload but no voiceId | 400 |
| Accepts custom style prompt | Include `stylePrompt: "dark neon cyberpunk"` | Row has `presentationStylePrompt="dark neon cyberpunk"` |
| Rejects unknown `revealTheme` | `revealTheme: "galaxy"` | 400 |
| Rejects unknown `imageProvider` | `imageProvider: "midjourney"` | 400 |
| Video session creation unchanged | Existing `SESSION_INPUT` payload | 201; `sessionType="video"` |

---

**`describe("presentation export pipeline")`**

Setup: Create presentation session → generate transcript (using `FakeTextProvider`).

| Test | Assertion |
|---|---|
| `POST /api/sessions/:id/export/presentation` returns 200 SSE | `content-type` is `text/event-stream` |
| SSE emits `progress` event per scene | Events include `{ type: "progress", sceneIndex: 0, total: 2 }` and `{ type: "progress", sceneIndex: 1, total: 2 }` |
| SSE emits `complete` event with `assetId` | Final event has `type: "complete"` and non-null `assetId` |
| Asset row inserted with `kind = "presentation"` | DB query on `assets` where `sessionId` returns one row with `kind="presentation"` |
| `index.html` file written to storage path | `existsSync(join(storageRoot, asset.path))` is true |
| `index.html` contains speaker notes from scene narration | File content includes `"Hook narration."` in an `<aside class="notes">` |
| `index.html` contains selected reveal theme | File includes `/theme/white.css` |
| `storyboard.json` written alongside `index.html` | `existsSync(storyboardPath)` true; parsed JSON has 2 entries |
| `slideGeneratorProvider.generateSlideHtml` called once per non-complex scene | `fakeProvider.calls.filter(c => c.method === "generateSlideHtml")` length = scene count |
| Image generation called only for character/cinematic scenes | `fakeImageProvider.calls.length` = number of image-class scenes |
| Cost entries inserted for all provider calls | `sum(costEntries.actualCostUsd)` = expected sum |
| Rejects export for video session | Returns 409 |
| Rejects export when no transcript exists | Returns 409 |
| Returns 404 for session owned by another user | Auth scoping preserved |

---

**`describe("presentation export — complex scenes")`**

Setup: Create session → generate transcript → `PUT /api/sessions/:id/scenes/1` with `complexAnimation: true`.

| Test | Assertion |
|---|---|
| Complex scene generates `diagram-1.html` file | File exists at `{sessionDir}/presentation/diagrams/diagram-1.html` |
| Complex scene slide in `index.html` is a placeholder | `index.html` content contains `"Open animated diagram →"` and `href="diagrams/diagram-1.html"` |
| Non-complex scenes generate normal slides | The other scene's `<section>` is present and not a placeholder |
| `generateDiagramHtml` called once for complex scene | Provider call log has one `generateDiagramHtml` entry |
| `generateSlideHtml` NOT called for complex scene | No `generateSlideHtml` call for scene index 1 |

---

**`describe("presentation export — image provider routing")`**

| Test | Assertion |
|---|---|
| Session with `imageProvider: "openai"` routes to OpenAI adapter | `fakeImageProvider.calls[0].modelTier === "openai"` |
| Session with `imageProvider: "gemini-nano"` routes with correct tier | `modelTier === "gemini-nano"` |
| Session with `imageProvider: "gemini-pro"` routes with correct tier | `modelTier === "gemini-pro"` |

---

**`describe("presentation zip download")`**

Setup: Full export run above.

| Test | Assertion |
|---|---|
| `GET /api/sessions/:id/presentation/zip` returns 200 | Status 200; `content-type: application/zip` |
| `content-disposition` is attachment with filename | Header contains `attachment; filename="presentation.zip"` |
| Zip body starts with PK magic bytes | First two bytes of response body are `0x50 0x4B` |
| Zip contains `index.html` | Parsed zip entries include `index.html` |
| Zip contains `storyboard.json` | Entry present |
| Returns 404 for non-existent session | 404 |
| Scoped to authenticated user | Another user gets 404 |

---

**`describe("cost ledger")`**

| Test | Assertion |
|---|---|
| Slide generation costs recorded | `costEntries` rows have `provider = "anthropic"` |
| Image generation cost recorded | `costEntries` rows have `provider = "openai"` (or `"google"`) |
| CSS generation cost recorded | Separate `costEntries` row for the CSS call |
| All entries have `isPreview = false` | Presentation export is a real job, not a preview |
| Total spend on session detail reflects presentation export | `GET /api/sessions/:id` → `actualSpendUsd` ≈ expected sum |

---

### 2.3 End-to-End Tests

**Framework:** Playwright against `docker compose` stack (mock providers, real Redis + SQLite).  
**File:** `apps/web/e2e/presentation.spec.ts`

#### Setup

Add `FakeSlideGeneratorProvider` and `FakeImageProvider` to the `worker` container's test entrypoint (same pattern as existing E2E mock providers). Set `USE_FAKE_PROVIDERS=true` env var.

---

#### `describe("Presentation session creation")`

| Test | Steps | Assertion |
|---|---|---|
| User can create a presentation session | Sign up → click "New Session" → select "Presentation" tab → fill title + prompt → leave style prompt as default → choose "Moon" theme → submit | Redirected to session page; session card shows `Presentation` badge; no budget/voice fields visible in form |
| Style prompt textarea pre-filled with default | Open new presentation session form | Textarea value equals `DEFAULT_STYLE_PROMPT` |
| Theme picker shows 7 options | Open form, inspect select element | 7 `<option>` elements |

---

#### `describe("Transcript generation for presentation")`

| Test | Steps | Assertion |
|---|---|---|
| Generates transcript and shows scene table | Create session → click "Generate Transcript" → wait for SSE complete | Scene table renders with scene rows; each row shows `presentationSlideType` badge |
| Scene edit works | Click scene 0 → Scene deep dive page → change narration → Save | Scene narration updated; version 2 in history |
| Complex animation toggle appears | Navigate to scene deep dive | "Make animated diagram" checkbox visible |
| Toggling complex on saves to scene | Check "Make animated diagram" → save | Scene badge shows "Complex" |

---

#### `describe("Presentation export")`

| Test | Steps | Assertion |
|---|---|---|
| Export button visible on presentation session | Navigate to session page | "Export as Presentation" button present; "Approve" (video) button absent |
| Export triggers SSE progress | Click "Export as Presentation" | Progress indicators appear for each scene (e.g. "2 / 2 scenes done") |
| Preview iframe renders after export | Wait for SSE complete | `<iframe>` is visible; its `src` points to the asset endpoint |
| iframe shows a Reveal.js slide | Wait for iframe load | Iframe document contains `.reveal` class element |
| Download zip button works | Click "Download as zip" | Browser downloads a `.zip` file (file-chooser or download event fires) |

---

#### `describe("Presentation screen-recording UX")`

| Test | Steps | Assertion |
|---|---|---|
| Downloaded zip contains index.html | Download zip, unzip in temp dir | `index.html` present |
| Opening index.html in headless browser shows first slide | Open `file://` URL in Playwright | Page contains at least one `<section class="present">` element |
| Pressing Space advances slide | Focus page, press Space | `.present` section changes to the next slide |
| Pressing S does not crash page (opens notes, can't fully assert in headless) | Press `s` | No JS error in console |

---

#### `describe("Auth scoping")`

| Test | Steps | Assertion |
|---|---|---|
| User B cannot export user A's presentation session | Create session as user A; attempt export as user B | 404 response |
| User B cannot download user A's zip | Same | 404 response |

---

## 3. Definition of Done per Phase

| Phase | Done when |
|---|---|
| Phase 1 (Schema) | `pnpm typecheck` passes; `pnpm test` (shared + server) passes; new schema fields present in DB via `pnpm db:push` |
| Phase 2 (Core logic) | All unit tests listed in §2.1 pass; `pnpm typecheck` passes |
| Phase 3 (API) | All integration tests in §2.2 pass; `pnpm test` green |
| Phase 4 (UI) | All E2E tests in §2.3 pass against docker-compose stack; iframe preview renders a Reveal.js presentation; zip downloads successfully |

---

## 4. File Change Summary

| File | Change type |
|---|---|
| `packages/shared/src/schemas/transcript.ts` | Modify — add `presentationSlideType`, `complexAnimation`, `diagramCode` to `Scene`; extend `RenderPath` |
| `packages/shared/src/schemas/session.ts` | Modify — add `SessionType`, `ImageProvider`, `RevealTheme`, `CreatePresentationSessionInput`, constants |
| `packages/shared/src/providers/types.ts` | Modify — add `SlideGeneratorProvider` interface; extend `ImageProvider.generateImage` with `modelTier` |
| `packages/shared/src/index.ts` | Modify — re-export new types |
| `apps/server/src/db/schema.ts` | Modify — add 4 columns to `video_sessions`; make `voiceId`/`budgetUsd` nullable |
| `apps/server/src/app.ts` | Modify — add `slideGeneratorProvider` to `AppDeps`; register `presentationRoutes` |
| `apps/server/src/routes/sessions.ts` | Modify — branch on `sessionType` in `POST /api/sessions` |
| `apps/server/src/routes/presentation.ts` | **New** — export/zip routes |
| `apps/server/src/presentation/image-prompt-builder.ts` | **New** |
| `apps/server/src/presentation/css-generator.ts` | **New** |
| `apps/server/src/presentation/slide-generator.ts` | **New** |
| `apps/server/src/presentation/diagram-generator.ts` | **New** |
| `apps/server/src/presentation/assembler.ts` | **New** |
| `apps/server/src/presentation/zip-builder.ts` | **New** |
| `apps/server/src/workers/presentation-worker.ts` | **New** |
| `apps/server/src/test/helpers.ts` | Modify — add `FakeSlideGeneratorProvider`, `FakeImageProvider` |
| `apps/server/src/test/presentation.test.ts` | **New** — integration tests |
| `apps/server/src/presentation/*.test.ts` (6 files) | **New** — unit tests per module |
| `packages/shared/src/schemas/transcript.test.ts` | Modify — extend with new field tests |
| `apps/web/src/pages/NewSession.tsx` (or equivalent) | Modify — add session type toggle + presentation form fields |
| `apps/web/src/pages/SessionEditor.tsx` | Modify — presentation branch, export button, complex toggle, preview iframe |
| `apps/web/src/api.ts` | Modify — add `createPresentationSession()`, `exportPresentation()`, `getPresentationZipUrl()` |
| `apps/web/e2e/presentation.spec.ts` | **New** — E2E tests |
