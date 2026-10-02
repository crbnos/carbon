// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import {
  getAuthAccountByAccessToken,
  logAuthEvent
} from "@carbon/auth/auth.server";
import { getTotpFactors, verifyTotpChallenge } from "@carbon/auth/mfa.server";
import { authMfaRequest } from "@carbon/mes-core";
import { getClientIp } from "@carbon/utils";
import { authIpRatelimit, signInLockout } from "./lib/ratelimit.server";
import { apiRoute } from "./lib/route.server";

/**
 * Clear the TOTP challenge and exchange the aal1 tokens for aal2 ones.
 *
 * Takes BOTH tokens, not just the access token: `verifyTotpChallenge` seeds an
 * anon client with `auth.setSession` before challenging, so it needs the
 * refresh token too. The web equivalent (`completeMfaChallenge`) reads both out
 * of a cookie, which a native client does not have.
 */
export const action = apiRoute(
  { method: "POST", public: true, body: authMfaRequest },
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

    const user = await getAuthAccountByAccessToken(body.accessToken);
    if (!user) {
      throw new ApiError(401, "token_expired", "Sign in again to continue");
    }

    const lockout = signInLockout();
    const actor = user.email ?? user.id;

    const factors = await getTotpFactors(user.id);
    for (const factor of factors) {
      const session = await verifyTotpChallenge(
        { accessToken: body.accessToken, refreshToken: body.refreshToken },
        factor.id,
        body.code
      );
      if (session) {
        await lockout.reset(actor);
        logAuthEvent("mfa_challenge_success", {
          userId: user.id,
          actor,
          ip,
          channel: "mobile"
        });
        return {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: session.expires_at ?? 0,
          mfaRequired: false
        };
      }
    }

    await lockout.recordFailure(actor);
    logAuthEvent("mfa_challenge_failed", {
      userId: user.id,
      actor,
      ip,
      channel: "mobile"
    });
    throw new ApiError(401, "invalid_code", "That code did not work");
  }
);
