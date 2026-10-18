// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ACTION_LEVEL,
  ACTIONS,
  type Action,
  claimsFromJson,
  expandClaims,
  holds,
  type Level,
  type PageId
} from "@carbon/database/access";
import { InvalidInputError } from "./errors";

/** A level a gate can ask for: `"None"` asks for nothing. */
export type GateLevel = Exclude<Level, "None">;

/**
 * `{ "inventory.receipts": "Edit" }`: each page the operation needs, and the
 * lowest level it needs there. A gate with two entries needs both.
 */
export type RequiredPermissions = Partial<Record<PageId, GateLevel>>;

/**
 * What an operation requires. `"system"` admits only the system actor;
 * `"employee"` an employee of the company or an API key of the company, for
 * reads every screen needs, such as locations or units. RLS still filters the
 * rows. A customer or supplier portal account is refused.
 */
export type Permissions = RequiredPermissions | "system" | "employee";

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

/** A user's claims per page: the company ids holding each action. */
export type ModulePermissions = Record<string, Record<Action, string[]>>;

/** The highest action a level holds: the one its check reads. */
const LEVEL_ACTION = Object.fromEntries(
  ACTIONS.map((action) => [ACTION_LEVEL[action], action])
) as Record<GateLevel, Action>;

/**
 * Whether `claims` hold every required page at its level in `companyId`: the
 * highest action of the level, `<page>_<action>`. With nothing required,
 * membership of the company (any permission naming it) is still needed.
 */
export function hasPermissions(
  claims: ModulePermissions,
  companyId: string,
  required: RequiredPermissions
): boolean {
  const entries = Object.entries(required) as [PageId, GateLevel][];
  if (entries.length === 0) {
    return Object.values(claims).some((permission) =>
      ACTIONS.some((action) => permission[action]?.includes(companyId))
    );
  }
  return entries.every(([page, level]) => {
    const action = LEVEL_ACTION[level];
    return !!action && holds(claims, `${page}_${action}`, companyId);
  });
}

/** The `get_claims` jsonb for one company as permissions per page. */
export function permissionsFromClaims(
  claims: unknown,
  companyId: string
): ModulePermissions {
  return expandClaims(claimsFromJson(claims), companyId);
}

/** Flat scopes (`<page>_<action>` → company ids) as permissions per page. */
export function permissionsFromScopes(
  scopes: Record<string, unknown>
): ModulePermissions {
  const permissions: ModulePermissions = {};
  for (const [key, value] of Object.entries(scopes)) {
    const parts = key.split("_");
    if (parts.length !== 2 || !Array.isArray(value)) continue;
    const [module, action] = parts as [string, Action];
    if (!(ACTIONS as readonly string[]).includes(action)) continue;
    permissions[module] ??= { view: [], create: [], update: [], delete: [] };
    permissions[module][action] = value as string[];
  }
  return permissions;
}
