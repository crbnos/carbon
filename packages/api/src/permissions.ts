// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { InvalidInputError } from "./errors";

type Action = "view" | "create" | "update" | "delete";

/** `{ update: "inventory" }`: each action names the module(s) it needs. */
export type RequiredPermissions = Partial<Record<Action, string | string[]>>;

/** What an operation requires. `"system"` admits only the system actor. */
export type Permissions = RequiredPermissions | "system";

/** One permission per value of a string field. Data, so the API manifest can read it. */
type KeyedRule<I> = {
  [K in keyof I & string]: I[K] extends string
    ? { by: K; rules: Record<I[K], Permissions> }
    : never;
}[keyof I & string];

export type PermissionRule<I> = Permissions | KeyedRule<I>;

/**
 * What `rule` requires for `input`. A keyed rule throws `InvalidInputError`
 * (400) naming its field when the value has no rule of its own: the caller
 * sent something the operation does not accept, which is not a 403.
 */
export function resolvePermissions<I>(
  rule: PermissionRule<I>,
  input: I
): Permissions {
  if (typeof rule === "object" && "by" in rule) {
    const value = (input as Record<string, unknown> | null | undefined)?.[
      rule.by
    ];
    const rules = rule.rules as Record<string, Permissions>;
    // Own keys only: an inherited one ("constructor") must not resolve.
    if (typeof value === "string" && Object.hasOwn(rules, value)) {
      return rules[value] as Permissions;
    }
    throw new InvalidInputError(
      `Invalid input — ${rule.by}: expected one of ${Object.keys(rules).join(", ")}`
    );
  }
  return rule as Permissions;
}

/** A user's claims per module: the company ids holding each action. */
export type ModulePermissions = Record<string, Record<Action, string[]>>;

const ACTIONS: Action[] = ["view", "create", "update", "delete"];

/**
 * Whether `claims` grant every required `<module>_<action>` in `companyId`. With
 * nothing required, membership of the company (any permission naming it) is
 * still needed.
 */
export function hasPermissions(
  claims: ModulePermissions,
  companyId: string,
  required: RequiredPermissions
): boolean {
  const entries = Object.entries(required) as [Action, string | string[]][];
  if (entries.length === 0) {
    return Object.values(claims).some((permission) =>
      ACTIONS.some((action) => permission[action]?.includes(companyId))
    );
  }
  return entries.every(([action, modules]) =>
    (typeof modules === "string" ? [modules] : modules).every((module) =>
      claims[module]?.[action]?.includes(companyId)
    )
  );
}

/**
 * A user's claims (the `get_claims` jsonb: `<module>_<action>` → company ids,
 * plus `role`) as permissions per module.
 */
export function permissionsFromClaims(
  claims: Record<string, unknown>
): ModulePermissions {
  const permissions: ModulePermissions = {};
  for (const [key, value] of Object.entries(claims)) {
    const parts = key.split("_");
    if (parts.length !== 2 || !Array.isArray(value)) continue;
    const [module, action] = parts as [string, Action];
    if (!ACTIONS.includes(action)) continue;
    permissions[module] ??= { view: [], create: [], update: [], delete: [] };
    permissions[module][action] = value as string[];
  }
  return permissions;
}
