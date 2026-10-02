// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { type RawBuilder, sql } from "kysely";

type Relations = Database["public"]["Tables"] & Database["public"]["Views"];
type RelationName = keyof Relations & string;
type RowOf<T extends RelationName> = Relations[T]["Row"];

/** Equality filters: a value is `=`, an array is `= ANY`, null is `IS NULL`. */
type Where<T extends RelationName> = {
  [K in keyof RowOf<T> & string]?:
    | RowOf<T>[K]
    | NonNullable<RowOf<T>[K]>[]
    | null;
};

/** A child relation nested under each row, as a PostgREST embed would be. */
export type Embed = {
  [property: string]: {
    table: RelationName;
    /** The child's column that holds the parent's `id`. */
    on: string;
    embed?: Embed;
  };
};

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
export async function selectRows<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: { embed?: Embed; orderBy?: (keyof RowOf<T> & string)[] } = {}
): Promise<R[]> {
  const alias = "t0";
  const conditions = Object.entries(where).map(([column, value]) => {
    const ref = sql.ref(`${alias}.${column}`);
    if (value === null) return sql`${ref} IS NULL`;
    if (Array.isArray(value)) return sql`${ref} = ANY(${value})`;
    return sql`${ref} = ${value}`;
  });
  const order = (options.orderBy ?? []).map((column) =>
    sql.ref(`${alias}.${column}`)
  );
  const { rows } = await sql<{ row: R }>`
    SELECT ${rowExpression(alias, options.embed, 1)} AS row
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
  options: { embed?: Embed } = {}
): Promise<R | undefined> {
  const rows = await selectRows<T, R>(db, table, where, options);
  return rows[0];
}

function rowExpression(
  alias: string,
  embed: Embed | undefined,
  depth: number
): RawBuilder<unknown> {
  const row = sql`to_jsonb(${sql.ref(alias)})`;
  const children = Object.entries(embed ?? {});
  if (children.length === 0) return row;
  const child = `t${depth}`;
  const properties = children.map(
    ([property, spec]) => sql`${sql.lit(property)}, (
      SELECT coalesce(jsonb_agg(${rowExpression(child, spec.embed, depth + 1)}), '[]'::jsonb)
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
export async function single<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: { embed?: Embed } = {}
): Promise<Result<R>> {
  const rows = await selectRows<T, R>(db, table, where, options);
  const row = rows[0];
  return rows.length === 1 && row !== undefined
    ? { data: row, error: null }
    : {
        data: null,
        error: new Error(`Expected one ${table} row, found ${rows.length}`)
      };
}

/** `.maybeSingle()`: no row is `data: null` without an error; two is an error. */
export async function maybeSingle<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: { embed?: Embed } = {}
): Promise<{ data: R | null; error: Error | null }> {
  const rows = await selectRows<T, R>(db, table, where, options);
  return rows.length > 1
    ? {
        data: null,
        error: new Error(
          `Expected at most one ${table} row, found ${rows.length}`
        )
      }
    : { data: rows[0] ?? null, error: null };
}

/** A list read in the `{ data, error }` shape. A failure throws instead. */
export async function many<T extends RelationName, R = RowOf<T>>(
  db: Kysely<KyselyDatabase>,
  table: T,
  where: Where<T>,
  options: { embed?: Embed; orderBy?: (keyof RowOf<T> & string)[] } = {}
): Promise<{ data: R[]; error: null }> {
  return {
    data: await selectRows<T, R>(db, table, where, options),
    error: null
  };
}
