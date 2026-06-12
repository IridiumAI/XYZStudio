import { Worker } from "bullmq";
import { loadConfig } from "./config.js";
import { QUEUE_NAMES, redisConnection } from "./queue/index.js";

/** Queue worker entrypoint (docker-compose `worker` service).
 * Phase 1: consumers are stubs that log and complete — Phase 2 replaces them
 * with sketch/clip/voice/assemble processors (design §6, §7). */

const config = loadConfig();
const connection = redisConnection(config);

const workers = Object.values(QUEUE_NAMES).map(
  (name) =>
    new Worker(
      name,
      async (job) => {
        console.log(`[worker] ${name} job ${job.id} received (Phase 2 stub)`, {
          data: job.data,
        });
      },
      { connection },
    ),
);

console.log(
  `[worker] listening on queues: ${Object.values(QUEUE_NAMES).join(", ")}`,
);

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
