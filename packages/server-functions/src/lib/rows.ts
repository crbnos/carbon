// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { type RawBuilder, sql } from "kysely";

type Relations = Database["public"]["Tables"] & Database["public"]["Views"];
type RelationName = keyof Relations & string;
type RowOf<T extends RelationName> = Relations[T]["Row"];

/**
 * Matches rows where the column IS NULL, as `.is(column, null)` does. A plain
 * `null` (or `undefined`) value is `.eq(column, null)`, which matches nothing.
 */
export const isNull = Symbol("IS NULL");

/** Equality filters: a value is `=`, an array is `= ANY`, {@link isNull} is `IS NULL`. */
type Where<T extends RelationName> = {
  [K in keyof RowOf<T> & string]?:
    | RowOf<T>[K]
    | NonNullable<RowOf<T>[K]>[]
    | typeof isNull
    | null;
};

/** A child relation nested under each row, as a PostgREST embed would be. */
export type Embed = {
  [property: string]: {
    table: RelationName;
    /** The child's column that holds the parent's `id`. */
    on: string;
    /** Only these columns, as `select("a, b")` would return. Default: all. */
    columns?: readonly string[];
    embed?: Embed;
  };
};

type ReadOptions<T extends RelationName> = {
  /** Only these columns, as `select("a, b")` would return. Default: all. */
  columns?: readonly (keyof RowOf<T> & string)[];
  embed?: Embed;
};

type Column<T extends RelationName> = keyof RowOf<T> & string;
type OrderBy<T extends RelationName> = { orderBy?: Column<T>[] };

/**
 * Rows of a table or view, read over the direct connection but shaped exactly
 * as PostgREST returns them: every row goes through `to_jsonb`, so timestamps
 * are strings at full precision and an embed is an array of such rows.
 *
 * It exists so a server function can stop paying for PostgREST (about 52 ms a
 * call in production against 4.5 ms for a statement) without the values it
 * copies into other rows changing shape — a Kysely row would hand back `Date`s
 * cut to the millisecond. There is no 1000-row cap to page around.
 *
 * Pass `trx` inside a transaction. Throws on failure, as Kysely does.
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
  const conditions = Object.entries(where).map(([column, value]) => {
    const ref = sql.ref(`${alias}.${column}`);
    if (value === isNull) return sql`${ref} IS NULL`;
    // PostgREST's eq never matches a null: keep a missing id from selecting
    // every row whose column happens to be empty.
    if (value === null || value === undefined) return sql`FALSE`;
    if (Array.isArray(value)) return sql`${ref} = ANY(${value})`;
    return sql`${ref} = ${value}`;
  });
  const order = (options.orderBy ?? []).map((column) =>
    sql.ref(`${alias}.${column}`)
  );
  const { rows } = await sql<{ row: unknown }>`
    SELECT ${rowExpression(alias, options.columns, options.embed, 1)} AS row
    FROM ${sql.table(table)} AS ${sql.ref(alias)}
    ${conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``}
    ${order.length > 0 ? sql`ORDER BY ${sql.join(order)}` : sql``}
  `.execute(db);
  return rows.map((r) => r.row);
}

/** The first row, or undefined. For a lookup by key. */
export async function selectRow<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: ReadOptions<T> = {}
): Promise<R | undefined> {
  const rows = await selectRows<T, R>(db, table, where, options);
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
  const properties = children.map(
    ([property, spec]) => sql`${sql.lit(property)}, (
      SELECT coalesce(jsonb_agg(${rowExpression(child, spec.columns, spec.embed, depth + 1)}), '[]'::jsonb)
      FROM ${sql.table(spec.table)} AS ${sql.ref(child)}
      WHERE ${sql.ref(`${child}.${spec.on}`)} = ${sql.ref(`${alias}.id`)}
    )`
  );
  return sql`${row} || jsonb_build_object(${sql.join(properties)})`;
}

type Result<R> = { data: R; error: null } | { data: null; error: Error };

/**
 * The same read with PostgREST's `.single()` contract, for code written
 * against `{ data, error }`: exactly one row, otherwise an error and no data.
 */
export function single<T extends RelationName, const C extends Column<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: { columns: readonly C[] }
): Promise<Result<Pick<RowOf<T>, C>>>;
export function single<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options?: ReadOptions<T>
): Promise<Result<R>>;
export async function single<T extends RelationName>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: ReadOptions<T> = {}
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
  options: { columns: readonly C[] }
): Promise<{ data: Pick<RowOf<T>, C> | null; error: Error | null }>;
export function maybeSingle<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options?: ReadOptions<T>
): Promise<{ data: R | null; error: Error | null }>;
export async function maybeSingle<T extends RelationName>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: ReadOptions<T> = {}
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

/**
 * A list read in the `{ data, error }` shape. A failure throws instead, so
 * `error` is always null; it is typed as PostgREST's so existing checks compile.
 */
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

/**
 * `Promise.all` for reads, run one after another. A statement takes a few
 * milliseconds, so running a handful at once saves almost nothing, while each
 * one started at once takes its own connection from the process's pool of
 * sixteen — and opens one when the pool has none idle, which costs more than
 * the reads do.
 */
export async function inOrder<const T extends readonly (() => unknown)[]>(
  reads: T
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const read of reads) results.push(await read());
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
