// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  assertIsPost,
  error,
  RATE_LIMIT,
  signInCodeValidator
} from "@carbon/auth";
import { logAuthEvent } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { AccountLockout, Ratelimit, redis } from "@carbon/kv";
import { getClientIp } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

const LOCKED_MESSAGE =
  "For your security, sign-in for this account is temporarily paused. Please try again later.";
const WRONG_CODE_MESSAGE =
  "That code is wrong or has expired. Check the newest email, or request a new one.";

/**
 * Signs in with the 6-digit code from a sign-in email, the alternative to
 * following its link. Corporate mail scanners (Microsoft Defender, Mimecast)
 * open links to inspect them, which can use a one-time link up before the
 * person clicks it; they cannot type a code.
 *
 * The code is Auth's own one-time token, so it shares the link's lifetime and
 * single use. A verified code answers with the session, which the browser
 * hands to /callback exactly as the link's redirect does — company choice,
 * SSO enforcement, MFA and the lockout reset all happen there, once, for both.
 *
 * Guarded like the login action: the per-IP rate limit, and the per-account
 * lockout, where every wrong code counts as a failed attempt — six digits are
 * otherwise a million guesses.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const ip = getClientIp(request) ?? "127.0.0.1";

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT, "1 h"),
    analytics: true
  });
  if (!(await ratelimit.limit(ip)).success) {
    logAuthEvent("login_rate_limited", { ip });
    return data(error(null, "Rate limit exceeded"), { status: 429 });
  }

  const validation = await validator(signInCodeValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return data(error(validation.error, "Enter the 6-digit code"), {
      status: 400
    });
  }
  const { email, code } = validation.data;

  const lockout = new AccountLockout({ redis });
  const lockStatus = await lockout.status(email);
  if (lockStatus.locked) {
    logAuthEvent("login_locked", {
      actor: email,
      ip,
      reason: "account temporarily locked",
      retryAfterSeconds: lockStatus.retryAfterSeconds
    });
    return data(error(null, LOCKED_MESSAGE), { status: 429 });
  }

  const { data: verified, error: verifyError } =
    await getCarbonServiceRole().auth.verifyOtp({
      email,
      token: code,
      type: "email"
    });

  if (verifyError || !verified.session) {
    const attempt = await lockout.recordFailure(email);
    logAuthEvent("login_failed", {
      actor: email,
      ip,
      reason: "sign-in code rejected"
    });
    return data(
      error(verifyError, attempt.locked ? LOCKED_MESSAGE : WRONG_CODE_MESSAGE),
      { status: 400 }
    );
  }

  return {
    success: true,
    refreshToken: verified.session.refresh_token,
    userId: verified.session.user.id
  };
}
