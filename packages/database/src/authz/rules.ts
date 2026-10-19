// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DummyDriver,
  type Expression,
  type ExpressionBuilder,
  expressionBuilder,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type RawBuilder,
  type SqlBool,
  sql
} from "kysely";
import {
  moduleOf,
  type PermissionKey,
  pagesOf,
  placeOf,
  readersOf,
  type TablePlace
} from "../access/registry";
import type { KyselyDatabase } from "../client";
import type { Database } from "../types";

type Public = Database["public"];

export type Table = keyof Public["Tables"] & keyof KyselyDatabase;
type Column<T extends Table> = keyof Public["Tables"][T]["Row"] & string;
export type Module = Lowercase<Public["Enums"]["module"]>;
type Action = "view" | "create" | "update" | "delete";
/**
 * A module key (`parts_update`) or a page key (`parts.tools_update`). A module
 * key renders as the key of the page that owns the table (see `render`); a page
 * key renders as written.
 */
export type Permission = `${Module}_${Action}` | PermissionKey;

// ─── Who: the companies a caller belongs to ──────────────────────────────────

/**
 * - `"employee"`: get_companies_with_employee_role() — any employee of the company, and
 *   any API key of it regardless of the key's scopes.
 * - `"member"`: get_companies_with_any_role() — employees, customers and suppliers.
 * - a Permission: get_companies_with_employee_permission() — scope-checked for API keys.
 * - `anyOf(...)`: holds at least one of the permissions.
 */
export type Who = "employee" | "member" | Permission | { anyOf: Permission[] };

export const anyOf = (...permissions: Permission[]): Who => ({
  anyOf: permissions
});

// ─── Predicates ──────────────────────────────────────────────────────────────

/** A policy expression, compiled against the table it guards. */
export type Pred = { readonly sql: (table: string) => RawBuilder<unknown> };

const pred = (build: (table: string) => RawBuilder<unknown>): Pred => ({
  sql: build
});

const isPred = (value: unknown): value is Pred =>
  typeof value === "object" && value !== null && "sql" in value;

// The table `render` is compiling. A module key in its rules resolves to the
// page that owns the table (access/registry.ts), wherever in the rule it sits.
let rendering: string | undefined;

/** The action of a module key (`parts_update`); undefined for a page key. */
const moduleAction = (permission: string) =>
  /^[a-z]+_(view|create|update|delete)$/.exec(permission)?.[1] as
    | Action
    | undefined;

/** `subject` is one of the companies where the caller holds `key`. */
const holds = (subject: RawBuilder<unknown>, key: string) =>
  sql`${subject} = ANY ((SELECT get_companies_with_employee_permission(${sql.lit(key)}))::text[])`;

const either = (terms: RawBuilder<unknown>[]) =>
  terms.length === 1 && terms[0]
    ? terms[0]
    : sql`(${sql.join(terms, sql` OR `)})`;

/**
 * The keys that admit `action` on what `page` owns. A read admits View on any
 * page of the page's module; a write needs the page itself.
 */
const pageKeys = (page: string, action: Action): string[] =>
  action === "view"
    ? pagesOf(moduleOf(page)).map((id) => `${id}_view`)
    : [`${page}_${action}`];

/**
 * A shared table's rows, one branch per page: the page's rows and the page's
 * key. A child table reaches its parent row through its path, one `EXISTS`
 * per hop, and checks the parent's branches. Every hop is in the company of
 * the hop before it; the first is in `company`, the row's own company.
 */
