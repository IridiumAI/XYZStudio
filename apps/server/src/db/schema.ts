import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// better-auth tables (standard shape expected by the drizzle adapter).
// Our app's video sessions live in `video_sessions` to avoid colliding with
// the auth `session` table.
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

/** Signup allowlist (decisions E/H): seeded from ALLOWLIST_EMAILS, extended
 * by inserting rows directly. */
export const allowlist = sqliteTable("allowlist", {
  email: text("email").primaryKey(),
  addedAt: integer("added_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// Application tables (design §5)
// ---------------------------------------------------------------------------

export const videoSessions = sqliteTable("video_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  ideaPrompt: text("idea_prompt").notNull(),
  style: text("style").notNull(), // cartoon | whiteboard
  language: text("language").notNull(), // en | zh-Hans
  aspect: text("aspect").notNull(), // 16x9 | 9x16
  // video sessions: real voice id; presentation sessions: empty string sentinel
  voiceId: text("voice_id").notNull().default(""),
  // video sessions: 1-200 budget; presentation sessions: 0 sentinel
  budgetUsd: real("budget_usd").notNull().default(0),
  status: text("status").notNull().default("drafting"),
  // "video" | "presentation"
  sessionType: text("session_type").notNull().default("video"),
  // presentation sessions only
  presentationStylePrompt: text("presentation_style_prompt"),
  revealTheme: text("reveal_theme"),
  imageProvider: text("image_provider"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Immutable transcript versions; `content` is the full Transcript JSON. */
export const transcriptVersions = sqliteTable("transcript_versions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  source: text("source").notNull(), // generated | user_edit | llm_revision
  feedbackMessage: text("feedback_message"), // the user feedback that produced an llm_revision
  content: text("content", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const styleBibles = sqliteTable("style_bibles", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  stylePrompt: text("style_prompt").notNull(),
  characterSheets: text("character_sheets", { mode: "json" }).notNull(), // asset id refs
});

export const costPlans = sqliteTable("cost_plans", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  perSceneRouting: text("per_scene_routing", { mode: "json" }).notNull(),
  estimatedTotalUsd: real("estimated_total_usd").notNull(),
});

/** Ledger of actual provider spend (design §4.4).
 * isPreview=true entries are from scene deep-dive "Generate narration/video" previews
 * and are excluded from the session's actualSpendUsd (they don't count against the budget). */
export const costEntries = sqliteTable("cost_entries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  jobId: text("job_id"),
  provider: text("provider").notNull(),
  actualCostUsd: real("actual_cost_usd").notNull(),
  isPreview: integer("is_preview", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // transcript | sketch | scene_clip | voice | metadata | assemble
  sceneId: text("scene_id"),
  status: text("status").notNull().default("queued"),
  error: text("error", { mode: "json" }),
  attempts: integer("attempts").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  sceneIndex: integer("scene_index"),
  kind: text("kind").notNull(), // sketch | keyframe | clip | voice | final_video | thumbnail | presentation | diagram
  language: text("language"), // en | zh-Hans | null for visual-only assets (decision I)
  path: text("path").notNull(), // relative to STORAGE_ROOT
  providerMeta: text("provider_meta", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Per-scene user selections for narration and video preview assets.
 * One row per (sessionId, sceneIndex). The selected asset IDs are used by
 * the pipeline to skip re-generation for scenes already approved. */
export const sceneSelections = sqliteTable("scene_selections", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  sceneIndex: integer("scene_index").notNull(),
  selectedNarrationAssetId: text("selected_narration_asset_id"),
  selectedVideoAssetId: text("selected_video_asset_id"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const videoOutputs = sqliteTable("video_outputs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  finalVideoAssetId: text("final_video_asset_id"),
  metadata: text("metadata", { mode: "json" }), // title, description + chapters, hashtags per platform
});
