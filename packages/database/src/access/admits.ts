// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ACTIONS } from "./levels";
import { type AnyGate, type ExpandedClaims, holdsGate } from "./resolve";

/** Who is asking, and what they hold, as every gate sees them. */
export type AccessActor =
  | { type: "system" }
  | {
      type: "user";
      /** The user's role in the company (`get_claims`); null when they have none. */
      role: string | null;
      permissions: ExpandedClaims | null | undefined;
    }
  | { type: "apiKey"; permissions: ExpandedClaims | null | undefined };

/**
 * A gate, or `"employee"` (the same as `{}`: a member of the company), or
 * `"system"` (the system actor only).
 */
export type AccessRequirement = AnyGate | "employee" | "system";

export type AdmitOptions = {
  /** Check the gate as a data read (`holdsGate`'s `reads`). */
  reads?: boolean;
  /**
   * Also admit a signed-in user who is not an employee of the company: a
   * customer or supplier portal account, or a user with no role there (before
   * onboarding made their first company). Only for a route that acts on the
   * user's own identity.
   */
  allowPortalAccounts?: boolean;
};

function holdsAnything(
  expanded: ExpandedClaims | null | undefined,
  companyId: string
): boolean {
  return Object.values(expanded ?? {}).some((permission) =>
    ACTIONS.some((action) => permission[action]?.includes(companyId))
  );
}

/**
 * Whether the actor may pass `requirement` in the company: the one caller
 * check. The system actor passes everything and is the only one to pass
 * `"system"`. Anyone else must first belong to the company: a user by the
 * employee role, an API key by holding some grant there. Then the gate must
 * hold (`holdsGate`); `{}` and `"employee"` ask for nothing more.
 */
export function admits(
  actor: AccessActor,
  companyId: string,
  requirement: AccessRequirement,
  { reads = false, allowPortalAccounts = false }: AdmitOptions = {}
): boolean {
  if (actor.type === "system") return true;
  if (requirement === "system") return false;
  const member =
    actor.type === "apiKey"
      ? holdsAnything(actor.permissions, companyId)
      : actor.role === "employee" || allowPortalAccounts;
  if (!member) return false;
  if (requirement === "employee") return true;
  return holdsGate(actor.permissions ?? {}, requirement, companyId, { reads });
}
