import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Config } from "../config.js";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

export function createDb(config: Config) {
  mkdirSync(dirname(config.sqlitePath), { recursive: true });
  const sqlite = new Database(config.sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
