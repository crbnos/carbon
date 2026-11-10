// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ACTIONS,
  type Action,
  type GateLevel,
  LEVEL_ACTION,
  LEVELS,
  type Level,
  levelHolds,
  levelReaches,
  lowerLevel,
  parsePermissionKey,
  permissionKey,
  roundUp
} from "./levels";
import {
  isPageModule,
  moduleEnum,
  moduleId,
  moduleOf,
  PAGES,
  type PageId,
  pageById,
  pagesOf,
  readPages
} from "./registry";

/** One row of the `permission` table, as the resolver reads it. */
export type Grant = {
  subject: "person" | "role" | "key";
  /** The `module` enum label ("Inventory"); `moduleId` maps it to the page ids' module. */
  module: string;
  /** NULL: the grant covers the whole module. */
  page: string | null;
  level: Level;
};

/** What decided a level: Admin, or the subject and scope of the winning grant. */
export type LevelSource =
  | "admin"
  | `${Grant["subject"]}-${"page" | "module"}`
  | "none";

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

/**
 * A person or an API key in one company: its grants there (each tagged with
 * whose it is), and whether its employee type is that company's Admin type
 * (`isAdminType`).
 */
export type LevelSubject<G extends Grant = Grant> = {
  admin?: boolean;
  grants: readonly G[];
};

export type LevelOf<G extends Grant = Grant> = {
  /** The level the subject holds on the page: `granted`, at most the page's `maxLevel`. */
  level: Level;
  /** The level Admin or the winning grant gives, before `maxLevel`. */
  granted: Level;
  /** Whether `maxLevel` lowered `granted`. */
  clamped: boolean;
  source: LevelSource;
  /** The winning grant; null for Admin and for none. */
  grant: G | null;
};

/**
 * The level of one subject on one page: Admin is Full; else the first grant in
 * precedence order (person page, person module, role page, role module, key
 * page, key module); else None. The SQL twin is `util.access_level`; both
 * pass `access/cases.json`.
 */
export function levelOf<G extends Grant>(
  subject: LevelSubject<G>,
  pageId: string
): LevelOf<G> {
  const max = pageById(pageId)?.maxLevel ?? "Full";
  const result = (granted: Level, source: LevelSource, grant: G | null) => {
    const level = lowerLevel(granted, max);
    return { level, granted, clamped: level !== granted, source, grant };
  };
  if (subject.admin) return result("Full", "admin", null);
  const module = moduleOf(pageId);
  for (const [who, scope] of PRECEDENCE) {
    const grant = subject.grants.find(
      (g) =>
        g.subject === who &&
        (scope === "page"
          ? g.page === pageId
          : g.page === null && moduleId(g.module) === module)
    );
    if (grant) return result(grant.level, `${who}-${scope}`, grant);
  }
  return result("None", "none", null);
}

// The level the resolver hands out. `granted`, not `level`, until the gates
// that ask above a page's `maxLevel` are fixed (untangle F5): clamping here
// would refuse them to everyone.
const resolved = (of: LevelOf<Grant>): Level => of.level;

/** Whether an employee type is the company's own Admin type: one of another company grants nothing. */
export function isAdminType(
  type: { systemType?: string | null; companyId?: string | null },
  companyId: string
): boolean {
  return type.systemType === "Admin" && type.companyId === companyId;
}

/** The level of one subject on one page, as claims carry it (`levelOf`). */
export function resolveLevel(
  grants: readonly Grant[],
  pageId: string,
  { admin = false }: { admin?: boolean } = {}
): Level {
  return resolved(levelOf({ admin, grants }, pageId));
}

/** A person or an API key, with every grant that applies to it. */
export type AccessSubject<G extends Grant = Grant> = LevelSubject<G> & {
  id: string;
  admin: boolean;
};

