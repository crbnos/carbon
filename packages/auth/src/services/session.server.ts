import { redis } from "@carbon/kv";
import { Edition } from "@carbon/utils";
import type { AuthSession as SupabaseAuthSession } from "@supabase/supabase-js";
import { createCookieSessionStorage, redirect } from "react-router";

import {
  CarbonEdition,
  CONTROLLED_ENVIRONMENT,
  DOMAIN,
  REFRESH_ACCESS_TOKEN_THRESHOLD,
  SESSION_ABSOLUTE_MAX_MS,
  SESSION_IDLE_LOCK_MS,
  SESSION_KEY,
  SESSION_MAX_AGE,
  SESSION_SECRET
} from "../config/env";
import type { AuthSession, Result } from "../types";
import { getCookieDomain } from "../utils/cookie";
import { getCurrentPath, isGet, makeRedirectToFromHere } from "../utils/http";
import { path } from "../utils/path";
import {
  logAuthEvent,
  makeAuthSession,
  refreshAccessToken,
  verifyAuthSession
} from "./auth.server";
import { setCompanyId } from "./company.server";
import {
  getTotpFactors,
  userHasVerifiedTotpFactor,
  verifyTotpChallenge
} from "./mfa.server";
import { getPermissionCacheKey } from "./users";

async function assertAuthSession(
  request: Request,
  { onFailRedirectTo }: { onFailRedirectTo?: string } = {}
) {
  const authSession = await getAuthSession(request);

  if (!authSession?.accessToken || !authSession?.refreshToken) {
    throw redirect(
      `${onFailRedirectTo || path.to.login}?${makeRedirectToFromHere(request)}`
    );
  }

  return authSession;
}

export const isTestEdition = CarbonEdition === Edition.Test;

const cookieDomain = isTestEdition ? undefined : getCookieDomain(DOMAIN);

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "carbon",
    httpOnly: true,
    path: "/",
    sameSite: isTestEdition ? "none" : "lax",
    secrets: [SESSION_SECRET!],
    secure: !!cookieDomain,
    domain: cookieDomain
  }
});

export async function setAuthSession(
  request: Request,
  {
    authSession
  }: {
    authSession?: AuthSession | null;
  } = {}
) {
  const session = await getSession(request);

  if (authSession !== undefined) {
    session.set(SESSION_KEY, authSession);
    // Issuing (or clearing) a full session always ends any in-flight MFA
    // challenge — the pending tokens are single-purpose.
    session.unset(MFA_SESSION_KEY);
  }

  return sessionStorage.commitSession(session, { maxAge: SESSION_MAX_AGE });
}

// The half-authenticated state between a successful first factor and the TOTP
// challenge. Lives in the same cookie session under its own key — never under
// SESSION_KEY, so `requireAuthSession` keeps failing until the challenge passes.
const MFA_SESSION_KEY = "mfa";
const PENDING_MFA_MAX_AGE_MS = 10 * 60 * 1000;

export type PendingMfaSession = {
  authSession: AuthSession;
  redirectTo?: string;
  createdAt: number;
};

export async function setPendingMfaSession(
  request: Request,
  {
    authSession,
    redirectTo
  }: {
    authSession: AuthSession;
    redirectTo?: string;
  }
) {
  const session = await getSession(request);
  session.set(MFA_SESSION_KEY, {
    authSession,
    redirectTo,
    createdAt: Date.now()
  } satisfies PendingMfaSession);

  return sessionStorage.commitSession(session, { maxAge: SESSION_MAX_AGE });
}

export async function getPendingMfaSession(
  request: Request
): Promise<PendingMfaSession | null> {
  const session = await getSession(request);
  const pending = session.get(MFA_SESSION_KEY) as PendingMfaSession | undefined;

  if (!pending?.authSession?.accessToken || !pending?.authSession?.refreshToken)
    return null;

  if (Date.now() - pending.createdAt > PENDING_MFA_MAX_AGE_MS) return null;

  return pending;
}

/**
 * Verify a TOTP code for the `/mfa` route and mint the full session cookie.
 *
 * Two entry states, one exit: a login flow parked tokens in the pending-MFA
 * key, or an already-issued session predates enrollment and got bounced here
 * by `requireAuthSession`. Either way a passed challenge rotates the tokens
 * to AAL2, so the returned cookie must be set on the response — the source
 * refresh token is dead after GoTrue's reuse interval.
 */
export async function completeMfaChallenge(
  request: Request,
  code: string
): Promise<
  | {
      success: true;
      authSession: AuthSession;
      sessionCookie: string;
      redirectTo?: string;
    }
  | { success: false; reason: "no-session" | "invalid-code" }
