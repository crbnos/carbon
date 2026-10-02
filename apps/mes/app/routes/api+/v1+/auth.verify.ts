// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbon } from "@carbon/auth";
import { ApiError } from "@carbon/auth/api-user.server";
import { logAuthEvent, signInWithBypassEmail } from "@carbon/auth/auth.server";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import { authVerifyRequest } from "@carbon/mes-core";
import { getClientIp } from "@carbon/utils";
import { authIpRatelimit, signInLockout } from "./lib/ratelimit.server";
import { apiRoute } from "./lib/route.server";

/**
 * Exchange the emailed 6-digit code for a session.
 *
 * The code is checked SERVER-side, like the web's magic-link verification, so
 * the per-account lockout counts a wrong code as a failed attempt. A client
 * calling `verifyOtp` itself would be outside that control.
 */
export const action = apiRoute(
  { method: "POST", public: true, body: authVerifyRequest },
  async ({ request, body }) => {
    const ip = getClientIp(request) ?? "127.0.0.1";
    const limit = await authIpRatelimit.limit(ip);
    if (!limit.success) {
      throw new ApiError(
        429,
        "rate_limited",
        "Too many attempts. Try again later."
      );
    }

    const email = body.email.trim().toLowerCase();
    const lockout = signInLockout();

    const locked = await lockout.status(email);
    if (locked.locked) {
      throw new ApiError(
        429,
        "locked",
        "For your security, sign-in for this account is paused. Try again later.",
        undefined,
        { retryAfterSeconds: locked.retryAfterSeconds }
      );
    }

    // Local development: DEV_BYPASS_EMAIL has no mailbox to read a code from,
    // and `signInWithBypassEmail` already refuses to run outside local dev
    // (IS_LOCAL_DEV) — so this cannot become a production hole. It is what
    // makes an on-device test possible without opening the dev mailbox.
    const bypassEmail = process.env.DEV_BYPASS_EMAIL?.trim().toLowerCase();
    if (bypassEmail && email === bypassEmail) {
      const session = await signInWithBypassEmail(email);
      if (!session) {
        throw new ApiError(401, "invalid_code", "That code did not work");
      }
      logAuthEvent("login_success", {
        userId: session.userId,
        actor: email,
        ip,
        method: "bypass",
        channel: "mobile"
      });
      return {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        mfaRequired: false
      };
    }

    const { data, error } = await getCarbon().auth.verifyOtp({
      email,
      token: body.code,
      type: "email"
    });

    if (error || !data.session) {
      await lockout.recordFailure(email);
      logAuthEvent("login_failed", {
        actor: email,
        ip,
        method: "code",
        channel: "mobile",
        reason: error?.message
      });
      throw new ApiError(
        401,
        "invalid_code",
        "That code did not work. Check it, or ask for a new one."
      );
    }

    await lockout.reset(email);
    logAuthEvent("login_success", {
      userId: data.session.user.id,
      actor: email,
      ip,
      method: "code",
      channel: "mobile"
    });

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? 0,
      // The app must clear a TOTP challenge before any other call succeeds —
      // `requireApiUser` refuses an aal1 token for a user with a factor.
      mfaRequired: await userHasVerifiedTotpFactor(data.session.user.id)
    };
  }
);