const branches = (
  subject: RawBuilder<unknown>,
  company: RawBuilder<unknown>,
  table: string,
  place: Exclude<TablePlace, { kind: "page" }>,
  action: Action
) => {
  const owner = place.kind === "child" ? place.parent : table;
  const arms = either(
    place.branches.map((branch) => {
      const column = sql.ref(`${owner}.${branch.column}`);
      return sql`(${
        branch.value === undefined
          ? sql`${column} IS NOT NULL`
          : sql`${column} = ${sql.lit(branch.value)}`
      } AND ${either(
        pageKeys(branch.page, action).map((key) => holds(subject, key))
      )})`;
    })
  );
  if (place.kind === "shared") return arms;
  const hop = (
    i: number,
    from: string,
    inCompany: RawBuilder<unknown>
  ): RawBuilder<unknown> => {
    const [fk, to] = place.path[i] as readonly [string, string];
    const rest =
      i + 1 < place.path.length
        ? hop(i + 1, to, sql.ref(`${to}.companyId`))
        : arms;
    return sql`EXISTS (SELECT 1 FROM ${sql.id("public", to)} WHERE ${sql.ref(`${to}.id`)} = ${sql.ref(`${from}.${fk}`)} AND ${sql.ref(`${to}.companyId`)} = ${inCompany} AND ${rest})`;
  };
  return hop(0, table, company);
};

/**
 * `subject` is one of the caller's companies (or, for anyOf, satisfies any of
 * them). A module key checks the page that owns the table instead. A view
 * admits View on any page of that page's module (a child's: its parent's),
 * and on every page that lists the table in `readers`. Writes stay per page. `company`
 * is the row's own company, qualified, for a child's first hop: the table's
 * `companyId` unless the row has none (a link row, through `exists`).
 */
const belongsTo = (
  subject: RawBuilder<unknown>,
  who: Who,
  company?: RawBuilder<unknown>
): RawBuilder<unknown> => {
  if (who === "employee")
    return sql`${subject} = ANY ((SELECT get_companies_with_employee_role())::text[])`;
  if (who === "member")
    return sql`${subject} = ANY ((SELECT get_companies_with_any_role())::text[])`;
  const terms: RawBuilder<unknown>[] = [];
  const seen = new Set<string>();
  const add = (key: string, term: () => RawBuilder<unknown>) => {
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term());
  };
  const table = rendering;
  const place = table ? placeOf(table) : undefined;
  for (const permission of typeof who === "object" ? who.anyOf : [who]) {
    const action = moduleAction(permission);
    if (!action || !table || !place) {
      add(permission, () => holds(subject, permission));
      continue;
    }
    if (place.kind === "page") {
      for (const key of pageKeys(place.page, action))
        add(key, () => holds(subject, key));
    } else if (place.kind === "child" && action === "view") {
      // A child's read never goes through its parent: the parent's SELECT
      // reads its children (item's portal branches read supplierPart), so a
      // lookup back would make Postgres refuse both tables as recursive. It
      // admits View on any page of its parent's module.
      for (const { page } of place.branches)
        for (const key of pageKeys(page, "view"))
          add(key, () => holds(subject, key));
    } else {
      add(`:${action}`, () =>
        branches(
          subject,
          company ?? sql.ref(`${table}.companyId`),
          table,
          place,
          action
        )
      );
    }
    if (action === "view")
      for (const reader of readersOf(table)) {
        const key = `${reader}_view`;
        add(key, () => holds(subject, key));
      }
  }
  return either(terms);
};

/** The row's own company column is one of the caller's companies. */
export const inCompany = (column: string, who: Who): Pred =>
  pred(() => belongsTo(sql.ref(column), who));

/** The row's company group is one the caller belongs to (group-shared tables). */
export const inGroup = (column: string, who: "employee" | Permission): Pred =>
  pred(
    () =>
      sql`${sql.ref(column)} = ANY ((SELECT ${
        who === "employee"
          ? sql`get_company_groups_for_employee()`
          : sql`get_company_groups_for_root_permission(${sql.lit(groupKey(who))})`
      })::text[])`
  );

// ponytail: every group table sits on one page and every employee reads it, so
// a module key maps to the owner's key alone; branches and readers throw.
const groupKey = (permission: Permission) => {
  const action = moduleAction(permission);
  const place = rendering ? placeOf(rendering) : undefined;
  if (!action || !rendering || !place) return permission;
  if (
    place.kind !== "page" ||
    (action === "view" && readersOf(rendering).length)
  )
    throw new Error(`authz: group table ${rendering} needs one page`);
  return `${place.page}_${action}`;
};

