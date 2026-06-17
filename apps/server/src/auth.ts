import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import * as schema from "./db/schema.js";

/** Allowlist check (decisions E/H): env seed list OR a row in `allowlist`. */
export async function isEmailAllowed(
  db: Db,
  config: Config,
  email: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (config.allowlistSeed.includes(normalized)) return true;
  const rows = await db
    .select()
    .from(schema.allowlist)
    .where(eq(schema.allowlist.email, normalized))
    .limit(1);
  return rows.length > 0;
}

export function createAuth(db: Db, config: Config) {
  return betterAuth({
    secret: config.AUTH_SECRET,
    baseURL: config.AUTH_URL,
    trustedOrigins: [config.WEB_ORIGIN],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 4,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (newUser) => {
            if (!(await isEmailAllowed(db, config, newUser.email))) {
              throw new APIError("FORBIDDEN", {
                message: "This email is not on the signup allowlist.",
              });
            }
            return { data: newUser };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