> {
  const pending = await getPendingMfaSession(request);
  const source = pending?.authSession ?? (await getAuthSession(request));

  if (!source?.accessToken || !source?.refreshToken) {
    return { success: false, reason: "no-session" };
  }

  const factors = await getTotpFactors(source.userId);
  const verifiedFactors = factors.filter((f) => f.status === "verified");

  // Nearly always one factor; on the rare multi-factor account, try the code
  // against each until one accepts it.
  let supabaseSession: SupabaseAuthSession | null = null;
  for (const factor of verifiedFactors) {
    supabaseSession = await verifyTotpChallenge(
      { accessToken: source.accessToken, refreshToken: source.refreshToken },
      factor.id,
      code
    );
    if (supabaseSession) break;
  }

  if (!supabaseSession) {
    logAuthEvent("mfa_challenge_failed", { userId: source.userId });
    return { success: false, reason: "invalid-code" };
  }

  const authSession = makeAuthSession(
    supabaseSession,
    source.companyId,
    source.companyGroupId,
    { mfaVerified: true }
  );

  if (!authSession) {
    return { success: false, reason: "invalid-code" };
  }

  if (source.console) {
    authSession.console = source.console;
  }

  const sessionCookie = await setAuthSession(request, { authSession });

  logAuthEvent("mfa_challenge_success", { userId: authSession.userId });

  return {
    success: true,
    authSession,
    sessionCookie,
    redirectTo: pending?.redirectTo
  };
}

export async function clearAuthCookies(request: Request) {
  const session = await getSession(request);
  const sessionCookie = await sessionStorage.destroySession(session);
  const companyIdCookie = setCompanyId(null);
  return [
    ["Set-Cookie", sessionCookie] as [string, string],
    ["Set-Cookie", companyIdCookie] as [string, string]
  ];
}

export async function destroyAuthSession(request: Request) {
  const headers = await clearAuthCookies(request);
  return redirect(path.to.login, {
    headers
  });
}

export async function flash(request: Request, result: Result) {
  const session = await getSession(request);
  if (typeof result.success === "boolean") {
    session.flash("success", result.success);
    session.flash("message", result.message);
    if (result.description) {
      session.flash("description", result.description);
    }
    if (result.flash) {
      session.flash("flash", result.flash);
    }
  }

  return {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) }
  };
}

export async function getAuthSession(
  request: Request
): Promise<AuthSession | null> {
  const session = await getSession(request);
  return session.get(SESSION_KEY);
}

export async function getOrRefreshAuthSession(
  request: Request
): Promise<AuthSession | null> {
  const session = await getAuthSession(request);
  if (!session) return null;

  if (isExpiringSoon(session.expiresAt)) {
    return refreshAuthSession(request);
  }

  return session;
}

export async function getSessionFlash(request: Request) {
  const session = await getSession(request);

  const result: Result = {
    success: session.get("success") === true,
    message: session.get("message"),
    description: session.get("description"),
    flash: session.get("flash") as "success" | "error" | undefined
  };

  if (!result.message) return null;

  const headers = { "Set-Cookie": await sessionStorage.commitSession(session) };

  return { result, headers };
}

async function getSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  return sessionStorage.getSession(cookie);
}

function isExpiringSoon(expiresAt: number) {
  return (expiresAt - REFRESH_ACCESS_TOKEN_THRESHOLD) * 1000 < Date.now();
}

/**
 * Absolute session cap (NIST 800-171 3.1.11). A missing `createdAt` counts as
 * "never expired" — a session minted before this shipped gets stamped on its
 * next mint/refresh rather than being force-terminated on sight.
 */
export function isSessionExpiredAbsolute(session: AuthSession): boolean {
  if (!session.createdAt) return false;
  return Date.now() - session.createdAt > SESSION_ABSOLUTE_MAX_MS;
}

/**
 * Idle session lock (NIST 800-171 3.1.10). A missing `lastActiveAt` counts as
 * "not locked" (back-compat) — the heartbeat/unlock stamps it going forward.
 */
export function isSessionIdleLocked(session: AuthSession): boolean {
  if (!session.lastActiveAt) return false;
  return Date.now() - session.lastActiveAt > SESSION_IDLE_LOCK_MS;
}

