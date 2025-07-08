import { UPSTASH_REDIS_REST_TOKEN, UPSTASH_REDIS_REST_URL } from "@carbon/auth";
import type { Redis as RedisType } from "@upstash/redis";
import { Redis } from "@upstash/redis";

let redis: RedisType;

declare global {
  var __redis: RedisType | undefined;
}

if (!UPSTASH_REDIS_REST_URL) {
  throw new Error("UPSTASH_REDIS_REST_URL is not defined");
}

if (!UPSTASH_REDIS_REST_TOKEN) {
  throw new Error("UPSTASH_REDIS_REST_TOKEN is not defined");
}

// this is needed because in development we don't want to restart
// the server with every change, but we want to make sure we don't
// create a new connection to the Redis with every change either.
if (process.env.VERCEL_ENV === "production") {
  redis = new Redis({
    url: UPSTASH_REDIS_REST_URL,
    token: UPSTASH_REDIS_REST_TOKEN,
  });
} else {
  if (!global.__redis) {
    global.__redis = new Redis({
      url: UPSTASH_REDIS_REST_URL,
      token: UPSTASH_REDIS_REST_TOKEN,
    });
  }
  redis = global.__redis;
}

export default redis;
