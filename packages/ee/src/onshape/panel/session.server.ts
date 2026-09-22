import { randomBytes } from "node:crypto";
import {
  type AuthSession,
  CONTROLLED_ENVIRONMENT,
  getCarbon,
  SESSION_IDLE_LOCK_MS
} from "@carbon/auth";
import { refreshAccessToken } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Onshape panel sessions: a bearer credential for the Carbon UI that runs inside
 * Onshape's right-panel iframe.
 *
 * The `carbon` session cookie is `SameSite=Lax`, so it never reaches a
 * cross-site iframe. Instead, a popup on Carbon's own origin (which does have
 * the cookie) mints one of these: an opaque `cps_…` token whose `AuthSession`
 * lives in Redis for `PANEL_SESSION_TTL_SECONDS`. The iframe keeps the token in
 * `sessionStorage` and sends it as `Authorization: Bearer cps_…`;
 * `requireOnshapePanelPermissions` resolves it into the same
 * `{ client, companyId, userId, … }` shape `requirePermissions` returns —
 * same claims check, same RLS client — and refreshes the Supabase token in
 * place.
 *
 * This lives entirely in `@carbon/ee` on purpose: it is an Onshape-integration
 * concern, not a core auth primitive, so `@carbon/auth`'s `requirePermissions`
 * knows nothing about panels. Opaque by design: nothing about the user is
 * decodable from the token, and deleting the Redis key revokes it immediately.
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

// Mirrors session.server's isExpiringSoon: `expiresAt` is epoch seconds.
const PANEL_REFRESH_THRESHOLD_SECONDS = 60;

function isPanelSessionExpiringSoon(session: AuthSession) {
  return (
    (session.expiresAt - PANEL_REFRESH_THRESHOLD_SECONDS) * 1000 < Date.now()
  );
}

/**
 * How long a request will wait for whoever is already refreshing: past one
 * full lease, so a holder that died has let its lock lapse and a waiter can
 * take it over before giving up.
 */
const PANEL_REFRESH_WAIT_MS = 100;
const PANEL_REFRESH_WAIT_ATTEMPTS =
  Math.ceil(PANEL_REFRESH_LOCK_LEASE_MS / PANEL_REFRESH_WAIT_MS) + 10;

async function refreshPanelSessionNow(
  token: string,
  stored: AuthSession
): Promise<AuthSession | null> {
  const refreshed = await refreshAccessToken(
    stored.refreshToken,
    stored.companyId,
    stored.companyGroupId
  );
  // Deliberately NOT deleting the session here. A failed refresh is far more
  // often a lost race than a revoked account, and deleting took the session
  // away from the request that had just refreshed it successfully. Only
  // `loadPanelSession` returning nothing proves the session is gone.
  if (!refreshed) return null;

  // Same carry-over as refreshAuthSession: a refresh is not a re-auth.
  if (stored.console) refreshed.console = stored.console;
  if (stored.mfaVerified) refreshed.mfaVerified = stored.mfaVerified;
  if (stored.createdAt) refreshed.createdAt = stored.createdAt;
  if (stored.lastActiveAt) refreshed.lastActiveAt = stored.lastActiveAt;

  await savePanelSession(token, refreshed);
  return refreshed;
}

/**
 * Refresh a panel session's Supabase token exactly once across concurrent
 * requests.
 *
 * The panel fires several requests together the moment it opens (part status
 * and releases in the same tick, plus the identity read), and Supabase rotates
 * refresh tokens. Left unserialized they all refresh with the same token: the
 * first succeeds, the rest are told it was already used, and each loser
 * answered 401 — which is why a panel opened after a period of inactivity
 * showed a 401 in one section and was fine again the moment anything
 * re-requested.
 *
 * So one request holds the lock and refreshes; the others wait for it and read
 * what it stored.
 *
 * Only the lock holder ever refreshes. A waiter that refreshed on its own
 * after a timeout spent the same rotating refresh token the holder was using,
 * and whichever lost answered 401 and sent the panel back through sign-in. A
 * waiter instead keeps trying to take the lock — a holder that died stops
 * renewing its lease, so the lock frees itself — and refreshes only once it
 * holds it, from the session as stored at that moment.
 */
async function refreshPanelSession(
  token: string,
  stored: AuthSession
): Promise<AuthSession | null> {
  for (let attempt = 0; attempt <= PANEL_REFRESH_WAIT_ATTEMPTS; attempt++) {
    const owner = await acquirePanelRefreshLock(token);
    if (owner) {
      return withPanelRefreshLock(token, owner, async () => {
        // Re-read under the lock: an earlier holder may have finished between
        // the expiry check and the lock being acquired.
        const current = (await loadPanelSession(token)) ?? stored;
        if (!isPanelSessionExpiringSoon(current)) return current;
        return refreshPanelSessionNow(token, current);
      });
    }

    await new Promise((resolve) => setTimeout(resolve, PANEL_REFRESH_WAIT_MS));
    const current = await loadPanelSession(token);
    // Gone while we waited: genuinely signed out or revoked.
    if (!current) return null;
    if (!isPanelSessionExpiringSoon(current)) return current;
  }

  // Nobody published a result and the lock never came free: the holder's
  // refresh failed or is stuck. A 401 sends the panel to sign in again, which
  // is safer than a second refresh racing the first.
  return null;
}

