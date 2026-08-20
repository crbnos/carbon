import { assertIsPost, error, RATE_LIMIT, success } from "@carbon/auth";
import { makeAuthSession, requirePermissions } from "@carbon/auth/auth.server";
import { unenrollTotpFactor } from "@carbon/auth/mfa.server";
import {
  requireAuthSession,
  setAuthSession
} from "@carbon/auth/session.server";
import { Ratelimit, redis } from "@carbon/kv";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {});
  const authSession = await requireAuthSession(request);

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT, "1 h"),
    analytics: true
  });
  const { success: withinLimit } = await ratelimit.limit(ip);
  if (!withinLimit) {
    return data(error(null, "Rate limit exceeded"), { status: 429 });
  }

  let body: { factorId?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return data(error(null, "Invalid request"), { status: 400 });
  }

  const { factorId, code } = body;
  if (!factorId || !code || !/^\d{6}$/.test(code)) {
    return data(error(null, "Invalid code"), { status: 400 });
  }

  const result = await unenrollTotpFactor(
    {
      accessToken: authSession.accessToken,
      refreshToken: authSession.refreshToken
    },
    factorId,
    code
  );

  if (!result.success) {
    return data(error(null, "Invalid or expired code"), { status: 400 });
  }

  // The step-up verify rotated the tokens — re-issue the cookie. The session
  // stays MFA-verified; only future logins skip the challenge.
  const headers: Record<string, string> = {};
  if (result.session) {
    const newAuthSession = makeAuthSession(
      result.session,
      authSession.companyId,
      authSession.companyGroupId,
      { mfaVerified: true }
    );
    if (newAuthSession) {
      if (authSession.console) {
        newAuthSession.console = authSession.console;
      }
      headers["Set-Cookie"] = await setAuthSession(request, {
        authSession: newAuthSession
      });
    }
  }

  return data(success("Two-factor authentication disabled"), { headers });
}
