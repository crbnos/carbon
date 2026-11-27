// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
      error: err
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

function guard<T>(
  promise: Promise<T>,
  fallback: T,
  answered: (ok: boolean) => void
): Promise<T> {
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
      answered(false);
      finish(fallback);
    }, REDIS_TIMEOUT_MS);

    // A late settle after the timeout is swallowed (finish no-ops once settled).
    promise.then(
      (value) => {
        clearTimeout(timer);
        logReconnected();
        answered(true);
        finish(value);
      },
      (err) => {
        clearTimeout(timer);
        logUnavailable(err);
        answered(false);
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
>(pipeline: T, link: Link): T {
  // Pipelines are chainable objects the proxy can't reach; guard their exec() instead.
  if (pipeline && typeof pipeline.exec === "function") {
    const originalExec = pipeline.exec.bind(pipeline);
    pipeline.exec = (...args: unknown[]) =>
      link.isDown()
        ? link.skip([] as unknown[])
        : guard(originalExec(...args), [] as unknown[], link.answered);
  }
  return pipeline;
}

/** Whether one client's Redis is known to be down, and what to do then. */
type Link = {
  isDown(): boolean;
  answered(ok: boolean): void;
  skip<T>(fallback: T): Promise<T>;
};

/**
 * While Redis is down, a command is not sent: it gets its fallback at once.
 * Sending it would wait `REDIS_TIMEOUT_MS` for the same answer, on every
 * command of every request, and queue the command in ioredis.
 *
 * Down means a command failed or timed out AND the connection is not ready.
 * ioredis keeps reconnecting on its own (`reconnectStrategy` never gives up),
 * so when the connection is ready again commands are sent again, and the first
 * that succeeds clears the state. A timeout on a ready connection (one slow
 * command) does not stop the next command from being sent.
 */
function linkOf(client: Redis): Link {
  let failed = false;
  return {
    isDown: () => failed && client.status !== "ready",
    answered(ok) {
      failed = !ok;
    },
    skip(fallback) {
      logUnavailable(new Error("redis unavailable, command not sent"));
      return Promise.resolve(fallback);
    }
  };
}

// Proxy the client so an unreachable Redis degrades (reads null, collections [], writes null) instead of throwing.
export function withResilience(client: Redis): Redis {
  const link = linkOf(client);
  // Only a Redis command is skipped while down: `on`, `duplicate` and the
  // like still run.
  const commands = new Set(client.getBuiltinCommands?.() ?? []);
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
            ).apply(target, args),
            link
          );
      }

      return (...args: unknown[]) => {
        if (commands.has(command) && link.isDown()) {
          return link.skip(fallbackFor(command));
        }
        let result: unknown;
        try {
          result = (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (err) {
          logUnavailable(err);
          link.answered(false);
          return Promise.resolve(fallbackFor(command));
        }
        if (result && typeof (result as Promise<unknown>).then === "function") {
          return guard(
            result as Promise<unknown>,
            fallbackFor(command),
            link.answered
          );
        }
        return result;
      };
    }
  }) as Redis;
}
