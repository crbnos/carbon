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
import {
  AccountLockout,
  maxAttemptsForRateLimit,
  Ratelimit,
  redis,
  SIGN_IN_CODE_LOCKOUT_PREFIX
} from "@carbon/kv";
import { getClientIp } from "@carbon/utils";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

const LOCKED_MESSAGE =
  "For your security, sign-in for this account is temporarily paused. Please try again later.";
const WRONG_CODE_MESSAGE =
  "That code is wrong or has expired. Check the newest email, or request a new one.";
const UNAVAILABLE_MESSAGE =
  "We couldn't check your code just now. Please try again in a moment.";

/**
 * Signs in with the 6-digit code from a sign-in email, the alternative to
 * following its link, for when the email and the sign-in are not in the same
 * browser.
 *
 * The code is Auth's own one-time token, so it shares the link's lifetime and
 * single use: whatever spends the link spends the code. A verified code answers with the session, which the browser
 * hands to /callback exactly as the link's redirect does — company choice,
 * SSO enforcement, MFA and the lockout reset all happen there, once, for both.
 *
 * Guarded like the login action, with buckets of its own: a per-IP rate limit
 * and a per-account lockout where every code counts — six digits are
 * otherwise a million guesses. Its own, so guessing at someone's code locks
 * code sign-in only and never stops them asking for a link, and signing in
 * with a code does not spend the IP's login budget. /callback resets both
 * lockouts on success.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const ip = getClientIp(request) ?? "127.0.0.1";

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT, "1 h"),
    analytics: true,
    prefix: "@carbon/ratelimit-code"
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

  const lockout = new AccountLockout({
    redis,
    maxAttempts: maxAttemptsForRateLimit(RATE_LIMIT),
    prefix: SIGN_IN_CODE_LOCKOUT_PREFIX
  });
  // Counted before the check, so a burst of guesses cannot all slip past a
  // read-only status check; an outage gives its attempt back below.
  const attempt = await lockout.recordFailure(email);
  if (attempt.locked) {
    logAuthEvent("login_locked", {
      actor: email,
      ip,
      reason: "sign-in code temporarily locked",
      retryAfterSeconds: attempt.retryAfterSeconds
    });
    return data(error(null, LOCKED_MESSAGE), { status: 429 });
  }

  const { data: verified, error: verifyError } =
    await getCarbonServiceRole().auth.verifyOtp({
      email,
      token: code,
      type: "email"
    });

  // Auth down or throttling: the code was never checked, so it is neither
  // wrong nor a guess.
  if (
    verifyError &&
    (isAuthRetryableFetchError(verifyError) ||
      (verifyError.status ?? 0) >= 500 ||
      verifyError.status === 429)
  ) {
    await lockout.refund(email);
    return data(error(verifyError, UNAVAILABLE_MESSAGE), { status: 503 });
  }

  if (verifyError || !verified.session) {
    logAuthEvent("login_failed", {
      actor: email,
      ip,
      reason: "sign-in code rejected"
    });
    return data(error(verifyError, WRONG_CODE_MESSAGE), { status: 400 });
  }

  return {
    success: true,
    refreshToken: verified.session.refresh_token,
    userId: verified.session.user.id
  };
}
