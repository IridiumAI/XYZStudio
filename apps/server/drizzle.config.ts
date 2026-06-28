import { config as dotenvConfig } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

dotenvConfig({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"),
  override: false,
});

const {
  DB_USERNAME = "postgres",
  DB_PASSWORD = "",
  DB_HOST_NAME = "localhost",
  DB_PORT = "5432",
  DB_NAME = "postgres",
} = process.env;

const pw = encodeURIComponent(DB_PASSWORD);
const url = `postgresql://${DB_USERNAME}:${pw}@${DB_HOST_NAME}:${DB_PORT}/${DB_NAME}`;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url, ssl: { rejectUnauthorized: false } },
  schemaFilter: ["XYZStudio"],
});
