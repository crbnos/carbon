import { REDIS_URL } from "@carbon/env";
import Redis from "ioredis";
import { logUnavailable, reconnectStrategy, withResilience } from "./resilient";

declare global {
  var __redis: Redis | undefined;
}

if (!REDIS_URL) {
  throw new Error("REDIS_URL is not defined");
}

if (!global.__redis) {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true, // don't connect until first command
    enableOfflineQueue: true, // buffer commands while connecting
    retryStrategy: reconnectStrategy
  });
  // Registered once; without a listener ioredis re-emits errors as unhandled process events.
  client.on("error", logUnavailable);
  global.__redis = client;
}

const redis = withResilience(global.__redis);

export default redis;
