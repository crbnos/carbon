import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountLockout,
  DEFAULT_BASE_LOCK_SECONDS,
  DEFAULT_MAX_LOCK_SECONDS,
  evaluateLockFromPttl,
  lockDurationSeconds,
  normalizeLoginIdentifier
} from "./lockout";

describe("normalizeLoginIdentifier", () => {
  it("lowercases and trims so one account has one key", () => {
    expect(normalizeLoginIdentifier("  Foo@Example.COM ")).toBe(
      "foo@example.com"
    );
    expect(normalizeLoginIdentifier("foo@example.com")).toBe("foo@example.com");
    expect(normalizeLoginIdentifier("FOO@EXAMPLE.COM")).toBe("foo@example.com");
  });
});

describe("lockDurationSeconds", () => {
  it("is 0 for a non-lock (level < 1)", () => {
    expect(lockDurationSeconds(0)).toBe(0);
    expect(lockDurationSeconds(-3)).toBe(0);
    expect(lockDurationSeconds(Number.NaN)).toBe(0);
  });

  it("doubles per level from the base", () => {
    expect(lockDurationSeconds(1)).toBe(DEFAULT_BASE_LOCK_SECONDS); // 60
    expect(lockDurationSeconds(2)).toBe(DEFAULT_BASE_LOCK_SECONDS * 2); // 120
    expect(lockDurationSeconds(3)).toBe(DEFAULT_BASE_LOCK_SECONDS * 4); // 240
    expect(lockDurationSeconds(4)).toBe(DEFAULT_BASE_LOCK_SECONDS * 8); // 480
  });

  it("caps at the max", () => {
    expect(lockDurationSeconds(99)).toBe(DEFAULT_MAX_LOCK_SECONDS);
  });

  it("honors custom base/max", () => {
    expect(lockDurationSeconds(1, { baseLockSeconds: 30 })).toBe(30);
    expect(lockDurationSeconds(3, { baseLockSeconds: 30 })).toBe(120);
    expect(
      lockDurationSeconds(10, { baseLockSeconds: 30, maxLockSeconds: 90 })
    ).toBe(90);
  });

  it("floors a fractional level", () => {
    expect(lockDurationSeconds(2.9)).toBe(DEFAULT_BASE_LOCK_SECONDS * 2);
  });
});

describe("evaluateLockFromPttl", () => {
  it("treats missing (-2) and no-expiry (-1) and <=0 as unlocked", () => {
    expect(evaluateLockFromPttl(-2)).toEqual({
      locked: false,
      retryAfterSeconds: 0
    });
    expect(evaluateLockFromPttl(-1)).toEqual({
      locked: false,
      retryAfterSeconds: 0
    });
    expect(evaluateLockFromPttl(0)).toEqual({
      locked: false,
      retryAfterSeconds: 0
    });
  });

  it("reports locked with ceil(seconds) for a positive TTL", () => {
    expect(evaluateLockFromPttl(59_400)).toEqual({
      locked: true,
      retryAfterSeconds: 60
    });
    expect(evaluateLockFromPttl(1)).toEqual({
      locked: true,
      retryAfterSeconds: 1
    });
  });
});

/**
 * Hand-rolled mock redis (mirrors ratelimit.test.ts): the sliding-window limiter
 * runs a lua `eval`, which ioredis-mock does not execute, so we control it here.
 */
const createMockRedis = () => {
  const storage = new Map<string, unknown>();

  return {
    eval: vi.fn(),
    pttl: vi.fn().mockImplementation((key: string) => {
      const entry = storage.get(key) as { pttl: number } | undefined;
      return Promise.resolve(entry ? entry.pttl : -2);
    }),
    incr: vi.fn().mockImplementation((key: string) => {
      const next = ((storage.get(key) as number | undefined) ?? 0) + 1;
      storage.set(key, next);
      return Promise.resolve(next);
    }),
    expire: vi.fn().mockResolvedValue(1),
    set: vi
      .fn()
      .mockImplementation(
        (
          key: string,
          _v: unknown,
          _ex: string,
          seconds: number,
          nx?: string
        ) => {
          // Honor SET ... NX: a claim on an already-held lock returns null,
          // which is how the resilient client also signals "not set".
          if (nx === "NX" && storage.has(key)) return Promise.resolve(null);
          storage.set(key, { pttl: seconds * 1000 });
          return Promise.resolve("OK");
        }
      ),
    del: vi.fn().mockImplementation((...keys: string[]) => {
      keys.forEach((k) => {
        storage.delete(k);
      });
      return Promise.resolve(keys.length);
    }),
    _storage: storage
  } as unknown as Redis & { _storage: Map<string, unknown> };
};

/** Make the sliding-window `eval` return [remaining, limit]. remaining<0 = over. */
const stubWindow = (redis: Redis, remaining: number, limit = 5) => {
  (redis.eval as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    remaining,
    limit
  ]);
};

