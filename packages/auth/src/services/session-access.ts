// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  admits,
  type Claims,
  type Gate,
  userActor
} from "@carbon/database/access";

/** What a session gate reads of a user's claims: `getUserClaims` returns it. */
export type SessionClaims = Pick<Claims, "permissions" | "role">;

export type SessionAccess = {
  /** The claims every gate of the request checks: the pinned operator's on a console, else the session user's. */
  claims: SessionClaims;
  /** The claims that failed, or `null` when the request is admitted. */
  refusedBy: SessionClaims | null;
};

/**
 * Whose grants decide a session request. On a console terminal with an
 * operator pinned in, the operator acts: their claims pass the gate and are
 * the ones returned. The terminal's session user must still belong to the
 * company (`{}`), so a deactivated terminal account opens nothing.
 */
export function sessionAccess(
  companyId: string,
  gate: Gate,
  options: { allowPortalAccounts?: boolean },
  session: SessionClaims,
  operator: SessionClaims | null
): SessionAccess {
  const holds = (claims: SessionClaims, required: Gate) =>
    admits(userActor(claims), companyId, required, {
      allowPortalAccounts: options.allowPortalAccounts
    });

  if (!operator) {
    return {
      claims: session,
      refusedBy: holds(session, gate) ? null : session
    };
  }
  if (!holds(session, {})) return { claims: operator, refusedBy: session };
  return {
    claims: operator,
    refusedBy: holds(operator, gate) ? null : operator
  };
}