export async function requireAuthSession(
  request: Request,
  {
    onFailRedirectTo,
    verify
  }: {
    onFailRedirectTo?: string;
    verify: boolean;
  } = { verify: false }
): Promise<AuthSession> {
  let authSession = await assertAuthSession(request, {
    onFailRedirectTo
  });

  const isValidSession = verify ? await verifyAuthSession(authSession) : true;

  if (!isValidSession || isExpiringSoon(authSession.expiresAt)) {
    authSession = await refreshAuthSession(request);
  }

  // NIST 800-171 3.1.10 (session lock) / 3.1.11 (session termination) — enforced
  // only in a controlled (ITAR/CUI) environment. Console DEVICE sessions are
  // exempt: their lock is the operator pin-in (see console.server), and a shared
  // shop-floor kiosk must not be force-logged-out mid-shift (spec D8).
  if (CONTROLLED_ENVIRONMENT && !authSession.console) {
    // Absolute cap (3.1.11): terminate — destroy the session, force full re-login.
    if (isSessionExpiredAbsolute(authSession)) {
      throw await destroyAuthSession(request);
    }
    // Idle lock (3.1.10): the session is PRESERVED; re-auth at /unlock to resume.
    if (isSessionIdleLocked(authSession)) {
      throw redirect(`${path.to.unlock}?${makeRedirectToFromHere(request)}`);
    }
  }

  // Active MFA re-check: a session minted before the user enrolled a TOTP
  // factor (or on another device) is not trusted just because it exists —
  // send it through the challenge. Sessions issued after a passed challenge
  // carry `mfaVerified` and skip the lookup's Redis/GoTrue cost entirely.
  if (
    !authSession.mfaVerified &&
    (await userHasVerifiedTotpFactor(authSession.userId))
  ) {
    throw redirect(`${path.to.mfa}?${makeRedirectToFromHere(request)}`);
  }

  return authSession;
}

export async function refreshAuthSession(
  request: Request
): Promise<AuthSession> {
  const authSession = await getAuthSession(request);

  const refreshedAuthSession = await refreshAccessToken(
    authSession?.refreshToken,
    authSession?.companyId,
    authSession?.companyGroupId
  );

  // Preserve console mode and MFA verification across token refresh —
  // `makeAuthSession` rebuilds the payload from the Supabase session alone.
  if (refreshedAuthSession && authSession?.console) {
    refreshedAuthSession.console = authSession.console;
  }
  if (refreshedAuthSession && authSession?.mfaVerified) {
    refreshedAuthSession.mfaVerified = authSession.mfaVerified;
  }
  // Preserve session age + last-activity across a silent token refresh — a
  // refresh is neither a re-auth nor user activity, so it must not reset the
  // absolute-cap clock (3.1.11) or the idle clock (3.1.10).
  if (refreshedAuthSession && authSession?.createdAt) {
    refreshedAuthSession.createdAt = authSession.createdAt;
  }
  if (refreshedAuthSession && authSession?.lastActiveAt) {
    refreshedAuthSession.lastActiveAt = authSession.lastActiveAt;
  }

  if (!refreshedAuthSession) {
    const redirectUrl = `${path.to.login}?${makeRedirectToFromHere(request)}`;

    const sessionCookie = await setAuthSession(request, {
      authSession: null
    });
    const companyIdCookie = setCompanyId(null);

    throw redirect(redirectUrl, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    });
  }

  if (isGet(request)) {
    const sessionCookie = await setAuthSession(request, {
      authSession: refreshedAuthSession
    });
    const companyIdCookie = setCompanyId(refreshedAuthSession.companyId);

    throw redirect(getCurrentPath(request), {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    });
  }

  return refreshedAuthSession;
}

/**
 * Re-commit the session cookie with `lastActiveAt = now`. Called by the activity
 * heartbeat (an active session pings this well within the idle window) and on a
 * successful unlock. Returns the Set-Cookie string, or null if there is no
 * session to touch. Only the idle clock moves — `createdAt` (the absolute-cap
 * clock) is left untouched.
 */
export async function touchAuthSession(
  request: Request
): Promise<string | null> {
  const session = await getSession(request);
  const authSession = await getAuthSession(request);
  if (!authSession) return null;
  session.set(SESSION_KEY, { ...authSession, lastActiveAt: Date.now() });
  return sessionStorage.commitSession(session, { maxAge: SESSION_MAX_AGE });
}

export async function updateSessionConsole(
  request: Request,
  consoleCompanyId: string | undefined
) {
  const session = await getSession(request);
  const authSession = await getAuthSession(request);

  if (authSession) {
    session.set(SESSION_KEY, {
      ...authSession,
      console: consoleCompanyId
    });
  }

  return sessionStorage.commitSession(session, { maxAge: SESSION_MAX_AGE });
}

export async function updateCompanySession(
  request: Request,
  companyId: string,
  companyGroupId: string
) {
  const session = await getSession(request);
  const authSession = await getAuthSession(request);

  if (authSession !== undefined) {
    // Fire-and-forget cache invalidation. If Redis is down, @carbon/kv fails
    // soft and this resolves null — benign: a stale permission cache entry (if
    // any) simply expires on its own TTL, and the session cookie is still returned.
    redis.del(getPermissionCacheKey(authSession?.userId!));
    session.set(SESSION_KEY, {
      ...authSession,
      companyId,
      companyGroupId
    });
  }

  return sessionStorage.commitSession(session, { maxAge: SESSION_MAX_AGE });
}
