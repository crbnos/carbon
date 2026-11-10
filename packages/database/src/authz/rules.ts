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
import { ACTIONS, type Action } from "../access/levels";
import {
  type ModuleId,
  moduleOf,
  PAGES,
  type Page,
  type PermissionKey,
  placeOf,
  readersOf,
  type TablePlace
} from "../access/registry";
import type { KyselyDatabase } from "../client";
import type { Database } from "../types";

type Public = Database["public"];

export type Table = keyof Public["Tables"] & keyof KyselyDatabase;
type Column<T extends Table> = keyof Public["Tables"][T]["Row"] & string;
/**
 * A page key (`purchasing.suppliers_create`), written as is, or a bare action
 * (`"update"`): the key of the page that owns the table the rule is on. A read
 * admits View on any page of that page's module, and the pages that list the
 * table in `readers`; a write needs the owning page, or a page that lists the
 * table in `alsoWrittenBy`.
 */
export type Permission = Action | PermissionKey;
/** A portal account's own key in `userPermission` (`sales_view`): another namespace than pages. */
export type PortalKey = `${Lowercase<Public["Enums"]["module"]>}_${Action}`;

// ─── Who: the companies a caller belongs to ──────────────────────────────────

/**
 * - `"employee"`: get_companies_with_employee_role() — any employee of the company, and
 *   any API key of it regardless of the key's scopes.
 * - `"member"`: get_companies_with_any_role() — employees, customers and suppliers.
 * - a Permission: scope-checked for API keys.
 * - `anyOf(...)`: holds at least one of the permissions, or View on any page of `modules`.
 */
export type Who =
  | "employee"
  | "member"
  | Permission
  | { anyOf: readonly Permission[]; modules?: readonly ModuleId[] };

export const anyOf = (...permissions: Permission[]): Who => ({
  anyOf: permissions
});

/** View on any page of the modules, whichever table the rule is on. */
export const anyPageOf = (...modules: ModuleId[]): Who => ({
  anyOf: [],
  modules
});

// ─── Predicates ──────────────────────────────────────────────────────────────

/**
 * The row a predicate is about: `table` is its table in the registry, `ref` the
 * name SQL gives it there (the table, or `p` inside an `exists`).
 */
export type Row = { table: string; ref: string };

/** A policy expression, compiled against the row it guards. */
export type Pred = { readonly sql: (row: Row) => RawBuilder<unknown> };

const pred = (build: (row: Row) => RawBuilder<unknown>): Pred => ({
  sql: build
});

const isPred = (value: unknown): value is Pred =>
  typeof value === "object" && value !== null && "sql" in value;

const isAction = (permission: string): permission is Action =>
  (ACTIONS as readonly string[]).includes(permission);

let writers: Map<string, string[]> | undefined;

/** The pages that list the table in `alsoWrittenBy`, after the page that owns it. */
const writersOf = (table: string): readonly string[] => {
  if (!writers) {
    writers = new Map();
    for (const page of PAGES as readonly Page[])
      for (const [owned, pages] of Object.entries(page.alsoWrittenBy ?? {}))
        writers.set(owned, [
          ...new Set([...(writers.get(owned) ?? []), ...pages])
        ]);
  }
  return writers.get(table) ?? [];
};

/** `subject` is one of the companies where the caller holds `key`. */
const holds = (subject: RawBuilder<unknown>, key: string) =>
  sql`${subject} = ANY ((SELECT get_companies_with_employee_permission(${sql.lit(key)}))::text[])`;

const textArray = (items: readonly string[]) =>
  items.length
    ? sql`ARRAY[${sql.join(items.map((item) => sql.lit(item)))}]::text[]`
    : sql`'{}'::text[]`;

/**
 * `subject` is one of the companies where the caller holds any of `keys`, or
 * View on any page of `modules`. One call for the whole list. The module's
 * pages are resolved in SQL (util.module_pages), so a policy never lists them
 * and a new page changes no policy.
 */
