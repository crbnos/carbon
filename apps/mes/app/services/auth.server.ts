// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import {
  getMagicLinkErrorMessage,
  logAuthEvent,
  sendMagicLink
} from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getUserByEmail } from "@carbon/auth/users.server";
import { isSsoRequiredForEmail } from "@carbon/ee/sso.server";
import type { AccountLockout } from "@carbon/kv";

/**
 * Per-account lockout rejects with a GENERIC message that never reveals whether
 * the account exists (avoids user enumeration). Exported so every caller — the
 * web login form and the mobile sign-in endpoint — renders the same words.
 */
export const LOCKED_MESSAGE =
  "For your security, sign-in for this account is temporarily paused. Please try again later.";

export const SSO_REQUIRED_MESSAGE =
  "Your organization requires single sign-on. Sign in with your work email to continue.";

export type SignInCodeResult =
  | { kind: "sent" }
  | { kind: "unknown_user" }
  | { kind: "sso_required" }
  | { kind: "locked"; retryAfterSeconds: number }
  | { kind: "bypass"; email: string }
  | { kind: "error"; message: string };

/**
 * The sign-in gates, in the order they must run — shared by the web login
 * action and the mobile `POST /api/v1/auth/code` endpoint so both are held to
 * the same checks. The ORDER is a security property; do not reorder.
 *
 * Deliberately knows nothing about `Request`, cookies or sessions: the caller
 * owns those. `{ kind: "bypass" }` hands the DEV_BYPASS_EMAIL sign-in back to
 * the caller, which is the only side that can set a session cookie.
 */
export async function requestSignInCode(args: {
  email: string;
  origin: string;
  lockout: AccountLockout;
  channel: "web" | "mobile";
  /** Recorded on every audit event. The caller resolves it from the request. */
  ip?: string;
  /**
   * Set false to re-enter the gates AFTER a `bypass` result whose sign-in
   * failed, reproducing the fall-through the web action has always had. The
   * two gates skipped on the way back in (`lockout.status`, `getUserByEmail`)
   * are pure reads, so re-running them changes nothing.
   */
  allowBypass?: boolean;
}): Promise<SignInCodeResult> {
  const { email, origin, lockout, channel, ip, allowBypass = true } = args;

  const lockStatus = await lockout.status(email);
  if (lockStatus.locked) {
    logAuthEvent("login_locked", {
      actor: email,
      ip,
      channel,
      reason: "account temporarily locked",
      retryAfterSeconds: lockStatus.retryAfterSeconds
    });
    return { kind: "locked", retryAfterSeconds: lockStatus.retryAfterSeconds };
  }

  const user = await getUserByEmail(email);

  const devBypassEmail = process.env.DEV_BYPASS_EMAIL;
  if (
    allowBypass &&
    devBypassEmail &&
    email.toLowerCase() === devBypassEmail.toLowerCase() &&
    user.data?.active
  ) {
    return { kind: "bypass", email };
  }

  const attempt = await lockout.recordFailure(email);
  if (attempt.locked) {
    logAuthEvent("login_locked", {
      actor: email,
      ip,
      channel,
      reason: "account temporarily locked",
      retryAfterSeconds: attempt.retryAfterSeconds
    });
    return { kind: "locked", retryAfterSeconds: attempt.retryAfterSeconds };
  }

  // Require-SSO gate: a covered + enforced domain may only authenticate via
  // SSO — refuse the magic link here, server-side.
  if (await isSsoRequiredForEmail(getCarbonServiceRole(), email)) {
    logAuthEvent("login_failed", {
      actor: email,
      ip,
      channel,
      reason: "sso required for domain"
    });
    return { kind: "sso_required" };
  }

  if (user.data && user.data.active) {
    const magicLink = await sendMagicLink(email, origin);

    if (magicLink.error) {
      logAuthEvent("login_failed", {
        actor: email,
        ip,
        channel,
        reason: "magic link send failed"
      });
      const message = getMagicLinkErrorMessage(magicLink.error);
      // `error(cause, message)` logs the cause. The caller rebuilds its own
      // Result from `message`, so make that log here or the cause is lost.
      error(magicLink, message);
      return { kind: "error", message };
    }
    logAuthEvent("magic_link_sent", { actor: email, ip, channel });
    return { kind: "sent" };
  }

  return { kind: "unknown_user" };
}
