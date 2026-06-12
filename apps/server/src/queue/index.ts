import { Queue } from "bullmq";
import type { Config } from "../config.js";

/** BullMQ wiring (design §7). Phase 1 only establishes the topology; the
 * per-scene generation queues are consumed by src/worker.ts in Phase 2. */

export const QUEUE_NAMES = {
  sketch: "sketch",
  sceneClip: "scene_clip",
  voice: "voice",
  assemble: "assemble",
} as const;

export function redisConnection(config: Config) {
  const url = new URL(config.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
}

export function createQueues(config: Config) {
  const connection = redisConnection(config);
  const defaultJobOptions = {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 5_000 },
    removeOnComplete: { age: 24 * 3600 },
  };
  return {
    sketch: new Queue(QUEUE_NAMES.sketch, { connection, defaultJobOptions }),
    sceneClip: new Queue(QUEUE_NAMES.sceneClip, { connection, defaultJobOptions }),
    voice: new Queue(QUEUE_NAMES.voice, { connection, defaultJobOptions }),
    assemble: new Queue(QUEUE_NAMES.assemble, { connection, defaultJobOptions }),
  };
}

export type Queues = ReturnType<typeof createQueues>;
