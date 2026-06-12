import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Config } from "../config.js";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

export function createDb(config: Config) {
  mkdirSync(dirname(config.sqlitePath), { recursive: true });
  const sqlite = new Database(config.sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
