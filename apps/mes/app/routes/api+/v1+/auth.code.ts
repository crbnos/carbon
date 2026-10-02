// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { APP_REVIEW_EMAILS, getMESUrl } from "@carbon/auth";
import { ApiError } from "@carbon/auth/api-user.server";
import { authCodeRequest } from "@carbon/mes-core";
import { getClientIp } from "@carbon/utils";
import { requestSignInCode } from "~/services/auth.server";
import { authIpRatelimit, signInLockout } from "./lib/ratelimit.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Ask for a 6-digit sign-in code.
 *
 * This is the ONLY thing the app can reach before it has a session, and the
 * body is always `{ ok: true }` — for an account that exists and one that does
 * not. An endpoint that answered differently would be a user-enumeration
 * oracle, and the public surface is deliberately one rate-limited POST so a
 * single internet scan cannot enumerate Carbon installs (spec Q15).
 *
 * Every gate the web login form runs happens here too, through the shared
 * `requestSignInCode`: the per-account lockout, the SSO-required refusal and
 * the user-exists check. Asking Supabase Auth for the code directly from the
 * device would skip all three.
 */
export const action = apiRoute(
  { method: "POST", public: true, body: authCodeRequest },
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

    // Store-review accounts cannot receive an emailed code, so they get a
    // password field instead. The allow-list is empty on every install but
    // Carbon Cloud, which turns the whole path off.
    if (APP_REVIEW_EMAILS.includes(email)) {
      return { ok: true as const, method: "password" as const };
    }

    const result = await requestSignInCode({
      email,
      origin: getMESUrl(),
      lockout: signInLockout(),
      channel: "mobile",
      ip
    });

    switch (result.kind) {
      case "sso_required":
        // The one refusal that is NOT silent, matching the web login form:
        // sending this user a code would be useless, and saying so is not an
        // enumeration oracle (the domain's SSO config is not a secret).
        throw new ApiError(
          403,
          "sso_required",
          "Your organization uses single sign-on. Sign in from Carbon on the web for now."
        );
      case "locked":
        throw new ApiError(
          429,
          "locked",
          "For your security, sign-in for this account is paused. Try again later.",
          undefined,
          { retryAfterSeconds: result.retryAfterSeconds }
        );
      default:
        // sent, unknown_user, bypass and error all answer identically.
        return { ok: true as const };
    }
  }
);

/** A GET here is a client bug; answer 405 rather than React Router's 400. */
export const loader = methodNotAllowed();
