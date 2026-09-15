import { randomBytes } from "node:crypto";
import { redis } from "@carbon/kv";
import type { AuthSession } from "../types";

/**
 * Panel sessions: a bearer credential for Carbon UI that runs inside another
 * product's iframe (the Onshape right panel).
 *
 * The `carbon` session cookie is `SameSite=Lax`, so it never reaches a
 * cross-site iframe. Instead, a popup on Carbon's own origin (which does have
 * the cookie) mints one of these: an opaque `cps_…` token whose `AuthSession`
 * lives in Redis for `PANEL_SESSION_TTL_SECONDS`. The iframe keeps the token in
 * `sessionStorage` and sends it as `Authorization: Bearer cps_…`;
 * `requirePermissions` resolves it exactly like a cookie session — same claims
 * check, same RLS client — and refreshes the Supabase token in place.
 *
 * Opaque by design: nothing about the user is decodable from the token, and
 * deleting the Redis key revokes it immediately.
 */

export const PANEL_SESSION_TTL_SECONDS = 12 * 60 * 60;

const TOKEN_PREFIX = "cps_";
// 24 random bytes → 32 base64url characters.
const TOKEN_PATTERN = /^cps_[A-Za-z0-9_-]{32}$/;

function keyFor(token: string) {
  return `panel-session:${token}`;
}

export function isPanelSessionToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** The panel token on a request, or null when the request carries none. */
export function panelSessionTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return null;
  return isPanelSessionToken(token) ? token : null;
}

export async function createPanelSession(
  authSession: AuthSession
): Promise<string> {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  await redis.set(
    keyFor(token),
    JSON.stringify(authSession),
    "EX",
    PANEL_SESSION_TTL_SECONDS
  );
  return token;
}

export async function loadPanelSession(
  token: string
): Promise<AuthSession | null> {
  const raw = await redis.get(keyFor(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    await redis.del(keyFor(token));
    return null;
  }
}

/** Overwrite the stored session (after a token refresh), keeping the remaining TTL. */
export async function savePanelSession(
  token: string,
  authSession: AuthSession
): Promise<void> {
  const ttl = await redis.ttl(keyFor(token));
  if (ttl <= 0) return;
  await redis.set(keyFor(token), JSON.stringify(authSession), "EX", ttl);
}

export async function deletePanelSession(token: string): Promise<void> {
  await redis.del(keyFor(token));
}

/**
 * Supabase ROTATES refresh tokens, so two requests refreshing the same panel
 * session at once cannot both succeed — the second is told the token was
 * already used. The panel fires several requests together whenever it opens,
 * so that race is the normal case rather than a rare one, and this lock is
 * what makes exactly one of them do the refresh while the others wait for it.
 *
 * The lease is short and renewed while the holder works. A fixed long TTL
 * could still run out under a slow refresh, letting a second request take the
 * lock and refresh concurrently; a request that dies mid-refresh stops
 * renewing, so its lease lapses within seconds rather than locking the session
 * out.
 *
 * The lock is owner-bound: each holder stores its own random value, and
 * renewal and release only act when the stored value is still theirs. A
 * holder whose lease lapsed can therefore never extend or delete the lock a
 * later request took.
 */
export const PANEL_REFRESH_LOCK_LEASE_MS = 5_000;
export const PANEL_REFRESH_LOCK_RENEW_MS = 2_000;

function refreshLockKeyFor(token: string) {
  return `panel-session-refresh:${token}`;
}

// Compare-and-act scripts: the check and the write are one atomic step.
const RELEASE_IF_OWNER = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const RENEW_IF_OWNER = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;

/**
 * Take the refresh lock. Returns this caller's owner value when it now holds
 * the lock, null when another request already does (or Redis is unavailable).
 */
export async function acquirePanelRefreshLock(
  token: string
): Promise<string | null> {
  const owner = randomBytes(16).toString("base64url");
  const result = await redis.set(
    refreshLockKeyFor(token),
    owner,
    "PX",
    PANEL_REFRESH_LOCK_LEASE_MS,
    "NX"
  );
  return result === "OK" ? owner : null;
}

/** Extend the lease. False when the lock is no longer this owner's. */
export async function renewPanelRefreshLock(
  token: string,
  owner: string
): Promise<boolean> {
  const result = await redis.eval(
    RENEW_IF_OWNER,
    1,
    refreshLockKeyFor(token),
    owner,
    String(PANEL_REFRESH_LOCK_LEASE_MS)
  );
  return result === 1;
}

/** Release the lock only if this owner still holds it. */
export async function releasePanelRefreshLock(
  token: string,
  owner: string
): Promise<void> {
  await redis.eval(RELEASE_IF_OWNER, 1, refreshLockKeyFor(token), owner);
}

/**
 * Run `work` while holding the lease, renewing it on an interval until the
 * work settles, then releasing it. Renewal failures are ignored: the worst
 * case is the lease lapsing, which the owner check makes safe.
 */
export async function withPanelRefreshLock<T>(
  token: string,
  owner: string,
  work: () => Promise<T>
): Promise<T> {
  const renewal = setInterval(() => {
    renewPanelRefreshLock(token, owner).catch(() => undefined);
  }, PANEL_REFRESH_LOCK_RENEW_MS);
  try {
    return await work();
  } finally {
    clearInterval(renewal);
    await releasePanelRefreshLock(token, owner).catch(() => undefined);
  }
}
