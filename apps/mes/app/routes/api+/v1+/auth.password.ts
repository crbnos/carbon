// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { APP_REVIEW_EMAILS } from "@carbon/auth";
import { ApiError } from "@carbon/auth/api-user.server";
import { logAuthEvent } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import { authPasswordRequest } from "@carbon/mes-core";
import { getClientIp } from "@carbon/utils";
import { authIpRatelimit, signInLockout } from "./lib/ratelimit.server";
import { apiRoute } from "./lib/route.server";

/**
 * Password sign-in for store-review accounts ONLY.
 *
 * App Store and Google Play reviewers must be able to sign in, and they cannot
 * receive an emailed code. `APP_REVIEW_EMAILS` is set only on Carbon Cloud and
 * empty everywhere else, so on every other install this endpoint refuses every
 * address. The review account is an ordinary employee of a demo company with no
 * other access, and it is held to the same rate limit and lockout as a code.
 */
export const action = apiRoute(
  { method: "POST", public: true, body: authPasswordRequest },
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
    if (!APP_REVIEW_EMAILS.includes(email)) {
      logAuthEvent("login_failed", {
        actor: email,
        ip,
        method: "password",
        channel: "mobile",
        reason: "not an app-review account"
      });
      // Deliberately the same wording a wrong password gets: this must not
      // reveal which addresses are on the allow-list.
      throw new ApiError(401, "invalid_code", "Those details did not work");
    }

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

    const { data, error } =
      await getCarbonServiceRole().auth.signInWithPassword({
        email,
        password: body.password
      });

    if (error || !data.session) {
      await lockout.recordFailure(email);
      logAuthEvent("login_failed", {
        actor: email,
        ip,
        method: "password",
        channel: "mobile",
        reason: error?.message
      });
      throw new ApiError(401, "invalid_code", "Those details did not work");
    }

    await lockout.reset(email);
    logAuthEvent("login_success", {
      userId: data.session.user.id,
      actor: email,
      ip,
      method: "password",
      channel: "mobile"
    });

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? 0,
      mfaRequired: await userHasVerifiedTotpFactor(data.session.user.id)
    };
  }
);