/**
 * Resolve a panel session token to a live `AuthSession`, refreshing the
 * Supabase token in place when it is about to expire. A missing, expired or
 * unrefreshable session is a 401 — the panel then asks the user to sign in
 * again through its popup.
 */
async function requirePanelSession(token: string): Promise<AuthSession> {
  const stored = await loadPanelSession(token);
  if (!stored) {
    throw new Response("Unauthorized", { status: 401 });
  }
  if (!isPanelSessionExpiringSoon(stored)) return stored;

  const refreshed = await refreshPanelSession(token, stored);
  if (!refreshed) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return refreshed;
}

// Ported from `@carbon/auth`'s `requirePermissions` so panel routes resolve the
// console-mode effective user identically. Panel requests are cross-site, so the
// `console-pin-*` cookie is not present in practice and this returns the session
// user — but the logic is kept faithful rather than assumed away.
function getEffectiveUser(
  request: Request,
  companyId: string,
  sessionUserId: string,
  consoleMode: boolean
): string {
  if (!consoleMode) return sessionUserId;

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return sessionUserId;

  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...rest] = c.trim().split("=");
      return [key, decodeURIComponent(rest.join("="))];
    })
  );

  const pinRaw = cookies[`console-pin-${companyId}`];
  if (!pinRaw) return sessionUserId;

  try {
    const pinIn = JSON.parse(pinRaw);
    const elapsed = Date.now() - pinIn.pinnedAt;
    const maxAge = CONTROLLED_ENVIRONMENT ? SESSION_IDLE_LOCK_MS : 3600000;
    if (elapsed > maxAge) return sessionUserId;
    return pinIn.userId ?? sessionUserId;
  } catch {
    return sessionUserId;
  }
}

/**
 * The Onshape panel's own gate, purpose-built for the bearer-token iframe path.
 *
 * It mirrors `requirePermissions`' claims check and RLS-client construction but
 * is deliberately separate: `requirePermissions` is the cookie/API-key gate for
 * the rest of Carbon and carries no Onshape coupling. Panel API routes call
 * THIS instead, and get the identical return shape.
 *
 * A panel request is always a fetch from an iframe, so both failure modes are a
 * status, never a redirect: 401 when the token is missing/expired/revoked, 403
 * when the user lacks the permission.
 */
export async function requireOnshapePanelPermissions(
  request: Request,
  requiredPermissions: {
    view?: string | string[];
    create?: string | string[];
    update?: string | string[];
    delete?: string | string[];
    role?: string;
    bypassRls?: boolean;
  }
): Promise<{
  client: SupabaseClient<Database>;
  companyId: string;
  companyGroupId: string;
  email: string;
  userId: string;
  sessionUserId: string;
  consoleMode: boolean;
}> {
  const token = panelSessionTokenFromRequest(request);
  if (!token) {
    // Panel-only endpoint: refuse rather than falling back to a cookie session
    // (which can never reach the cross-site iframe anyway).
    throw new Response("Unauthorized", { status: 401 });
  }

  const authSession = await requirePanelSession(token);
  const { accessToken, companyId, companyGroupId, email, userId } = authSession;
  const consoleMode = authSession.console === companyId;

  const myClaims = await getUserClaims(userId, companyId);

  const client =
    !!requiredPermissions.bypassRls && myClaims.role === "employee"
      ? getCarbonServiceRole()
      : getCarbon(accessToken);

  const result = {
    client,
    companyId,
    companyGroupId,
    email,
    userId: getEffectiveUser(request, companyId, userId, consoleMode),
    sessionUserId: userId,
    consoleMode
  };

  // No required permissions: authenticated is enough (e.g. the identity read).
  if (Object.keys(requiredPermissions).length === 0) {
    return result;
  }

  const hasRequiredPermissions = Object.entries(requiredPermissions).every(
    ([action, permission]) => {
      if (action === "bypassRls") return true;
      if (typeof permission === "string") {
        if (action === "role") {
          return myClaims.role === permission;
        }
        if (!(permission in myClaims.permissions)) return false;
        const permissionForCompany =
          myClaims.permissions[permission]?.[
            action as "view" | "create" | "update" | "delete"
          ];
        return permissionForCompany?.includes(companyId) || false;
      } else if (Array.isArray(permission)) {
        return permission.every((p) => {
          const permissionForCompany =
            myClaims.permissions[p]?.[
              action as "view" | "create" | "update" | "delete"
            ];
          return permissionForCompany?.includes(companyId) ?? false;
        });
      } else {
        return false;
      }
    }
  );

  if (!hasRequiredPermissions) {
    throw new Response("Forbidden", { status: 403 });
  }

  return result;
}