/** The company of the parent row `fk` points at, resolved by get_company_id_from_foreign_key. */
export const viaParent = (fk: string, parentTable: Table, who: Who): Pred =>
  pred(() =>
    belongsTo(
      sql`get_company_id_from_foreign_key(${sql.ref(fk)}, ${sql.lit(parentTable)})`,
      who
    )
  );

/**
 * The parent row `fk` points at exists and satisfies `condition`: a Who (the parent's
 * company is one of the caller's) or any predicate, whose bare columns are the parent's.
 * `sameCompany` also requires the parent to be in the row's own company.
 */
export const exists = (
  parentTable: Table,
  fk: string,
  condition: Who | Pred,
  { sameCompany = false }: { sameCompany?: boolean } = {}
): Pred =>
  pred((table) => {
    const parts = [sql`${sql.ref("p.id")} = ${sql.ref(`${table}.${fk}`)}`];
    if (sameCompany) {
      parts.push(
        sql`${sql.ref("p.companyId")} = ${sql.ref(`${table}.companyId`)}`
      );
    }
    parts.push(
      isPred(condition)
        ? condition.sql(parentTable)
        : belongsTo(sql.ref("p.companyId"), condition, sql.ref("p.companyId"))
    );
    return sql`EXISTS (SELECT 1 FROM ${sql.id("public", parentTable)} p WHERE ${sql.join(parts, sql` AND `)})`;
  });

/**
 * `local` is reachable through a link table: it is one of `linkTable.linkColumn` over the
 * link rows satisfying `condition`, whose bare columns are the link table's.
 */
export const through = (
  local: string,
  linkTable: Table,
  linkColumn: string,
  condition: Pred
): Pred =>
  pred(
    () =>
      sql`${sql.ref(local)} IN (SELECT ${sql.ref(`${linkTable}.${linkColumn}`)} FROM ${sql.id("public", linkTable)} WHERE ${condition.sql(linkTable)})`
  );

/**
 * The caller has any membership in the company `column` names (userToCompany). Unlike
 * the `"member"` Who, an API key never passes: it has no auth.uid().
 */
export const member = (column: string): Pred =>
  through(column, "userToCompany", "companyId", owner("userId"));

/** The row belongs to the calling user. */
export const owner = (column: string): Pred =>
  pred(() => sql`${sql.ref(column)} = ((SELECT auth.uid()))::text`);

/** The row belongs to a customer or supplier the portal user acts for. */
export const portal = {
  customer: (column: string, permission: Permission): Pred =>
    pred(
      () =>
        sql`${sql.ref(column)} = ANY ((SELECT get_customer_ids_with_customer_permission(${sql.lit(permission)}))::text[])`
    ),
  supplier: (column: string, permission: Permission): Pred =>
    pred(
      () =>
        sql`${sql.ref(column)} = ANY ((SELECT get_supplier_ids_with_supplier_permission(${sql.lit(permission)}))::text[])`
    )
};

/** Any signed-in user (reference data readable by everyone). */
export const authenticated: Pred = pred(
  () => sql`(SELECT auth.role()) = 'authenticated'`
);

export const always: Pred = pred(() => sql`true`);

export const isNull = (column: string): Pred =>
  pred(() => sql`${sql.ref(column)} IS NULL`);

export const isNotNull = (column: string): Pred =>
  pred(() => sql`${sql.ref(column)} IS NOT NULL`);

const combine = (operator: RawBuilder<unknown>, preds: Pred[]): Pred =>
  preds.length === 1 && preds[0]
    ? preds[0]
    : pred(
        (table) =>
          sql`(${sql.join(
            preds.map((p) => p.sql(table)),
            operator
          )})`
      );

export const or = (...preds: Pred[]): Pred => combine(sql` OR `, preds);
export const and = (...preds: Pred[]): Pred => combine(sql` AND `, preds);

/** A row predicate on table T, typed against the generated schema. */
export type Predicate<T extends Table> = (
  eb: ExpressionBuilder<KyselyDatabase, T>
) => Expression<SqlBool>;

