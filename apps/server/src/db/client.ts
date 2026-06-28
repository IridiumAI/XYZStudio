import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Config } from "../config.js";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

export function createDb(config: Config) {
  const client = postgres(config.databaseUrl, {
    max: 10,
    ssl: { rejectUnauthorized: false },
  });
  return drizzle(client, { schema });
}

export async function runMigrations(config: Config) {
  const client = postgres(config.databaseUrl, {
    max: 1,
    ssl: { rejectUnauthorized: false },
  });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  await client.end();
}
