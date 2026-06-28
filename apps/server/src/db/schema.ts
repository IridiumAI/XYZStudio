import {
  pgSchema,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
} from "drizzle-orm/pg-core";

export const DB_SCHEMA_NAME = "XYZStudio";
const s = pgSchema(DB_SCHEMA_NAME);

// ---------------------------------------------------------------------------
// better-auth tables (standard shape expected by the drizzle adapter).
// Our app's video sessions live in `video_sessions` to avoid colliding with
// the auth `session` table.
// ---------------------------------------------------------------------------

export const user = s.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const session = s.table("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = s.table("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = s.table("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

/** Signup allowlist (decisions E/H): seeded from ALLOWLIST_EMAILS, extended
 * by inserting rows directly. */
export const allowlist = s.table("allowlist", {
  email: text("email").primaryKey(),
  addedAt: timestamp("added_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// Application tables (design §5)
// ---------------------------------------------------------------------------

export const videoSessions = s.table("video_sessions", {
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
  budgetUsd: doublePrecision("budget_usd").notNull().default(0),
  status: text("status").notNull().default("drafting"),
  // "video" | "presentation"
  sessionType: text("session_type").notNull().default("video"),
  // presentation sessions only
  presentationStylePrompt: text("presentation_style_prompt"),
  revealTheme: text("reveal_theme"),
  imageProvider: text("image_provider"),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Immutable transcript versions; `content` is the full Transcript JSON. */
export const transcriptVersions = s.table("transcript_versions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  source: text("source").notNull(), // generated | user_edit | llm_revision
  feedbackMessage: text("feedback_message"),
  content: jsonb("content").notNull(),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const styleBibles = s.table("style_bibles", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  stylePrompt: text("style_prompt").notNull(),
  characterSheets: jsonb("character_sheets").notNull(),
});

export const costPlans = s.table("cost_plans", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  perSceneRouting: jsonb("per_scene_routing").notNull(),
  estimatedTotalUsd: doublePrecision("estimated_total_usd").notNull(),
});

/** Ledger of actual provider spend (design §4.4). */
export const costEntries = s.table("cost_entries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  jobId: text("job_id"),
  provider: text("provider").notNull(),
  actualCostUsd: doublePrecision("actual_cost_usd").notNull(),
  isPreview: boolean("is_preview").notNull().default(false),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const jobs = s.table("jobs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  sceneId: text("scene_id"),
  status: text("status").notNull().default("queued"),
  error: jsonb("error"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const assets = s.table("assets", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  sceneIndex: integer("scene_index"),
  kind: text("kind").notNull(),
  language: text("language"),
  path: text("path").notNull(),
  providerMeta: jsonb("provider_meta"),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sceneSelections = s.table("scene_selections", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  sceneIndex: integer("scene_index").notNull(),
  selectedNarrationAssetId: text("selected_narration_asset_id"),
  selectedVideoAssetId: text("selected_video_asset_id"),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const videoOutputs = s.table("video_outputs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => videoSessions.id, { onDelete: "cascade" }),
  finalVideoAssetId: text("final_video_asset_id"),
  metadata: jsonb("metadata"),
});
