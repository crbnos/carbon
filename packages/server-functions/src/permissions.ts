// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

type Action = "view" | "create" | "update" | "delete";

/** `{ update: "inventory" }`: each action names the module(s) it needs. */
export type RequiredPermissions = Partial<Record<Action, string | string[]>>;

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