describe("AccountLockout", () => {
  let redis: Redis & { _storage: Map<string, unknown> };

  beforeEach(() => {
    redis = createMockRedis();
    vi.clearAllMocks();
  });

  it("status is unlocked when no lock key exists", async () => {
    const lockout = new AccountLockout({ redis });
    await expect(lockout.status("user@x.com")).resolves.toEqual({
      locked: false,
      retryAfterSeconds: 0
    });
  });

  it("recordFailure under the window does not lock", async () => {
    const lockout = new AccountLockout({ redis });
    stubWindow(redis, 3); // still 3 attempts remaining
    const res = await lockout.recordFailure("user@x.com");
    expect(res.locked).toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("recordFailure over the window engages a level-1 exponential lock", async () => {
    const lockout = new AccountLockout({ redis });
    stubWindow(redis, -1); // over the allowance
    const res = await lockout.recordFailure("User@X.com ");
    expect(res.locked).toBe(true);
    expect(res.retryAfterSeconds).toBe(DEFAULT_BASE_LOCK_SECONDS);
    // keyed by the NORMALIZED email, claimed atomically with NX
    expect(redis.set).toHaveBeenCalledWith(
      "@carbon/lockout:locked:user@x.com",
      "1",
      "EX",
      DEFAULT_BASE_LOCK_SECONDS,
      "NX"
    );
  });

  it("escalates the lock duration on repeat lockouts", async () => {
    const lockout = new AccountLockout({ redis });

    stubWindow(redis, -1);
    const first = await lockout.recordFailure("user@x.com");
    expect(first.retryAfterSeconds).toBe(DEFAULT_BASE_LOCK_SECONDS); // 60

    // Simulate the first lock having expired (clear lock key, keep level).
    redis._storage.delete("@carbon/lockout:locked:user@x.com");

    stubWindow(redis, -1);
    const second = await lockout.recordFailure("user@x.com");
    expect(second.retryAfterSeconds).toBe(DEFAULT_BASE_LOCK_SECONDS * 2); // 120
  });

  it("a concurrent burst engages the lock exactly once (no escalation inflation)", async () => {
    const lockout = new AccountLockout({ redis });
    // Every request in the burst clears the window.
    (redis.eval as ReturnType<typeof vi.fn>).mockResolvedValue([-1, 5]);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => lockout.recordFailure("user@x.com"))
    );

    // All observe a lock, all at the BASE duration — one burst is ONE offense,
    // never eight escalations that inflate the lock toward the cap.
    expect(results.every((r) => r.locked)).toBe(true);
    expect(
      results.every((r) => r.retryAfterSeconds === DEFAULT_BASE_LOCK_SECONDS)
    ).toBe(true);
    // The escalation level was incremented once, by the single claim winner.
    expect(redis.incr).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN (no phantom lock) when the lock write fails soft", async () => {
    const lockout = new AccountLockout({ redis });
    stubWindow(redis, -1); // over the window
    // The resilient client returns null for the SET when Redis is unreachable.
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const res = await lockout.recordFailure("user@x.com");

    // Must NOT report `{ locked: true, retryAfterSeconds: 0 }` with no stored
    // lock — a failed claim falls through to status(), which fails open.
    expect(res).toEqual({ locked: false, retryAfterSeconds: 0 });
    // No escalation on a claim that never landed.
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it("recordFailure short-circuits to the existing lock without consuming an attempt", async () => {
    const lockout = new AccountLockout({ redis });
    // Pre-seed an active lock.
    redis._storage.set("@carbon/lockout:locked:user@x.com", { pttl: 30_000 });

    const res = await lockout.recordFailure("user@x.com");
    expect(res).toEqual({ locked: true, retryAfterSeconds: 30 });
    expect(redis.eval).not.toHaveBeenCalled(); // never touched the window counter
  });

  it("status reports an active lock with retry seconds", async () => {
    const lockout = new AccountLockout({ redis });
    redis._storage.set("@carbon/lockout:locked:user@x.com", { pttl: 45_000 });
    await expect(lockout.status("USER@x.com")).resolves.toEqual({
      locked: true,
      retryAfterSeconds: 45
    });
  });

  it("reset clears the lock and level keys", async () => {
    const lockout = new AccountLockout({ redis });
    redis._storage.set("@carbon/lockout:locked:user@x.com", { pttl: 30_000 });
    redis._storage.set("@carbon/lockout:level:user@x.com", 2);

    await lockout.reset("user@x.com");
    expect(redis.del).toHaveBeenCalledWith(
      "@carbon/lockout:locked:user@x.com",
      "@carbon/lockout:level:user@x.com"
    );
    await expect(lockout.status("user@x.com")).resolves.toEqual({
      locked: false,
      retryAfterSeconds: 0
    });
  });

  it("fails OPEN when redis throws (a KV outage must not wall out auth)", async () => {
    const lockout = new AccountLockout({ redis });
    (redis.pttl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("connection refused")
    );
    await expect(lockout.status("user@x.com")).resolves.toEqual({
      locked: false,
      retryAfterSeconds: 0
    });
  });
});
