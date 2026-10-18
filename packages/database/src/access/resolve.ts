// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ACTIONS, type Action, LEVELS, type Level, levelHolds } from "./levels";
import { moduleOf, PAGES } from "./registry";

/** One row of the `permission` table, as the resolver reads it. */
export type Grant = {
  subject: "person" | "role" | "key";
  /** The `module` enum label ("Inventory"); a page id is its lowercase. */
  module: string;
  /** NULL: the grant covers the whole module. */
  page: string | null;
  level: Level;
};

// The first grant that exists wins: a person's override beats their role, and
// a page beats its module. A key has only its own grants.
const PRECEDENCE: readonly [Grant["subject"], "page" | "module"][] = [
  ["person", "page"],
  ["person", "module"],
  ["role", "page"],
  ["role", "module"],
  ["key", "page"],
  ["key", "module"]
];

/** The level of one subject on one page. The SQL helper `access_level` is its twin. */
export function resolveLevel(
  grants: readonly Grant[],
  pageId: string,
  { admin = false }: { admin?: boolean } = {}
): Level {
  if (admin) return "Full";
  const module = moduleOf(pageId);
  for (const [subject, scope] of PRECEDENCE) {
    const grant = grants.find(
      (g) =>
        g.subject === subject &&
        (scope === "page"
          ? g.page === pageId
          : g.page === null && g.module.toLowerCase() === module)
    );
    if (grant) return grant.level;
  }
  return "None";
}

/** What `get_claims` returns for one user in one company. */
export type RawClaims = {
  role: string | null;
  /** The user's employee type is the Admin type: Full on every page. */
  admin: boolean;
  grants: readonly Grant[];
  /** Portal accounts' keys, still held in `userPermission`. */
  portal: Record<string, string[]>;
};

const LEVEL_SET = new Set<string>(LEVELS);
const SUBJECTS = new Set<string>(["person", "role", "key"]);

/** The `get_claims` jsonb as RawClaims; anything malformed is left out. */
export function claimsFromJson(json: unknown): RawClaims {
  const value =
    typeof json === "object" && json !== null && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  const grants = (Array.isArray(value.grants) ? value.grants : []).filter(
    (g): g is Grant =>
      typeof g === "object" &&
      g !== null &&
      SUBJECTS.has((g as Grant).subject) &&
      typeof (g as Grant).module === "string" &&
      ((g as Grant).page === null || typeof (g as Grant).page === "string") &&
      LEVEL_SET.has((g as Grant).level)
  );
  const portal =
    typeof value.portal === "object" &&
    value.portal !== null &&
    !Array.isArray(value.portal)
      ? (value.portal as Record<string, string[]>)
      : {};
  return {
    role: typeof value.role === "string" ? value.role : null,
    admin: value.admin === true,
    grants,
    portal
  };
}

export type ExpandedPermission = Record<Action, string[]>;
/** `{ [pageId]: { view, create, update, delete } }`, each a list of company ids. */
export type ExpandedClaims = Record<string, ExpandedPermission>;

const empty = (): ExpandedPermission => ({
  view: [],
  create: [],
  update: [],
  delete: []
});

/**
 * Grants as the shape the app reads: one entry per page, each action holding
 * the company when the page's level includes it. Only the registry knows a
 * module's pages, so this runs in TS, not in SQL.
 */
export function expandClaims(
  raw: RawClaims,
  companyId: string
): ExpandedClaims {
  const out: ExpandedClaims = {};
  for (const page of PAGES) {
    const level = resolveLevel(raw.grants, page.id, { admin: raw.admin });
    const permission = empty();
    for (const action of ACTIONS) {
      if (levelHolds(level, action)) permission[action].push(companyId);
    }
    out[page.id] = permission;
  }
  for (const [key, companies] of Object.entries(raw.portal)) {
    const match = key.match(/^(.+)_(view|create|update|delete)$/);
    if (!match || !Array.isArray(companies)) continue;
    const [, feature, action] = match as [string, string, Action];
    out[feature] ??= empty();
    for (const company of companies) {
      if (!out[feature][action].includes(company))
        out[feature][action].push(company);
    }
  }
  return out;
}

/** Whether the expanded claims hold `<page>_<action>` in the company. */
export function holds(
  expanded: ExpandedClaims,
  key: string,
  companyId: string
): boolean {
  const match = key.match(/^(.+)_(view|create|update|delete)$/);
  if (!match) return false;
  const [, page, action] = match as [string, string, Action];
  return expanded[page]?.[action]?.includes(companyId) ?? false;
}

/** Whether any page of the module holds the action in the company (navigation). */
export function holdsAny(
  expanded: ExpandedClaims,
  module: string,
  action: Action,
  companyId: string
): boolean {
  return Object.entries(expanded).some(
    ([page, permission]) =>
      moduleOf(page) === module && permission[action].includes(companyId)
  );
}
