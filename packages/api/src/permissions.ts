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
  LEVELS,
  type Level,
  type PAGES,
  type PageId,
  placeOf
} from "@carbon/database/access";
import { ForbiddenError, InvalidInputError, NotFoundError } from "./errors";

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

/** Passes when the actor holds any one entry: a list no single row decides. */
export type AnyOfRule = { anyOf: readonly RequiredPermissions[] };

/**
 * One way the last row of a row rule decides: its `column` equals `equals`,
 * or, without `equals`, is set. `then` is what the gate then requires.
 */
export type RowCase = {
  column: string;
  equals?: string;
  then: RequiredPermissions;
};

/** An input's own fields, without the index signature a loose object adds. */
type OwnKeys<I> = keyof {
  [K in keyof I as string extends K ? never : K]: I[K];
} &
  string;

/** The input fields that can name rows: a string, or a list of strings. */
type RowIdField<I> = {
  [K in OwnKeys<I>]: I[K] extends string | readonly string[] ? K : never;
}[OwnKeys<I>];

/** `[fk, table]`: the next table's row whose `id` is the previous row's `fk`. */
export type RowHop = readonly [fk: string, table: string];

/**
 * The row the input names decides the gate: a table several pages share
 * (`item` by its type). The rule reads `from` by the id in the input field
 * `id`, follows `path` hop by hop, and requires the `then` of the first case
 * the last row matches. Every table is read in the caller's company. A list
 * of ids requires every row's `then`. Data, so the API manifest can read it.
 */
export type RowRule<I> = { row: RowSpec & { id: RowIdField<I> } };

/** A row rule's body: the input field, the tables and the cases. */
export type RowSpec = {
  id: string;
  from: string;
  path?: readonly RowHop[];
  cases: readonly RowCase[];
};

export type PermissionRule<I> =
  | Permissions
  | KeyedRule<I>
  | AnyOfRule
  | RowRule<I>;

/** What a gate checks against the actor. */
export type Requirement = Permissions | AnyOfRule;

/** A row rule with the ids its input names: the rows decide, once read. */
export type RowsToRead = { row: RowSpec; ids: string[] };

/** The pages whose rows of `table` a column picks (`where`), by id. */
type SharedPageId<T extends string> = Extract<
  (typeof PAGES)[number],
  { where: { table: T } }
>["id"];

/** `{ "parts.tools": "Edit" } | { "parts.parts": "Edit" } | …`: one page each. */
type OnePageOf<P extends string, L extends GateLevel> = P extends string
  ? { [K in P]: L }
  : never;

/** The pages that share `table`, each as the case its `where` picks. */
function sharedCases(table: string, level: GateLevel): RowCase[] {
  const place = placeOf(table);
  if (place?.kind !== "shared") {
    throw new Error(`${table} is not a table several pages share`);
  }
  return place.branches.map((branch) => ({
    column: branch.column,
    ...(branch.value === undefined ? {} : { equals: branch.value }),
    then: { [branch.page]: level }
  }));
}

/**
 * The rule of an operation on rows of a table several pages share: the page
 * the row's `where` column picks, at `level`. `from` and `path` reach that
 * table from the row the input names; left out, `id` names a row of `table`.
 * The cases come from the registry, so a page added there is a case here.
 */
export function rowRule<
  const T extends string,
  const L extends GateLevel,
  const K extends string
>(
  table: T,
  level: L,
  at: { id: K; from?: string; path?: readonly RowHop[] }
): {
  row: {
    id: K;
    from: string;
    path?: readonly RowHop[];
    cases: {
      column: string;
      equals?: string;
      then: OnePageOf<SharedPageId<T>, L>;
    }[];
  };
} {
  const from = at.from ?? table;
  const last = at.path?.at(-1)?.[1] ?? from;
  if (last !== table) {
    throw new Error(
      `The path of a rule on ${table} must end at ${table}, not ${last}`
    );
  }
  return {
    row: {
      id: at.id,
      from,
      ...(at.path ? { path: at.path } : {}),
      cases: sharedCases(table, level) as {
        column: string;
        equals?: string;
        then: OnePageOf<SharedPageId<T>, L>;
      }[]
    }
  };
}

/** Any one page that shares `table`, at `level`: a list of its rows, which RLS filters. */
export function anyOfRule<T extends string, L extends GateLevel>(
  table: T,
  level: L
): { anyOf: OnePageOf<SharedPageId<T>, L>[] } {
  return {
    anyOf: sharedCases(table, level).map(
      (rule) => rule.then as OnePageOf<SharedPageId<T>, L>
    )
  };
}

/**
 * What `rule` requires for `input`, or the rows that decide it. A keyed rule
 * throws `InvalidInputError` (400) naming its field when the value has no rule
 * of its own: the caller sent something the operation does not accept, which
 * is not a 403. A row rule does the same when its field holds no id.
 */
export function resolvePermissions<I>(
  rule: Permissions | KeyedRule<I>,
  input: I
): Permissions;
export function resolvePermissions<I>(
  rule: PermissionRule<I>,
  input: I
): Requirement | RowsToRead;
export function resolvePermissions<I>(
  rule: PermissionRule<I>,
  input: I
): Requirement | RowsToRead {
  if (typeof rule === "object" && "row" in rule) {
    const { row } = rule as { row: RowSpec };
    const value = (input as Record<string, unknown> | null | undefined)?.[
      row.id
    ];
    const ids = typeof value === "string" ? [value] : value;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((id) => typeof id === "string")
    ) {
      throw new InvalidInputError(
        `Invalid input — ${row.id}: expected an id or a list of ids`
      );
    }
    return { row, ids: [...new Set(ids as string[])] };
  }
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
  return rule as Requirement;
}

/**
 * What the rows a row rule read require: each row's first matching case,
 * all of them together. `rows` carry the source row's `id` and the case
 * columns of the last table. An id with no row is `NotFoundError`; a row no
 * case matches is `ForbiddenError` (an item type no page owns).
 */
export function requirementOfRows(
  { row, ids }: RowsToRead,
  rows: readonly Record<string, unknown>[]
): RequiredPermissions {
  const byId = new Map(rows.map((found) => [found.id, found]));
  const required: Record<string, GateLevel> = {};
  for (const id of ids) {
    const found = byId.get(id);
    if (!found) throw new NotFoundError(`${row.from} ${id} was not found`);
    const match = row.cases.find((rowCase) =>
      rowCase.equals === undefined
        ? found[rowCase.column] != null
        : found[rowCase.column] === rowCase.equals
    );
    if (!match) throw new ForbiddenError();
    for (const [page, level] of Object.entries(match.then) as [
      string,
      GateLevel
    ][]) {
      const held = required[page];
      if (!held || LEVELS.indexOf(level) > LEVELS.indexOf(held)) {
        required[page] = level;
      }
    }
  }
  return required as RequiredPermissions;
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

/** `hasPermissions`, or for an `anyOf` rule whether any one entry holds. */
export function meetsRequirement(
  claims: ModulePermissions,
  companyId: string,
  required: RequiredPermissions | AnyOfRule
): boolean {
  return "anyOf" in required
    ? required.anyOf.some((entry) => hasPermissions(claims, companyId, entry))
    : hasPermissions(claims, companyId, required);
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
