import "./env.js";
import { buildApp } from "./app.js";
import { createAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { AnthropicTextProvider } from "./providers/anthropic.js";

const config = loadConfig();
const db = createDb(config);
const auth = createAuth(db, config);
const textProvider = config.ANTHROPIC_API_KEY
  ? new AnthropicTextProvider(config.ANTHROPIC_API_KEY)
  : null;

if (!textProvider) {
  console.warn(
    "[server] ANTHROPIC_API_KEY not set — transcript generation disabled (503)",
  );
}

const app = await buildApp({ config, db, auth, textProvider });

try {
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
