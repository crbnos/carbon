import { createCookieSessionStorage, redirect } from "@remix-run/node";

import { getCurrentPath, isGet, makeRedirectToFromHere } from "~/utils/http";

import {
  NODE_ENV,
  REFRESH_ACCESS_TOKEN_THRESHOLD,
  SESSION_KEY,
  SESSION_MAX_AGE,
  SESSION_SECRET,
} from "~/config/env";

import { redis } from "@carbon/redis";

import type { Result } from "~/types";
import { path } from "~/utils/path";
import { refreshAccessToken, verifyAuthSession } from "./auth/auth.server";
import type { AuthSession } from "./auth/types";

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
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [SESSION_SECRET],
    secure: NODE_ENV === "production",
  },
});

export async function commitAuthSession(
  request: Request,
  {
    authSession,
  }: {
    authSession?: AuthSession | null;
  } = {}
) {
  const session = await getSession(request);

  // allow user session to be null.
  // useful you want to clear session and display a message explaining why
  if (authSession !== undefined) {
    session.set(SESSION_KEY, authSession);
  }

  return sessionStorage.commitSession(session, { maxAge: SESSION_MAX_AGE });
}

export async function destroyAuthSession(request: Request) {
  const session = await getSession(request);

  // when we change to throw redirect, or callback stops working
  return redirect(path.to.login, {
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session),
    },
  });
}

export async function flash(request: Request, result: Result) {
  const session = await getSession(request);
  if (typeof result.success === "boolean") {
    session.flash("success", result.success);
    session.flash("message", result.message);
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

export async function getSessionFlash(request: Request) {
  const session = await getSession(request);

  const result: Result = {
    success: session.get("success") === true,
    message: session.get("message"),
  };

  if (!result.message) return null;

  const headers = { "Set-Cookie": await sessionStorage.commitSession(session) };

  return { result, headers };
}

function getPermissionCacheKey(userId: string) {
  return `permissions:${userId}`;
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

    // here we throw instead of return because this function promise a AuthSession and not a response object
    // https://remix.run/docs/en/v1/guides/constraints#higher-order-functions
    throw redirect(redirectUrl, {
      headers: {
        "Set-Cookie": await commitAuthSession(request, {
          authSession: null,
        }),
      },
    });
  }

  // refresh is ok and we can redirect
  if (isGet(request)) {
    // here we throw instead of return because this function promise a UserSession and not a response object
    // https://remix.run/docs/en/v1/guides/constraints#higher-order-functions
    throw redirect(getCurrentPath(request), {
      headers: {
        "Set-Cookie": await commitAuthSession(request, {
          authSession: refreshedAuthSession,
        }),
      },
    });
  }

  // we can't redirect because we are in an action, so, deal with it and don't forget to handle session commit 👮‍♀️
  return refreshedAuthSession;
}

export async function updateCompanySession(
  request: Request,
  companyId: string
) {
  const session = await getSession(request);
  const authSession = await getAuthSession(request);

  // allow user session to be null.
  // useful you want to clear session and display a message explaining why
  if (authSession !== undefined) {
    await redis.del(getPermissionCacheKey(authSession?.userId!));
    session.set(SESSION_KEY, {
      ...authSession,
      companyId,
    });
  }

  return sessionStorage.commitSession(session, { maxAge: SESSION_MAX_AGE });
}
