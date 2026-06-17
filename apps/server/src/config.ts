import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().default("file:./data/xyzstudio.db"),
  STORAGE_ROOT: z.string().default("./data"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET required — openssl rand -base64 32"),
  AUTH_URL: z.string().default("http://localhost:3000"),
  ALLOWLIST_EMAILS: z.string().default(""),
  ALLOWLIST_PASSWORD: z.string().default("2333"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  MAX_BUDGET_PER_VIDEO_USD: z.coerce.number().default(200),
  BUDGET_SAFETY_CEILING_MULTIPLIER: z.coerce.number().default(1.5),
});

export type Config = z.infer<typeof Env> & {
  sqlitePath: string;
  allowlistSeed: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  return {
    ...parsed,
    sqlitePath: parsed.DATABASE_URL.replace(/^file:/, ""),
    allowlistSeed: parsed.ALLOWLIST_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}
