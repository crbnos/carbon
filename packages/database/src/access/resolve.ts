// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ACTIONS,
  type Action,
  LEVELS,
  type Level,
  levelHolds,
  roundUp
} from "./levels";
import { moduleOf, PAGES, type PageId } from "./registry";

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

/** The grant that decides a subject's level on a page; null when none does. */
export function winningGrant<G extends Grant>(
  grants: readonly G[],
  pageId: string
): G | null {
  const module = moduleOf(pageId);
  for (const [subject, scope] of PRECEDENCE) {
    const grant = grants.find(
      (g) =>
        g.subject === subject &&
        (scope === "page"
          ? g.page === pageId
          : g.page === null && g.module.toLowerCase() === module)
    );
    if (grant) return grant;
  }
  return null;
}

/** The level of one subject on one page. The SQL helper `util.access_level` is its twin. */
export function resolveLevel(
  grants: readonly Grant[],
  pageId: string,
  { admin = false }: { admin?: boolean } = {}
): Level {
  if (admin) return "Full";
  return winningGrant(grants, pageId)?.level ?? "None";
}

/** A person or an API key, with every grant that applies to it. */
export type AccessSubject<G extends Grant = Grant> = {
  id: string;
  admin: boolean;
  grants: readonly G[];
};

/** The subjects whose level on the page reaches `atLeast`, with the deciding grant. */
export function accessHolders<G extends Grant>(
  subjects: readonly AccessSubject<G>[],
  pageId: string,
  atLeast: Level
) {
  return subjects.flatMap((subject) => {
    const grant = subject.admin ? null : winningGrant(subject.grants, pageId);
    const level = subject.admin ? "Full" : (grant?.level ?? "None");
    return LEVELS.indexOf(level) >= LEVELS.indexOf(atLeast)
      ? [{ id: subject.id, level, grant }]
      : [];
  });
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
const LEGACY_KEY = /^([a-z]+)_(view|create|update|delete)$/;

const asObject = (json: unknown): Record<string, unknown> =>
  typeof json === "object" && json !== null && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : {};

/**
 * `get_claims` from before page permissions: `{ role, "<module>_<action>":
 * [companyIds] }`, with no `grants`. A database the permission migrations have
 * not reached yet still answers in it (migrations and the app deploy apart).
 */
export function isLegacyClaims(json: unknown): boolean {
  return !Array.isArray(asObject(json).grants);
}

/**
 * Old `<module>_<action>: [companyIds]` keys as module grants in one company,
 * each at the lowest level that holds every action listed for it there: the
 * rule the conversion migration (20261110050003) applied.
 */
export function legacyGrants(
  keys: Record<string, unknown>,
  companyId: string,
  subject: Grant["subject"]
): Grant[] {
  const flags = new Map<string, Partial<Record<Action, boolean>>>();
  for (const [key, companies] of Object.entries(keys)) {
    const match = LEGACY_KEY.exec(key);
    if (!match || !Array.isArray(companies) || !companies.includes(companyId))
      continue;
    const [, module, action] = match as unknown as [string, string, Action];
    flags.set(module, { ...flags.get(module), [action]: true });
  }
  return [...flags].map(([module, held]) => ({
    subject,
    module: module.charAt(0).toUpperCase() + module.slice(1),
    page: null,
    level: roundUp(held)
  }));
}

/**
 * The `get_claims` jsonb as RawClaims; anything malformed is left out. The
 * legacy shape (no `grants`, see `isLegacyClaims`) is read as module grants in
 * `companyId`, or as portal keys for a customer or supplier.
 */
export function claimsFromJson(json: unknown, companyId?: string): RawClaims {
  const value = asObject(json);
  const role = typeof value.role === "string" ? value.role : null;
  if (isLegacyClaims(value)) {
    if (!companyId) return { role, admin: false, grants: [], portal: {} };
    if (role === "customer" || role === "supplier") {
      const portal: Record<string, string[]> = {};
      for (const [key, companies] of Object.entries(value))
        if (
          LEGACY_KEY.test(key) &&
          Array.isArray(companies) &&
          companies.includes(companyId)
        )
          portal[key] = [companyId];
      return { role, admin: false, grants: [], portal };
    }
    return {
      role,
      admin: false,
      grants:
        role === "employee" ? legacyGrants(value, companyId, "person") : [],
      portal: {}
    };
  }
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
    role,
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

/** A level a gate can ask for: `"None"` asks for nothing. */
export type GateLevel = Exclude<Level, "None">;

/**
 * `{ "inventory.receipts": "Edit" }`: each page a gate needs, and the lowest
 * level it needs there. A gate with two entries needs both.
 */
export type PageGate = Partial<Record<PageId, GateLevel>>;

/** One gate, or a list of gates of which any one passes (`anyOf`). */
export type Gate = PageGate | readonly PageGate[];

/** The highest action a level holds: the one a gate's check reads. */
export const LEVEL_ACTION: Record<GateLevel, Action> = {
  View: "view",
  Create: "create",
  Edit: "update",
  Full: "delete"
};

/** A gate that any one of the pages passes at the level. */
export function anyOf(pages: readonly PageId[], level: GateLevel): PageGate[] {
  return pages.map((page) => ({ [page]: level }) as PageGate);
}

/** Whether the expanded claims pass the gate in the company. */
export function holdsGate(
  expanded: ExpandedClaims,
  gate: Gate,
  companyId: string
): boolean {
  if (Array.isArray(gate))
    return gate.some((one: PageGate) => holdsGate(expanded, one, companyId));
  return Object.entries(gate as PageGate).every(
    ([page, level]) =>
      !level || holds(expanded, `${page}_${LEVEL_ACTION[level]}`, companyId)
  );
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

/** Expanded claims as flat `<page>_<action>` → company ids, as audit events carry them. */
export function claimKeys(expanded: ExpandedClaims): Record<string, string[]> {
  const keys: Record<string, string[]> = {};
  for (const [page, permission] of Object.entries(expanded)) {
    for (const action of ACTIONS) {
      if (permission[action].length)
        keys[`${page}_${action}`] = permission[action];
    }
  }
  return keys;
}
