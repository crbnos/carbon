// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type RawBuilder, sql } from "kysely";
import type { Kysely, KyselyDatabase } from "./client.ts";
import type { Database } from "./types.ts";

type Relations = Database["public"]["Tables"] & Database["public"]["Views"];
type RelationName = keyof Relations & string;
type RowOf<T extends RelationName> = Relations[T]["Row"];

/**
 * Matches rows where the column IS NULL, as `.is(column, null)` does. A plain
 * `null` (or `undefined`) value is `.eq(column, null)`, which matches nothing.
 */
export const isNull = Symbol("IS NULL");

type Operator =
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "@>"
  | "IS NOT NULL"
  | "NOT IN";

/** A comparison other than equality. A class, so a jsonb VALUE shaped like
 *  `{ op, value }` stays a value and never becomes SQL. */
class Comparison {
  constructor(
    readonly op: Operator,
    readonly value?: unknown
  ) {}
}
export const neq = (value: unknown) => new Comparison("<>", value);
export const lt = (value: unknown) => new Comparison("<", value);
export const lte = (value: unknown) => new Comparison("<=", value);
export const gt = (value: unknown) => new Comparison(">", value);
export const gte = (value: unknown) => new Comparison(">=", value);
/** `.contains(column, value)` on a jsonb column: the form its GIN index serves. */
export const contains = (value: unknown) => new Comparison("@>", value);
/**
 * `.not(column, "in", values)`. A null column matches no non-empty list; an
 * empty list matches every row, as PostgREST's does.
 */
export const notIn = (values: readonly unknown[]) =>
  new Comparison("NOT IN", values);
/** `.not(column, "is", null)`. */
export const notNull = new Comparison("IS NOT NULL");

type Where<T extends RelationName> = {
  [K in keyof RowOf<T> & string]?:
    | RowOf<T>[K]
    | NonNullable<RowOf<T>[K]>[]
    | typeof isNull
    | Comparison
    | null;
};

/** A PostgREST-style embed: `on` is the related table's column holding this
 *  row's id (array), `via` is this row's column holding the related id (row). */
export type Embed = {
  [property: string]: {
    table: RelationName;
    columns?: readonly string[];
    embed?: Embed;
  } & ({ on: string; via?: never } | { via: string; on?: never });
};

type ReadOptions<T extends RelationName> = {
  columns?: readonly (keyof RowOf<T> & string)[];
  embed?: Embed;
};

type Column<T extends RelationName> = keyof RowOf<T> & string;
type OrderBy<T extends RelationName> = {
  /** Ascending, or `{ desc: column }`. */
  orderBy?: (Column<T> | { desc: Column<T> })[];
  limit?: number;
};

/**
 * Rows read over the direct connection, shaped as PostgREST returns them
 * (`to_jsonb`: timestamps are full-precision strings, embeds are arrays), so
 * values copied into other rows keep their shape. Throws on failure.
 */
export function selectRows<T extends RelationName, const C extends Column<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: { columns: readonly C[] } & OrderBy<T>
): Promise<Pick<RowOf<T>, C>[]>;
export function selectRows<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options?: ReadOptions<T> & OrderBy<T>
): Promise<R[]>;
export async function selectRows<T extends RelationName>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: ReadOptions<T> & OrderBy<T> = {}
): Promise<unknown[]> {
  const alias = "t0";
  const conditions = conditionsFor(alias, where);
  const order = (options.orderBy ?? []).map((column) =>
    typeof column === "string"
      ? sql.ref(`${alias}.${column}`)
      : sql`${sql.ref(`${alias}.${column.desc}`)} DESC`
  );
  const { rows } = await sql<{ row: unknown }>`
    SELECT ${rowExpression(alias, options.columns, options.embed, 1)} AS row
    FROM ${sql.table(table)} AS ${sql.ref(alias)}
    ${conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``}
    ${order.length > 0 ? sql`ORDER BY ${sql.join(order)}` : sql``}
    ${options.limit === undefined ? sql`` : sql`LIMIT ${options.limit}`}
  `.execute(db);
  return rows.map((r) => r.row);
}

export async function selectRow<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: ReadOptions<T> = {}
): Promise<R | undefined> {
  const rows = await selectRows<T, R>(db, table, where, {
    limit: 1,
    ...options
  });
  return rows[0];
}

