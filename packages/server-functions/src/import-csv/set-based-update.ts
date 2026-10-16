// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Updates many rows of one table with one UPDATE … FROM (VALUES …) per chunk,
// instead of one UPDATE per row. Each row sets its own columns: per column it
// carries the value and whether to write it, so a column the row does not set
// keeps its stored value.

import type { KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { type Kysely, sql } from "kysely";
import { inChunks } from "./chunks";

/** A column and the SQL type its VALUES cell is cast to. */
export type ColumnType = {
  name: string;
  type: "text" | "integer" | "numeric" | "boolean" | `"${string}"`;
};

export type KeyedUpdate = {
  /** The key columns' values, which name the row to update. */
  key: Record<string, string>;
  /** The columns to write, with their values; a null clears the column. */
  set: Record<string, unknown>;
};

/**
 * Updates `rows` of `table`, one statement per chunk and scoped by company.
 * Each row names itself by `keys` and writes only the columns in its `set`.
 */
export async function updateRowsByKey(
  trx: Kysely<KyselyDatabase>,
  args: {
    table: keyof KyselyDatabase & string;
    companyId: string;
    userId: string;
    keys: ColumnType[];
    columns: ColumnType[];
    rows: KeyedUpdate[];
  }
): Promise<void> {
  const { table, companyId, userId, keys, columns, rows } = args;
  if (rows.length === 0) return;
  const now = datetime.timestamp();
  const cast = (value: unknown, type: ColumnType["type"]) =>
    sql`${value ?? null}::${sql.raw(type)}`;

  await inChunks(rows, async (chunk) => {
    const values = chunk.map(
      (row) =>
        sql`(${sql.join([
          ...keys.map((k) => cast(row.key[k.name], k.type)),
          ...columns.flatMap((c) => [
            cast(c.name in row.set, "boolean"),
            cast(row.set[c.name], c.type)
          ])
        ])})`
    );
    const valueNames = [
      ...keys.map((_, i) => sql.ref(`k${i}`)),
      ...columns.flatMap((_, i) => [sql.ref(`s${i}`), sql.ref(`v${i}`)])
    ];
    const assignments = columns.map(
      (c, i) =>
        sql`${sql.ref(c.name)} = CASE WHEN v.${sql.ref(`s${i}`)} THEN v.${sql.ref(`v${i}`)} ELSE t.${sql.ref(c.name)} END`
    );
    const matches = keys.map(
      (k, i) => sql`t.${sql.ref(k.name)} = v.${sql.ref(`k${i}`)}`
    );
    await sql`
      UPDATE ${sql.table(table)} AS t SET
        ${sql.join(assignments)},
        "updatedAt" = ${now},
        "updatedBy" = ${userId}
      FROM (VALUES ${sql.join(values)}) AS v(${sql.join(valueNames)})
      WHERE ${sql.join(matches, sql` AND `)} AND t."companyId" = ${companyId}
    `.execute(trx);
    return [];
  });
}
