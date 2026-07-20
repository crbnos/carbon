import { getLogger } from "@carbon/logger";
import type Redis from "ioredis";

export const REDIS_TIMEOUT_MS = 2000;
const LOG_THROTTLE_MS = 10_000;

const log = getLogger("kv");

let lastLoggedAt = 0;
let unavailable = false;

export function logUnavailable(err: unknown): void {
  const now = Date.now();
  if (!unavailable || now - lastLoggedAt >= LOG_THROTTLE_MS) {
    log.error("Redis is unavailable, running in degraded mode", {
      event: "redis.degraded",
      cause: err instanceof Error ? err.message : String(err)
    });
    lastLoggedAt = now;
  }
  unavailable = true;
}

function logReconnected(): void {
  if (unavailable) {
    log.info("Redis reconnected", { event: "redis.recovered" });
    unavailable = false;
  }
}

// Never null: returning null ends ioredis reconnection permanently, defeating auto-recovery.
export const reconnectStrategy = (times: number): number =>
  Math.min(times * 200, 5000);

function guard<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      logUnavailable(new Error("redis timeout"));
      finish(fallback);
    }, REDIS_TIMEOUT_MS);

    // A late settle after the timeout is swallowed (finish no-ops once settled).
    promise.then(
      (value) => {
        clearTimeout(timer);
        logReconnected();
        finish(value);
      },
      (err) => {
        clearTimeout(timer);
        logUnavailable(err);
        finish(fallback);
      }
    );
  });
}

// Collection commands fall back to [] (not null) so callers can iterate safely.
const ARRAY_FALLBACK = new Set([
  "keys",
  "mget",
  "hkeys",
  "hvals",
  "smembers",
  "lrange",
  "zrange",
  "zrevrange",
  "sscan",
  "hscan",
  "zscan"
]);

const fallbackFor = (command: string): unknown =>
  ARRAY_FALLBACK.has(command.toLowerCase()) ? [] : null;

function wrapPipeline<
  T extends { exec?: (...args: unknown[]) => Promise<unknown> }
>(pipeline: T): T {
  // Pipelines are chainable objects the proxy can't reach; guard their exec() instead.
  if (pipeline && typeof pipeline.exec === "function") {
    const originalExec = pipeline.exec.bind(pipeline);
    pipeline.exec = (...args: unknown[]) =>
      guard(originalExec(...args), [] as unknown[]);
  }
  return pipeline;
}

// Proxy the client so an unreachable Redis degrades (reads null, collections [], writes null) instead of throwing.
export function withResilience(client: Redis): Redis {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;

      const command = typeof prop === "string" ? prop : "";

      if (command === "pipeline" || command === "multi") {
        return (...args: unknown[]) =>
          wrapPipeline(
            (
              value as (...a: unknown[]) => {
                exec?: (...a: unknown[]) => Promise<unknown>;
              }
            ).apply(target, args)
          );
      }

      return (...args: unknown[]) => {
        let result: unknown;
        try {
          result = (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (err) {
          logUnavailable(err);
          return Promise.resolve(fallbackFor(command));
        }
        if (result && typeof (result as Promise<unknown>).then === "function") {
          return guard(result as Promise<unknown>, fallbackFor(command));
        }
        return result;
      };
    }
  }) as Redis;
}
