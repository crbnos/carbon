import type { Redis } from "ioredis";
import { Ratelimit } from "../ratelimit";
import type { Duration } from "../ratelimit/types";

/**
 * Per-account failed-login lockout (NIST SP 800-171 3.1.8 / AC-7).
 *
 * The login routes already rate-limit by IP (`Ratelimit.slidingWindow`, key = ip).
 * That caps a single source but never a single ACCOUNT: an attacker rotating IPs,
 * or hammering one email to spam magic links / probe existence, is unbounded per
 * email. This layer adds an EMAIL-keyed attempt counter with a temporary,
 * exponentially-backed-off lock — additive, on top of the IP limit, never a
 * replacement for it.
 *
 * The primary flow is passwordless magic-link, so "failed attempt" here means an
 * attempt against an account, not a wrong password; the control 3.1.8 asks for is
 * the account-scoped cap, which this provides while guarding enumeration/abuse.
 *
 * Redis outages fail OPEN (a KV blip must never wall a user out of auth): every
 * I/O path swallows its error and reports "not locked".
 */

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_WINDOW: Duration = "15 m";
export const DEFAULT_BASE_LOCK_SECONDS = 60; // first lock: 1 minute
export const DEFAULT_MAX_LOCK_SECONDS = 60 * 60; // cap: 1 hour
/** How long a lock "level" survives so repeat offenders keep escalating. */
export const DEFAULT_LEVEL_TTL_SECONDS = 24 * 60 * 60; // 1 day

const DEFAULT_PREFIX = "@carbon/lockout";

/**
 * Normalize an email into the lockout key: trim + lowercase so `Foo@x.com `,
 * `foo@x.com`, and `FOO@X.COM` all count against ONE account. Keys are derived
 * only from this — never the raw input.
 */
export function normalizeLoginIdentifier(email: string): string {
  return email.trim().toLowerCase();
}

export interface LockDurationOptions {
  baseLockSeconds?: number;
  maxLockSeconds?: number;
}

/**
 * Exponential backoff for the Nth engaged lock, capped.
 * level 1 → base, level 2 → base·2, level 3 → base·4, … clamped to max.
 * `level < 1` is not a lock (0 seconds).
 */
export function lockDurationSeconds(
  level: number,
  options: LockDurationOptions = {}
): number {
  if (!Number.isFinite(level) || level < 1) return 0;
  const base = options.baseLockSeconds ?? DEFAULT_BASE_LOCK_SECONDS;
  const max = options.maxLockSeconds ?? DEFAULT_MAX_LOCK_SECONDS;
  const raw = base * 2 ** (Math.floor(level) - 1);
  return Math.min(raw, max);
}

export interface LockoutStatus {
  /** True while the account is inside an active lock window. */
  locked: boolean;
  /** Whole seconds until the lock lifts (ceil); 0 when not locked. */
  retryAfterSeconds: number;
}

const NOT_LOCKED: LockoutStatus = { locked: false, retryAfterSeconds: 0 };

/**
 * Turn a redis PTTL (ms; -1 no-expiry, -2 missing) into a status. Pure so the
 * lock-window decision is testable without redis.
 */
export function evaluateLockFromPttl(pttlMs: number): LockoutStatus {
  if (!Number.isFinite(pttlMs) || pttlMs <= 0) return NOT_LOCKED;
  return { locked: true, retryAfterSeconds: Math.ceil(pttlMs / 1000) };
}

export interface AccountLockoutOptions {
  redis: Redis;
  /** Failed attempts allowed per window before a lock engages. */
  maxAttempts?: number;
  /** Sliding window the attempts are counted over. */
  window?: Duration;
  baseLockSeconds?: number;
  maxLockSeconds?: number;
  levelTtlSeconds?: number;
  prefix?: string;
}

export class AccountLockout {
  private readonly redis: Redis;
  private readonly ratelimit: Ratelimit;
  private readonly baseLockSeconds: number;
  private readonly maxLockSeconds: number;
  private readonly levelTtlSeconds: number;
  private readonly prefix: string;