function rowExpression(
  alias: string,
  columns: readonly string[] | undefined,
  embed: Embed | undefined,
  depth: number
): RawBuilder<unknown> {
  // A column list is projected in a subquery: jsonb_build_object would cap it
  // at fifty columns.
  const row = columns
    ? sql`(SELECT to_jsonb(c) FROM (SELECT ${sql.join(
        columns.map((column) => sql.ref(`${alias}.${column}`))
      )}) AS c)`
    : sql`to_jsonb(${sql.ref(alias)})`;
  const children = Object.entries(embed ?? {});
  if (children.length === 0) return row;
  const child = `t${depth}`;
  const properties = children.map(([property, spec]) => {
    const related = rowExpression(child, spec.columns, spec.embed, depth + 1);
    const from = sql`FROM ${sql.table(spec.table)} AS ${sql.ref(child)}`;
    return spec.via === undefined
      ? sql`${sql.lit(property)}, (
          SELECT coalesce(jsonb_agg(${related}), '[]'::jsonb) ${from}
          WHERE ${sql.ref(`${child}.${spec.on}`)} = ${sql.ref(`${alias}.id`)}
        )`
      : sql`${sql.lit(property)}, (
          SELECT ${related} ${from}
          WHERE ${sql.ref(`${child}.id`)} = ${sql.ref(`${alias}.${spec.via}`)}
        )`;
  });
  return sql`${row} || jsonb_build_object(${sql.join(properties)})`;
}

function conditionsFor(alias: string, where: Record<string, unknown>) {
  return Object.entries(where).map(([column, value]) => {
    const ref = sql.ref(`${alias}.${column}`);
    if (value === isNull) return sql`${ref} IS NULL`;
    // PostgREST's eq never matches a null: keep a missing id from selecting
    // every row whose column happens to be empty.
    if (value === null || value === undefined) return sql`FALSE`;
    if (Array.isArray(value)) return sql`${ref} = ANY(${value})`;
    if (value instanceof Comparison) {
      switch (value.op) {
        case "IS NOT NULL":
          return sql`${ref} IS NOT NULL`;
        case "NOT IN":
          return sql`NOT (${ref} = ANY(${value.value}))`;
        case "@>":
          return sql`${ref} @> ${JSON.stringify(value.value)}::jsonb`;
        case "<>":
          return sql`${ref} <> ${value.value}`;
        case "<":
          return sql`${ref} < ${value.value}`;
        case "<=":
          return sql`${ref} <= ${value.value}`;
        case ">":
          return sql`${ref} > ${value.value}`;
        case ">=":
          return sql`${ref} >= ${value.value}`;
      }
    }
    return sql`${ref} = ${value}`;
  });
}

type Functions = Database["public"]["Functions"];

export async function rpcRows<F extends keyof Functions & string>(
  db: Kysely<KyselyDatabase>,
  fn: F,
  args: Functions[F]["Args"]
): Promise<{
  data: Extract<Functions[F]["Returns"], unknown[]>;
  error: Error | null;
}> {
  const named = Object.entries(args as Record<string, unknown>).map(
    ([name, value]) => sql`${sql.ref(name)} => ${value}`
  );
  const { rows } = await sql<{ row: unknown }>`
    SELECT to_jsonb(r) AS row FROM ${sql.ref(fn)}(${sql.join(named)}) AS r
  `.execute(db);
  return {
    data: rows.map((r) => r.row) as Extract<Functions[F]["Returns"], unknown[]>,
    error: null
  };
}

export async function rpcValue<F extends keyof Functions & string>(
  db: Kysely<KyselyDatabase>,
  fn: F,
  args: Functions[F]["Args"]
): Promise<{ data: Functions[F]["Returns"] | null; error: Error | null }> {
  const named = Object.entries(args as Record<string, unknown>).map(
    ([name, value]) => sql`${sql.ref(name)} => ${value}`
  );
  const { rows } = await sql<{ row: Functions[F]["Returns"] }>`
    SELECT to_jsonb(r) AS row FROM ${sql.ref(fn)}(${sql.join(named)}) AS r
  `.execute(db);
  return { data: rows[0]?.row ?? null, error: null };
}

type TableName = keyof Database["public"]["Tables"] & string;
type Written = { error: Error | null };

/** The keys a JSON body would carry: `undefined` is dropped, `null` is kept. */
function definedKeys(row: Record<string, unknown>): string[] {
  return Object.keys(row).filter((key) => row[key] !== undefined);
}

/** Rows go in as one JSON document cast by Postgres, as PostgREST does: a
 *  jsonb array stays an array, and a key one row lacks is NULL for it. */