const eb = expressionBuilder<KyselyDatabase, Table>();

/** Any other condition, written with Kysely against table T's real columns. */
export const where = <T extends Table>(predicate: Predicate<T>): Pred =>
  pred(() => sql`${(predicate as Predicate<Table>)(eb)}`);

// ─── Rules ───────────────────────────────────────────────────────────────────

/** One predicate per command. A missing command has no policy, so it is denied. */
export type Commands = {
  select?: Pred;
  insert?: Pred;
  update?: Pred | { using: Pred; check: Pred };
  delete?: Pred;
};

export type Rule<T extends Table = Table> =
  | ({
      kind: "policies";
      /** Policies apply to this role only (default: every role). */
      to?: "authenticated";
      /** Set by `parent()`, so the manifest entry checks it is a column of T. */
      fk?: Column<T>;
      /** Never set. Carries T so a manifest entry types its builder's callbacks. */
      readonly __table?: T;
    } & Commands)
  | { kind: "serviceOnly" }
  | { kind: "custom"; reason: string; sql: (target: string) => string };

// biome-ignore lint/suspicious/noExplicitAny: a rule for some table, read generically
export type AnyRule = Rule<any>;

type CustomRule = Extract<AnyRule, { kind: "custom" }>;

/**
 * Tables outside `public` whose policies the manifest also owns, keyed
 * `<schema>.<table>`. Supabase owns the table itself (and its RLS switch); only
 * the policies are ours.
 */
export type ExternalTable = "realtime.messages";

/**
 * Every public table's rule, each entry's type bound to its own table, plus the
 * external tables' policies.
 */
export type Manifest = { [T in Table]?: Rule<T> } & {
  [T in ExternalTable]?: CustomRule;
};

/** The schema and table a manifest key names: `note` is public, `realtime.messages` is not. */
export const locate = (key: string) => {
  const dot = key.indexOf(".");
  return dot === -1
    ? { schema: "public", table: key }
    : { schema: key.slice(0, dot), table: key.slice(dot + 1) };
};

/** Any shape: one predicate per command, or `all` for every command at once. */
export const policies = <T extends Table>({
  all,
  to,
  ...commands
}: Commands & { all?: Pred; to?: "authenticated" }): Rule<T> => ({
  kind: "policies",
  to,
  select: commands.select ?? all,
  insert: commands.insert ?? all,
  update: commands.update ?? all,
  delete: commands.delete ?? all
});

/** Who may do one action: a set of companies, any predicate, or `false` for denied. */
export type Actor = Who | Pred | false;

type Actors = { read: Actor; create: Actor; update: Actor; delete: Actor };

/** Extra row predicates, ANDed into the write policy's USING clause. */
export type Where<T extends Table> = Partial<
  Record<"insert" | "update" | "delete", Predicate<T>>
>;

const actors = (module: Module, overrides: Partial<Actors>): Actors => ({
  read: "employee",
  create: `${module}_create`,
  update: `${module}_update`,
  delete: `${module}_delete`,
  ...overrides
});

/**
 * Rows owned by a company: any employee reads, each write needs `<module>_<action>`.
 * Override any action with a Who, a predicate, or `false`.
 */
export const company = <T extends Table>(
  module: Module,
  {
    where: extra = {},
    column = "companyId",
    ...overrides
  }: Partial<Actors> & { where?: Where<T>; column?: string } = {}
): Rule<T> => {
  const all = actors(module, overrides);
  const scope = (actor: Actor) =>
    actor === false
      ? undefined
      : isPred(actor)
        ? actor
        : inCompany(column, actor);
  const guarded = (actor: Actor, predicate?: Predicate<T>) => {
    const s = scope(actor);
    return s && predicate ? and(where(predicate), s) : s;
  };
  const update = scope(all.update);
  return {
    kind: "policies",
    select: scope(all.read),
    insert: guarded(all.create, extra.insert),
    // Without a row predicate Postgres checks the new row against USING, which is
    // already the company scope. With one, the new row is checked against the scope
    // alone: it can never move company, and a status transition still passes.
    update:
      update && extra.update
        ? { using: and(where(extra.update), update), check: update }
        : update,
    delete: guarded(all.delete, extra.delete)
  };
};

