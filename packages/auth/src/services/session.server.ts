import { redis } from "@carbon/kv";
import { createCookieSessionStorage, redirect } from "@vercel/remix";

import {
  DOMAIN,
  REFRESH_ACCESS_TOKEN_THRESHOLD,
  SESSION_KEY,
  SESSION_MAX_AGE,
  SESSION_SECRET,
  VERCEL_ENV,
} from "../config/env";
import type { AuthSession, Result } from "../types";
import { getCurrentPath, isGet, makeRedirectToFromHere } from "../utils/http";
import { path } from "../utils/path";
import { refreshAccessToken, verifyAuthSession } from "./auth.server";
import { setCompanyId } from "./company.server";
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

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "carbon",
    httpOnly: VERCEL_ENV === "production",
    path: "/",
    sameSite: "lax",
    secrets: [SESSION_SECRET],
    secure: VERCEL_ENV === "production",
    domain: VERCEL_ENV === "production" ? DOMAIN : undefined, // eg. carbon.ms
  },
});

export async function setAuthSession(
  request: Request,
  {
    authSession,
  }: {
    authSession?: AuthSession | null;
  } = {}
) {
  const session = await getSession(request);

  if (authSession !== undefined) {
    session.set(SESSION_KEY, authSession);
  }

  return sessionStorage.commitSession(session, { maxAge: SESSION_MAX_AGE });
}

export async function destroyAuthSession(request: Request) {
  const session = await getSession(request);

  const sessionCookie = await sessionStorage.destroySession(session);
  const companyIdCookie = setCompanyId(null);

  return redirect(path.to.login, {
    headers: [
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", companyIdCookie],
    ],
  });
}

export async function flash(request: Request, result: Result) {
  const session = await getSession(request);
  if (typeof result.success === "boolean") {
    session.flash("success", result.success);
    session.flash("message", result.message);
    if (result.flash) {
      session.flash("flash", result.flash);
    }
  }

  return {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
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
    flash: session.get("flash") as "success" | "error" | undefined,
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

export async function requireAuthSession(
  request: Request,
  {
    onFailRedirectTo,
    verify,
  }: {
    onFailRedirectTo?: string;
    verify: boolean;
  } = { verify: false }
): Promise<AuthSession> {
  const authSession = await assertAuthSession(request, {
    onFailRedirectTo,
  });

  const isValidSession = verify ? await verifyAuthSession(authSession) : true;

  if (!isValidSession || isExpiringSoon(authSession.expiresAt)) {
    return refreshAuthSession(request);
  }

  return authSession;
}

export async function refreshAuthSession(
  request: Request
): Promise<AuthSession> {
  const authSession = await getAuthSession(request);

  const refreshedAuthSession = await refreshAccessToken(
    authSession?.refreshToken,
    authSession?.companyId
  );

  if (!refreshedAuthSession) {
    const redirectUrl = `${path.to.login}?${makeRedirectToFromHere(request)}`;

    const sessionCookie = await setAuthSession(request, {
      authSession: null,
    });
    const companyIdCookie = setCompanyId(null);

    throw redirect(redirectUrl, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie],
      ],
    });
  }

  if (isGet(request)) {
    const sessionCookie = await setAuthSession(request, {
      authSession: refreshedAuthSession,
    });
    const companyIdCookie = setCompanyId(refreshedAuthSession.companyId);

    throw redirect(getCurrentPath(request), {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie],
      ],
    });
  }

  return refreshedAuthSession;
}

export async function updateCompanySession(
  request: Request,
  companyId: string
) {
  const session = await getSession(request);
  const authSession = await getAuthSession(request);

  if (authSession !== undefined) {
    await redis.del(getPermissionCacheKey(authSession?.userId!));
    session.set(SESSION_KEY, {
      ...authSession,
      companyId,
    });
  }

  return sessionStorage.commitSession(session, { maxAge: SESSION_MAX_AGE });
}