/** The subjects whose level on the page reaches `atLeast`, with the deciding grant. */
export function accessHolders<G extends Grant>(
  subjects: readonly AccessSubject<G>[],
  pageId: string,
  atLeast: Level
) {
  return subjects.flatMap((subject) => {
    const of = levelOf(subject, pageId);
    const level = resolved(of);
    return levelReaches(level, atLeast)
      ? [{ id: subject.id, level, grant: of.grant }]
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

/** A legacy `<module>_<action>` key: a module id is lowercase letters, no dot. */
const legacyKey = (key: string) => {
  const parsed = parsePermissionKey(key);
  return parsed && /^[a-z]+$/.test(parsed.subject) ? parsed : null;
};

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
 * rule the conversion migration (20261110050003) applied. A module with no
 * pages (`items`, `printing`) grants nothing, so it is left out.
 */
export function legacyGrants(
  keys: Record<string, unknown>,
  companyId: string,
  subject: Grant["subject"]
): Grant[] {
  const flags = new Map<string, Partial<Record<Action, boolean>>>();
  for (const [key, companies] of Object.entries(keys)) {
    const parsed = legacyKey(key);
    if (!parsed || !Array.isArray(companies) || !companies.includes(companyId))
      continue;
    flags.set(parsed.subject, {
      ...flags.get(parsed.subject),
      [parsed.action]: true
    });
  }
  return [...flags].flatMap(([module, held]) => {
    const label = moduleEnum(module as Parameters<typeof moduleEnum>[0]);
    return isPageModule(label)
      ? [{ subject, module: label, page: null, level: roundUp(held) }]
      : [];
  });
}

/**
 * The `get_claims` jsonb as RawClaims; anything malformed is left out. The
 * legacy shape (no `grants`, see `isLegacyClaims`) is read as module grants in
 * `companyId`, or as portal keys for a customer or supplier.
 */
export function claimsFromJson(json: unknown, companyId: string): RawClaims {
  const value = asObject(json);
  const role = typeof value.role === "string" ? value.role : null;
  if (isLegacyClaims(value)) {
    if (role === "customer" || role === "supplier") {
      const portal: Record<string, string[]> = {};
      for (const [key, companies] of Object.entries(value))
        if (
          legacyKey(key) &&
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
    const parsed = parsePermissionKey(key);
    if (!parsed || !Array.isArray(companies)) continue;
    const entry = (out[parsed.subject] ??= empty());
    for (const company of companies) {
      if (!entry[parsed.action].includes(company))
        entry[parsed.action].push(company);
    }
  }
  return out;
}

/** One user's claims in one company: what `get_claims` returned, and `permissions` expanded from it. */
export type Claims = RawClaims & { permissions: ExpandedClaims };

/** The `get_claims` jsonb for one company as `Claims`: the one way to build them. */
export function claimsFor(json: unknown, companyId: string): Claims {
  const raw = claimsFromJson(json, companyId);
  return { ...raw, permissions: expandClaims(raw, companyId) };
}

/** Whether the expanded claims hold `<page>_<action>` in the company. */
export function holds(
  expanded: ExpandedClaims,
  key: string,
  companyId: string
): boolean {
  const parsed = parsePermissionKey(key);
  if (!parsed) return false;
  return (
    expanded[parsed.subject]?.[parsed.action]?.includes(companyId) ?? false
  );
}

/**
 * `{ "inventory.receipts": "Edit" }`: each page a gate needs, and the lowest
 * level it needs there. A gate with two entries needs both.
 */
export type PageGate = Partial<Record<PageId, GateLevel>>;

/** One gate, or a list of gates of which any one passes (`anyOf`). */
export type Gate = PageGate | readonly PageGate[];

/** A list of gates of which any one passes, as service functions write it. */
export type AnyOfGate = { readonly anyOf: readonly PageGate[] };

/** Every form `holdsGate` reads. */
export type AnyGate = Gate | AnyOfGate;

/** A gate that any one of the pages passes at the level. */
export function anyOf(pages: readonly PageId[], level: GateLevel): PageGate[] {
  return pages.map((page) => ({ [page]: level }) as PageGate);
}

const isAnyOf = (gate: AnyGate): gate is AnyOfGate =>
  typeof gate === "object" && gate !== null && "anyOf" in gate;

/** The gates of which any one passes. */
function alternatives(gate: AnyGate): readonly PageGate[] {
  if (Array.isArray(gate)) return gate;
  return isAnyOf(gate) ? gate.anyOf : [gate as PageGate];
}

/** `{ "<page>": "View" }` on a registry page: the one read `widenReads` widens. */
function onePageRead(gate: unknown): PageId | null {
  if (typeof gate !== "object" || gate === null) return null;
  const entries = Object.entries(gate);
  if (entries.length !== 1) return null;
  const [page, level] = entries[0] as [string, unknown];
  return level === "View" && pageById(page) ? (page as PageId) : null;
}

/** View on one page as View on any page that reads what it owns; anything else unchanged. */
function widenOne(gate: PageGate): readonly PageGate[] {
  const page = onePageRead(gate);
  const pages = page ? readPages(page) : [];
  return pages.length > 1 ? anyOf(pages, "View") : [gate];
}

/**
 * A gate as a data read asks it: View on one page admits View on every page
 * that reads what the page owns (`readPages`: its module, and the pages of
 * other modules that list its tables in `readers`), the reads RLS renders.
 * In a list, View on a page of a shared table stays: RLS picks which of its
 * rows the caller reads. Any other entry, a write or a gate of two pages,
 * stays as written. A widened gate comes back as `{ anyOf }`.
 */
export function widenReads(gate: AnyGate): AnyGate {
  if (!Array.isArray(gate) && !isAnyOf(gate)) {
    const widened = widenOne(gate as PageGate);
    return widened.length > 1 ? { anyOf: widened } : gate;
  }
  const seen = new Set<string>();
  return {
    anyOf: alternatives(gate)
      .flatMap((entry) => {
        const page = onePageRead(entry);
        return page && pageById(page)?.where ? [entry] : widenOne(entry);
      })
      .filter((entry) => {
        const key = JSON.stringify(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
  };
}

/** Whether every entry of one gate holds. */
function holdsAll(
  expanded: ExpandedClaims,
  gate: PageGate,
  companyId: string
): boolean {
  return Object.entries(gate).every(([page, level]) => {
    if (!level) return true;
    const action = LEVEL_ACTION[level as GateLevel];
    return !!action && (expanded[page]?.[action]?.includes(companyId) ?? false);
  });
}

/**
 * Whether the expanded claims pass the gate in the company: every entry of a
 * `PageGate` at the highest action of its level, or any one gate of a list or
 * an `{ anyOf }`. An entry with no level asks for nothing, so `{}` passes:
 * whether the caller belongs to the company is the caller check's question,
 * not the gate's. An empty list passes nothing. No claims pass nothing.
 *
 * Page gates (routes, sidebars, buttons) are exact. A data read asks with
 * `{ reads: true }`, which widens it first (`widenReads`).
 */
export function holdsGate(
  expanded: ExpandedClaims | null | undefined,
  gate: AnyGate,
  companyId: string,
  { reads = false }: { reads?: boolean } = {}
): boolean {
  if (!expanded) return false;
  return alternatives(reads ? widenReads(gate) : gate).some((one) =>
    holdsAll(expanded, one, companyId)
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

/**
 * Where a module's link takes a person: `prefer` when they can view it, else
 * the first page of the module, in sidebar order, that they can view and whose
 * first path has no `$param`. Undefined when there is none. `path` is the
 * page's first path.
 */
export function landingOf(
  module: string,
  expanded: ExpandedClaims | null | undefined,
  companyId: string,
  { prefer }: { prefer?: PageId } = {}
): { page: PageId; path: string } | undefined {
  const canView = (page: PageId) =>
    holdsGate(expanded, { [page]: "View" }, companyId);
  const at = (page: PageId) => pageById(page)?.paths[0];
  const preferred = prefer && at(prefer);
  if (prefer && preferred && canView(prefer))
    return { page: prefer, path: preferred };
  for (const page of pagesOf(module)) {
    const path = at(page);
    if (path && !path.includes("$") && canView(page)) return { page, path };
  }
  return undefined;
}

/** Expanded claims as flat `<page>_<action>` → company ids, as audit events carry them. */
export function claimKeys(expanded: ExpandedClaims): Record<string, string[]> {
  const keys: Record<string, string[]> = {};
  for (const [page, permission] of Object.entries(expanded)) {
    for (const action of ACTIONS) {
      if (permission[action].length)
        keys[permissionKey(page, action)] = permission[action];
    }
  }
  return keys;
}