/** Rows shared by a company group (chart of accounts, currencies, dimensions). */
export const group = <T extends Table>(
  module: Module,
  overrides: Partial<Record<keyof Actors, "employee" | Permission | false>> = {}
): Rule<T> => {
  const all = actors(module, overrides) as Record<
    keyof Actors,
    "employee" | Permission | false
  >;
  const scope = (who: "employee" | Permission | false) =>
    who === false ? undefined : inGroup("companyGroupId", who);
  return {
    kind: "policies",
    select: scope(all.read),
    insert: scope(all.create),
    update: scope(all.update),
    delete: scope(all.delete)
  };
};

// The FK stays a literal type so assigning the rule to its table's manifest entry is
// what checks it: a column that table lacks does not compile, with no table repeated.
export const parent = <const F extends string>(
  table: Table,
  fk: F,
  module: Module,
  options: { read?: Who } = {}
): Extract<AnyRule, { kind: "policies" }> & { fk: F } => ({
  kind: "policies",
  fk,
  select: exists(table, fk, options.read ?? "employee"),
  insert: exists(table, fk, `${module}_create`),
  update: exists(table, fk, `${module}_update`),
  delete: exists(table, fk, `${module}_delete`)
});

export const serviceOnly = <T extends Table>(): Rule<T> => ({
  kind: "serviceOnly"
});

/** `sql` receives the qualified table to target, so it can be rendered anywhere. */
export const custom = <T extends Table>(
  reason: string,
  sql: (target: string) => string
): Rule<T> => ({ kind: "custom", reason, sql });

/** Policies on a table outside `public` (see `ExternalTable`). */
export const external = (
  reason: string,
  sql: (target: string) => string
): CustomRule => ({ kind: "custom", reason, sql });

// ─── Rendering ───────────────────────────────────────────────────────────────

/** Policies cannot take bind parameters, so every value is written inline as a literal. */
class InlineValueCompiler extends PostgresQueryCompiler {
  protected override appendValue(value: unknown): void {
    this.appendImmediateValue(value);
  }
}

// Compiles SQL only; it never connects.
const compiler = new Kysely<KyselyDatabase>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new InlineValueCompiler()
  }
});

const toSql = (node: RawBuilder<unknown>) => node.compile(compiler).sql;

/**
 * The policies for one table, as SQL. `schema` is where to create them: "public"
 * to apply, a scratch schema to let Postgres normalize them for comparison.
 */
export function render(
  rule: AnyRule,
  table: string,
  schema = "public"
): string {
  const target = sql.id(schema, table);
  switch (rule.kind) {
    case "serviceOnly":
      return "";

    case "custom":
      return rule.sql(toSql(sql`${target}`));

    case "policies": {
      const to = rule.to ? sql` TO ${sql.raw(rule.to)}` : sql``;
      const policy = (command: string, clause: RawBuilder<unknown>) =>
        `${toSql(sql`CREATE POLICY ${sql.id(command)} ON ${target} FOR ${sql.raw(command)}${to} ${clause}`)};`;
      const using = (p: Pred) => sql`USING (${p.sql(table)})`;
      const check = (p: Pred) => sql`WITH CHECK (${p.sql(table)})`;
      const { select, insert, update, delete: remove } = rule;
      const outer = rendering;
      rendering = table;
      try {
        return [
          select && policy("SELECT", using(select)),
          insert && policy("INSERT", check(insert)),
          update &&
            policy(
              "UPDATE",
              isPred(update)
                ? using(update)
                : sql`${using(update.using)} ${check(update.check)}`
            ),
          remove && policy("DELETE", using(remove))
        ]
          .filter(Boolean)
          .join("\n");
      } finally {
        rendering = outer;
      }
    }
  }
}
