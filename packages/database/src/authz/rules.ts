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
import type { KyselyDatabase } from "../client";
import type { Database } from "../types";

type Public = Database["public"];

export type Table = keyof Public["Tables"] & keyof KyselyDatabase;
type Column<T extends Table> = keyof Public["Tables"][T]["Row"] & string;
export type Module = Lowercase<Public["Enums"]["module"]>;
export type Permission = `${Module}_${"view" | "create" | "update" | "delete"}`;

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

const companySet = (who: Exclude<Who, { anyOf: Permission[] }>) => {
  if (who === "employee") return sql`get_companies_with_employee_role()`;
  if (who === "member") return sql`get_companies_with_any_role()`;
  return sql`get_companies_with_employee_permission(${sql.lit(who)})`;
};

/** `subject` is one of the caller's companies (or, for anyOf, satisfies any of them). */
const belongsTo = (
  subject: RawBuilder<unknown>,
  who: Who
): RawBuilder<unknown> =>
  typeof who === "object" && "anyOf" in who
    ? sql`(${sql.join(
        who.anyOf.map((p) => belongsTo(subject, p)),
        sql` OR `
      )})`
    : sql`${subject} = ANY ((SELECT ${companySet(who)})::text[])`;

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
          : sql`get_company_groups_for_root_permission(${sql.lit(who)})`
      })::text[])`
  );

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
        : belongsTo(sql.ref("p.companyId"), condition)
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

/** Every public table's rule. Each entry's type is bound to its own table. */
export type Manifest = { [T in Table]?: Rule<T> };

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
