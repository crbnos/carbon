import type Redis from "ioredis";
import RedisMock from "ioredis-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ratelimit } from "./ratelimit";
import {
  REDIS_TIMEOUT_MS,
  reconnectStrategy,
  withResilience
} from "./resilient";

/** A client whose every command rejects immediately (Redis unreachable). */
function failingClient(): Redis {
  const reject = () => Promise.reject(new Error("ECONNREFUSED"));
  return {
    on: () => undefined,
    get: reject,
    set: reject,
    del: reject,
    getdel: reject,
    setex: reject,
    keys: reject,
    eval: reject,
    pipeline: () => {
      const p: Record<string, unknown> = {};
      p.del = () => p;
      p.set = () => p;
      p.exec = reject;
      return p;
    }
  } as unknown as Redis;
}

describe("withResilience", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("healthy Redis (pass-through)", () => {
    it("returns real values, unchanged", async () => {
      const redis = withResilience(new RedisMock() as unknown as Redis);

      expect(await redis.set("k", "v")).toBe("OK");
      expect(await redis.get("k")).toBe("v");
      expect(await redis.del("k")).toBe(1);
      expect(await redis.get("k")).toBeNull();
    });

    it("passes through collection commands", async () => {
      const redis = withResilience(new RedisMock() as unknown as Redis);
      await redis.set("a", "1");
      await redis.set("b", "2");

      expect((await redis.keys("*")).sort()).toEqual(["a", "b"]);
    });

    it("passes through pipelines", async () => {
      const redis = withResilience(new RedisMock() as unknown as Redis);
      const result = await redis.pipeline().set("a", "1").set("b", "2").exec();

      expect(result).toHaveLength(2);
    });
  });

  describe("unreachable Redis (fail-soft)", () => {
    it("resolves null for a read instead of throwing", async () => {
      const redis = withResilience(failingClient());
      await expect(redis.get("k")).resolves.toBeNull();
    });

    it("resolves null for a write instead of throwing", async () => {
      const redis = withResilience(failingClient());
      await expect(redis.set("k", "v")).resolves.toBeNull();
      await expect(redis.del("k")).resolves.toBeNull();
      await expect(redis.setex("k", 60, "v")).resolves.toBeNull();
    });

    it("resolves [] for collection commands so iteration is safe", async () => {
      const redis = withResilience(failingClient());
      const keys = await redis.keys("prefix:*");

      expect(keys).toEqual([]);
      expect(Array.isArray(keys)).toBe(true);
    });

    it("resolves [] for a pipeline exec", async () => {
      const redis = withResilience(failingClient());
      await expect(redis.pipeline().del("a").del("b").exec()).resolves.toEqual(
        []
      );
    });
  });

  describe("hanging Redis (timeout)", () => {
    it("falls back after REDIS_TIMEOUT_MS instead of hanging forever", async () => {
      vi.useFakeTimers();
      const hanging = {
        on: () => undefined,
        get: () => new Promise(() => undefined) // never settles
      } as unknown as Redis;
      const redis = withResilience(hanging);

      const pending = redis.get("k");
      await vi.advanceTimersByTimeAsync(REDIS_TIMEOUT_MS);

      await expect(pending).resolves.toBeNull();
    });
  });
});

describe("reconnectStrategy", () => {
  // Returning null would tell ioredis to stop reconnecting permanently — the
  // exact bug that defeats auto-recovery. This guards against a revert.
  it("never returns null, so the client keeps reconnecting", () => {
    for (const times of [1, 2, 3, 10, 100, 1000]) {
      expect(reconnectStrategy(times)).not.toBeNull();
      expect(typeof reconnectStrategy(times)).toBe("number");
    }
  });

  it("backs off with an increasing, capped delay", () => {
    expect(reconnectStrategy(1)).toBeLessThan(reconnectStrategy(5));
    expect(reconnectStrategy(1000)).toBe(5000);
  });
});

describe("Ratelimit fail-open when Redis is down", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("allows the request (success: true) instead of throwing", async () => {
    const limiter = new Ratelimit({
      redis: failingClient(),
      limiter: Ratelimit.fixedWindow(5, "1 m"),
      timeout: 0
    });

    const result = await limiter.limit("user:1");
    expect(result.success).toBe(true);
  });

  it("still enforces limits when Redis is healthy", async () => {
    const limiter = new Ratelimit({
      redis: new RedisMock() as unknown as Redis,
      limiter: Ratelimit.fixedWindow(2, "1 m"),
      timeout: 0
    });

    expect((await limiter.limit("user:2")).success).toBe(true);
    expect((await limiter.limit("user:2")).success).toBe(true);
    expect((await limiter.limit("user:2")).success).toBe(false);
  });
});