export async function insertRows<T extends TableName>(
  db: Kysely<KyselyDatabase>,
  table: T,
  rows:
    | Database["public"]["Tables"][T]["Insert"]
    | Database["public"]["Tables"][T]["Insert"][]
): Promise<Written & { data: Database["public"]["Tables"][T]["Row"][] }> {
  const list = (Array.isArray(rows) ? rows : [rows]) as Record<
    string,
    unknown
  >[];
  const columns = [...new Set(list.flatMap(definedKeys))];
  if (list.length === 0 || columns.length === 0) {
    return { data: [], error: null };
  }
  const refs = sql.join(columns.map((column) => sql.ref(column)));
  const result = await sql<{ row: Database["public"]["Tables"][T]["Row"] }>`
    INSERT INTO ${sql.table(table)} AS t0 (${refs})
    SELECT ${refs}
    FROM jsonb_populate_recordset(null::${sql.table(table)}, ${JSON.stringify(list)}::jsonb)
    RETURNING to_jsonb(t0) AS row
  `.execute(db);
  return { data: result.rows.map((r) => r.row), error: null };
}

export async function updateRows<T extends TableName>(
  db: Kysely<KyselyDatabase>,
  table: T,
  set: Database["public"]["Tables"][T]["Update"],
  where: Where<T>
): Promise<Written> {
  const columns = definedKeys(set as Record<string, unknown>);
  const conditions = conditionsFor("t0", where);
  if (columns.length === 0) return { error: null };
  if (conditions.length === 0) {
    throw new Error(`updateRows on ${table} needs a filter`);
  }
  await sql`
    UPDATE ${sql.table(table)} AS t0
    SET ${sql.join(columns.map((column) => sql`${sql.ref(column)} = r.${sql.ref(column)}`))}
    FROM jsonb_populate_record(null::${sql.table(table)}, ${JSON.stringify(set)}::jsonb) AS r
    WHERE ${sql.join(conditions, sql` AND `)}
  `.execute(db);
  return { error: null };
}

export async function deleteRows<T extends TableName>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>
): Promise<Written> {
  const conditions = conditionsFor("t0", where);
  if (conditions.length === 0) {
    throw new Error(`deleteRows on ${table} needs a filter`);
  }
  await sql`
    DELETE FROM ${sql.table(table)} AS t0
    WHERE ${sql.join(conditions, sql` AND `)}
  `.execute(db);
  return { error: null };
}

type Result<R> = { data: R; error: null } | { data: null; error: Error };

/** PostgREST's `.single()`: exactly one row, otherwise an error and no data. */
export function single<T extends RelationName, const C extends Column<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: { columns: readonly C[] } & OrderBy<T>
): Promise<Result<Pick<RowOf<T>, C>>>;
export function single<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options?: ReadOptions<T> & OrderBy<T>
): Promise<Result<R>>;
export async function single<T extends RelationName>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: ReadOptions<T> & OrderBy<T> = {}
): Promise<Result<unknown>> {
  const rows = await selectRows<T, unknown>(db, table, where, options);
  return rows.length === 1
    ? { data: rows[0], error: null }
    : {
        data: null,
        error: new Error(`Expected one ${table} row, found ${rows.length}`)
      };
}

/** `.maybeSingle()`: no row is `data: null` without an error; two is an error. */
export function maybeSingle<T extends RelationName, const C extends Column<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: { columns: readonly C[] } & OrderBy<T>
): Promise<{ data: Pick<RowOf<T>, C> | null; error: Error | null }>;
export function maybeSingle<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options?: ReadOptions<T> & OrderBy<T>
): Promise<{ data: R | null; error: Error | null }>;
export async function maybeSingle<T extends RelationName>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: ReadOptions<T> & OrderBy<T> = {}
): Promise<{ data: unknown; error: Error | null }> {
  const rows = await selectRows<T, unknown>(db, table, where, options);
  return rows.length > 1
    ? {
        data: null,
        error: new Error(
          `Expected at most one ${table} row, found ${rows.length}`
        )
      }
    : { data: rows[0] ?? null, error: null };
}

/** `error` is always null (a failure throws); typed so existing checks compile. */
export function many<T extends RelationName, const C extends Column<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: { columns: readonly C[] } & OrderBy<T>
): Promise<{ data: Pick<RowOf<T>, C>[]; error: Error | null }>;
export function many<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options?: ReadOptions<T> & OrderBy<T>
): Promise<{ data: R[]; error: Error | null }>;
export async function many<T extends RelationName>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: ReadOptions<T> & OrderBy<T> = {}
): Promise<{ data: unknown[]; error: Error | null }> {
  return {
    data: await selectRows<T, unknown>(db, table, where, options),
    error: null
  };
}

export type Tables = Database["public"]["Tables"];
export type Views = Database["public"]["Views"];

/** `Promise.all` for reads, one after another: each concurrent read would
 *  take its own connection from the pool and save almost nothing. */
export async function inOrder<const T extends readonly (() => unknown)[]>(
  reads: T
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const read of reads) results.push(await read());
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
