import { createAuthClient } from "better-auth/react";

/** Same-origin in dev (Vite proxies /api → server) and in prod (nginx). */
export const authClient = createAuthClient();

export const { useSession, signIn, signUp, signOut } = authClient;
