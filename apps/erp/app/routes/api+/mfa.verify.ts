import { assertIsPost, error, RATE_LIMIT, success } from "@carbon/auth";
import { makeAuthSession, requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { verifyTotpChallenge } from "@carbon/auth/mfa.server";
import {
  requireAuthSession,
  setAuthSession
} from "@carbon/auth/session.server";
import { Ratelimit, redis } from "@carbon/kv";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { sendMfaEnabledEmail } from "~/services/mfa-email.server";

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

  const supabaseSession = await verifyTotpChallenge(
    {
      accessToken: authSession.accessToken,
      refreshToken: authSession.refreshToken
    },
    factorId,
    code
  );

  if (!supabaseSession) {
    return data(error(null, "Invalid or expired code"), { status: 400 });
  }

  // The verify rotated the tokens (and upgraded the session to AAL2) — the
  // cookie MUST be re-issued or the next refresh fails on the dead token.
  const newAuthSession = makeAuthSession(
    supabaseSession,
    authSession.companyId,
    authSession.companyGroupId,
    { mfaVerified: true }
  );

  if (!newAuthSession) {
    return data(error(null, "Failed to update session"), { status: 500 });
  }

  if (authSession.console) {
    newAuthSession.console = authSession.console;
  }

  const sessionCookie = await setAuthSession(request, {
    authSession: newAuthSession
  });

  // This route only ever verifies an ENROLLMENT — a login challenge goes
  // through completeMfaChallenge on /mfa — so reaching here means a factor was
  // just added to this account. Send the receipt; it never throws.
  await sendMfaEnabledEmail(
    getCarbonServiceRole(),
    authSession.companyId,
    authSession.userId
  );

  return data(success("Two-factor authentication enabled"), {
    headers: { "Set-Cookie": sessionCookie }
  });
}
