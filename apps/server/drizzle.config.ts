import { config as dotenvConfig } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

dotenvConfig({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"),
  override: false,
});

const url = (process.env.DATABASE_URL ?? "file:./data/xyzstudio.db").replace(
  /^file:/,
  "",
);

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