const holdsAny = (
  subject: RawBuilder<unknown>,
  keys: readonly string[],
  modules: readonly string[] = []
) =>
  modules.length
    ? sql`${subject} = ANY ((SELECT get_companies_with_module_view(${textArray(modules)}, ${textArray(keys)}))::text[])`
    : keys.length === 1
      ? holds(subject, keys[0] as string)
      : sql`${subject} = ANY ((SELECT get_companies_with_any_employee_permission(${textArray(keys)}))::text[])`;

const either = (terms: RawBuilder<unknown>[]) =>
  terms.length === 1 && terms[0]
    ? terms[0]
    : sql`(${sql.join(terms, sql` OR `)})`;

/** What admits `action` on what `page` owns: View on any page of its module, or the page's key. */
const admits = (
  page: string,
  action: Action
): { keys: string[]; modules: string[] } =>
  action === "view"
    ? { keys: [], modules: [moduleOf(page)] }
    : { keys: [`${page}_${action}`], modules: [] };

/**
 * A shared table's rows, one branch per page: the page's rows and the page's
 * key. A child table reaches its parent row through its path, one `EXISTS`
 * per hop, and checks the parent's branches. Every hop is in the company of
 * the hop before it; the first is in `company`, the row's own company.
 */
const branches = (
  subject: RawBuilder<unknown>,
  company: RawBuilder<unknown>,
  row: Row,
  place: Exclude<TablePlace, { kind: "page" }>,
  action: Action
) => {
  const owner = place.kind === "child" ? place.parent : row.ref;
  const arms = either(
    place.branches.map((branch) => {
      const column = sql.ref(`${owner}.${branch.column}`);
      const admit = admits(branch.page, action);
      return sql`(${
        branch.value === undefined
          ? sql`${column} IS NOT NULL`
          : sql`${column} = ${sql.lit(branch.value)}`
      } AND ${holdsAny(subject, admit.keys, admit.modules)})`;
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
  return hop(0, row.ref, company);
};

/**
 * `subject` is one of the caller's companies (or, for anyOf, satisfies any of
 * them). A bare action checks the page that owns `row.table`: a view admits
 * View on any page of that page's module (a child's: its parent's), and every
 * page that lists the table in `readers`; a write needs the page, or one that
 * lists the table in `alsoWrittenBy`. `company` is the row's own company, for
 * a child's first hop: the row's `companyId` unless the rule says otherwise.
 */
const belongsTo = (
  subject: RawBuilder<unknown>,
  who: Who,
  row: Row,
  company?: RawBuilder<unknown>
): RawBuilder<unknown> => {
  if (who === "employee")
    return sql`${subject} = ANY ((SELECT get_companies_with_employee_role())::text[])`;
  if (who === "member")
    return sql`${subject} = ANY ((SELECT get_companies_with_any_role())::text[])`;
  // Plain keys and module views go into one `holdsAny` call; branch checks
  // stay their own terms.
  const keys = new Set<string>();
  const modules = new Set<string>(typeof who === "object" ? who.modules : []);
  const terms = new Map<string, RawBuilder<unknown>>();
  for (const permission of typeof who === "object" ? who.anyOf : [who]) {
    if (!isAction(permission)) {
      keys.add(permission);
      continue;
    }
    const action = permission;
    const place = placeOf(row.table);
    if (!place)
      throw new Error(
        `authz: a rule on ${row.table} names the owner's ${action}, but no page owns ${row.table}; name a page key`
      );
    const admit = (page: string) => {
      const a = admits(page, action);
      for (const k of a.keys) keys.add(k);
      for (const m of a.modules) modules.add(m);
    };
    if (place.kind === "page") admit(place.page);
    // A child's read never goes through its parent: the parent's SELECT reads
    // its children (item's portal branches read supplierPart), so a lookup
    // back would make Postgres refuse both tables as recursive. It admits View
    // on any page of its parent's module.
    else if (place.kind === "child" && action === "view")
      for (const { page } of place.branches) admit(page);
    else if (!terms.has(action))
      terms.set(
        action,
        branches(
          subject,
          company ?? sql.ref(`${row.ref}.companyId`),
          row,
          place,
          action
        )
      );
    for (const page of action === "view"
      ? readersOf(row.table)
      : writersOf(row.table))
      keys.add(`${page}_${action}`);
  }
  return either(
    keys.size || modules.size
      ? [holdsAny(subject, [...keys], [...modules]), ...terms.values()]
      : [...terms.values()]
  );
};

/** The row's own company column is one of the caller's companies. */
export const inCompany = (column: string, who: Who): Pred =>
  pred((row) => belongsTo(sql.ref(column), who, row));

/** The row's company group is one the caller belongs to (group-shared tables). */
export const inGroup = (column: string, who: "employee" | Permission): Pred =>
  pred(
    (row) =>
      sql`${sql.ref(column)} = ANY ((SELECT ${
        who === "employee"
          ? sql`get_company_groups_for_employee()`
          : sql`get_company_groups_for_root_permission(${sql.lit(groupKey(who, row.table))})`
      })::text[])`
  );

// A group helper takes one key: a group table sits on one page, with no
// readers, so the owner's action is that page's key.
const groupKey = (permission: Permission, table: string) => {
  if (!isAction(permission)) return permission;
  const place = placeOf(table);
  if (
    place?.kind !== "page" ||
    (permission === "view" && readersOf(table).length) ||
    writersOf(table).length
  )
    throw new Error(`authz: group table ${table} needs one page`);
  return `${place.page}_${permission}`;
};

/**
 * The company of the parent row `fk` points at, resolved by
 * get_company_id_from_foreign_key. The parent row is not in the query, so a
 * bare action is the guarded table's.
 */
export const viaParent = (fk: string, parentTable: Table, who: Who): Pred =>
  pred((row) =>
    belongsTo(
      sql`get_company_id_from_foreign_key(${sql.ref(fk)}, ${sql.lit(parentTable)})`,
      who,
      row
    )
  );

/**
 * The parent row `fk` points at exists and satisfies `condition`: a Who (the parent's
 * company is one of the caller's, a bare action the parent table's) or any predicate,
 * whose bare columns are the parent's. `sameCompany` also requires the parent to be in
 * the row's own company.
 */
export const exists = (
  parentTable: Table,
  fk: string,
  condition: Who | Pred,
  { sameCompany = false }: { sameCompany?: boolean } = {}
): Pred =>
  pred((row) => {
    const parentRow: Row = { table: parentTable, ref: "p" };
    const parts = [sql`${sql.ref("p.id")} = ${sql.ref(`${row.ref}.${fk}`)}`];
    if (sameCompany) {
      parts.push(
        sql`${sql.ref("p.companyId")} = ${sql.ref(`${row.ref}.companyId`)}`
      );
    }
    parts.push(
      isPred(condition)
        ? condition.sql(parentRow)
        : belongsTo(sql.ref("p.companyId"), condition, parentRow)
    );
    return sql`EXISTS (SELECT 1 FROM ${sql.id("public", parentTable)} p WHERE ${sql.join(parts, sql` AND `)})`;
  });

/**
 * The rule that governs a project row: the owner's `action` (or `standard`, for a read
 * open to any employee) in the project's company. `column` names the row's project; on
 * `project` itself the row's own company decides (`column` is "id"), so the policy never
 * queries the table it guards. With `via: "projectElement"`, `column` names an element
 * and its project decides. The project (and element) must be in the row's own company.
 */
export const projectModule = (
  column: string,
  action: Action,
  { standard = action, via }: { standard?: Who; via?: "projectElement" } = {}
): Pred =>
  pred((row) => {
    const governs = (alias: string | null) =>
      belongsTo(
        sql.ref(alias ? `${alias}.companyId` : "companyId"),
        standard,
        row
      );
    if (row.table === "project") return governs(null);
    const own = (name: string) => sql.ref(`${row.ref}.${name}`);
    if (via === "projectElement") {
      return sql`EXISTS (SELECT 1 FROM ${sql.id("public", "projectElement")} e JOIN ${sql.id("public", "project")} p ON ${sql.ref("p.id")} = ${sql.ref("e.projectId")} AND ${sql.ref("p.companyId")} = ${sql.ref("e.companyId")} WHERE ${sql.ref("e.id")} = ${own(column)} AND ${sql.ref("e.companyId")} = ${own("companyId")} AND ${governs("p")})`;
    }
    return sql`EXISTS (SELECT 1 FROM ${sql.id("public", "project")} p WHERE ${sql.ref("p.id")} = ${own(column)} AND ${sql.ref("p.companyId")} = ${own("companyId")} AND ${governs("p")})`;
  });

/**
 * `local` is reachable through a link table: it is one of `linkTable.linkColumn` over the
 * link rows satisfying `condition`, whose bare columns (and bare actions) are the link
 * table's.
 */
export const through = (
  local: string,
  linkTable: Table,
  linkColumn: string,
  condition: Pred
): Pred =>
  pred(
    () =>
      sql`${sql.ref(local)} IN (SELECT ${sql.ref(`${linkTable}.${linkColumn}`)} FROM ${sql.id("public", linkTable)} WHERE ${condition.sql({ table: linkTable, ref: linkTable })})`
  );

/**
 * `through` in a form an index can serve inside an `or(...)`. `IN (SELECT …)` compiles
 * to a hashed SubPlan, which is no index path, and a BitmapOr needs one in every branch,
 * so one such branch turns the whole policy into a filter over a scan. The uncorrelated
 * `array_agg` runs once per query and `= ANY (array)` can use the local column's index.
 * Use it only where the link rows `condition` matches are few (portal branches): the
 * array holds all of them. COALESCE keeps "no link rows" false-y rather than NULL.
 */
export const throughIndexed = (
  local: string,
  linkTable: Table,
  linkColumn: string,
  condition: Pred
): Pred =>
  pred(
    () =>
      sql`${sql.ref(local)} = ANY (COALESCE((SELECT array_agg(${sql.ref(`${linkTable}.${linkColumn}`)}) FROM ${sql.id("public", linkTable)} WHERE ${condition.sql({ table: linkTable, ref: linkTable })}), '{}'))`
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
  customer: (column: string, permission: PortalKey): Pred =>
    pred(
      () =>
        sql`${sql.ref(column)} = ANY ((SELECT get_customer_ids_with_customer_permission(${sql.lit(permission)}))::text[])`
    ),
  supplier: (column: string, permission: PortalKey): Pred =>
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
        (row) =>
          sql`(${sql.join(
            preds.map((p) => p.sql(row)),
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

const actors = (overrides: Partial<Actors>): Actors => ({
  read: "view",
  create: "create",
  update: "update",
  delete: "delete",
  ...overrides
});

/**
 * Rows owned by a company: each action needs the owning page's (see `Permission`).
 * Override any action with a Who, a predicate, or `false`.
 */
export const company = <T extends Table>({
  where: extra = {},
  column = "companyId",
  ...overrides
}: Partial<Actors> & { where?: Where<T>; column?: string } = {}): Rule<T> => {
  const all = actors(overrides);
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
  overrides: Partial<Record<keyof Actors, "employee" | Permission | false>> = {}
): Rule<T> => {
  const all = actors(overrides) as Record<
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
// Each action is the parent table's.
export const parent = <const F extends string>(
  table: Table,
  fk: F,
  options: { read?: Who } = {}
): Extract<AnyRule, { kind: "policies" }> & { fk: F } => ({
  kind: "policies",
  fk,
  select: exists(table, fk, options.read ?? "employee"),
  insert: exists(table, fk, "create"),
  update: exists(table, fk, "update"),
  delete: exists(table, fk, "delete")
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
      const row: Row = { table, ref: table };
      const using = (p: Pred) => sql`USING (${p.sql(row)})`;
      const check = (p: Pred) => sql`WITH CHECK (${p.sql(row)})`;
      const { select, insert, update, delete: remove } = rule;
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
    }
  }
}