  constructor(options: AccountLockoutOptions) {
    this.redis = options.redis;
    this.baseLockSeconds = options.baseLockSeconds ?? DEFAULT_BASE_LOCK_SECONDS;
    this.maxLockSeconds = options.maxLockSeconds ?? DEFAULT_MAX_LOCK_SECONDS;
    this.levelTtlSeconds = options.levelTtlSeconds ?? DEFAULT_LEVEL_TTL_SECONDS;
    this.prefix = options.prefix ?? DEFAULT_PREFIX;

    this.ratelimit = new Ratelimit({
      redis: this.redis,
      limiter: Ratelimit.slidingWindow(
        options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        options.window ?? DEFAULT_WINDOW
      ),
      prefix: `${this.prefix}:attempts`
    });
  }

  private lockKey(id: string): string {
    return `${this.prefix}:locked:${id}`;
  }

  private levelKey(id: string): string {
    return `${this.prefix}:level:${id}`;
  }

  /**
   * Read-only: is this account currently locked? Consumes no attempt — call it
   * first on every login POST so an already-locked account is rejected before
   * any work (magic link, user lookup) runs.
   */
  async status(email: string): Promise<LockoutStatus> {
    const id = normalizeLoginIdentifier(email);
    try {
      const pttl = await this.redis.pttl(this.lockKey(id));
      return evaluateLockFromPttl(pttl);
    } catch {
      return NOT_LOCKED; // fail open
    }
  }

  /**
   * Record one failed/abusive attempt for this account. If it pushes the account
   * past the window's allowance, engage (or escalate) an exponential lock and
   * return `locked: true`. Otherwise `locked: false`.
   *
   * Engagement is claimed with a single `SET … NX`, so a concurrent burst that
   * all clears the window engages the lock exactly ONCE: only the request that
   * wins the claim increments the escalation level and finalizes the TTL —
   * losers observe the winner's lock instead of each re-incrementing the level
   * and overwriting its TTL (which would inflate one burst into repeat
   * offenses). A failed write (the resilient client returns `null` when Redis is
   * unreachable) never reports a phantom lock: it falls through to `status()`,
   * which fails OPEN. A KV blip must never wall a user out of auth.
   */
  async recordFailure(email: string): Promise<LockoutStatus> {
    const id = normalizeLoginIdentifier(email);
    try {
      // If already locked, report it without burning a fresh attempt.
      const existing = await this.status(email);
      if (existing.locked) return existing;

      const { success } = await this.ratelimit.limit(id);
      if (success) return NOT_LOCKED;

      // Window exceeded → claim the lock. NX makes this the atomic mutual-
      // exclusion point: exactly one concurrent request wins and owns the
      // escalation below; a `null` result is either a peer's lock or Redis down.
      const claimed = await this.redis.set(
        this.lockKey(id),
        "1",
        "EX",
        this.baseLockSeconds,
        "NX"
      );
      if (claimed !== "OK") {
        // A peer already engaged → report their lock; Redis down → NOT_LOCKED.
        // Either way this reads the persisted TTL rather than inventing one, so
        // there is no `{ locked: true, retryAfterSeconds: 0 }` phantom lock.
        return this.status(email);
      }

      // We own the lock (currently at base TTL). Escalate the level ONCE and, if
      // this is a repeat offense, extend the TTL to match.
      const level = await this.redis.incr(this.levelKey(id));
      if (typeof level !== "number" || !Number.isFinite(level) || level < 1) {
        // Redis dropped after the claim — the base-TTL lock we just set stands.
        return { locked: true, retryAfterSeconds: this.baseLockSeconds };
      }
      await this.redis.expire(this.levelKey(id), this.levelTtlSeconds);
      const seconds = lockDurationSeconds(level, {
        baseLockSeconds: this.baseLockSeconds,
        maxLockSeconds: this.maxLockSeconds
      });
      if (seconds > this.baseLockSeconds) {
        await this.redis.set(this.lockKey(id), "1", "EX", seconds);
      }
      // Reset the attempt counter so a fresh window starts after the lock lifts.
      await this.ratelimit.resetUsedTokens(id);

      return { locked: true, retryAfterSeconds: seconds };
    } catch {
      return NOT_LOCKED; // fail open
    }
  }

  /**
   * Clear all lockout state for an account after a genuine success (e.g. the dev
   * bypass sign-in). Escalation history is dropped too.
   */
  async reset(email: string): Promise<void> {
    const id = normalizeLoginIdentifier(email);
    try {
      await this.redis.del(this.lockKey(id), this.levelKey(id));
      await this.ratelimit.resetUsedTokens(id);
    } catch {
      // Redis down: nothing to clear, don't throw.
    }
  }
}
