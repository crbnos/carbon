// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { type Kysely, sql } from "kysely";
import type { TableInfo } from "./catalog";
import { buildScopeFilter } from "./scope";

/**
 * What only the onboarding reseed needs: loading a backup additively into a
 * company that already has some rows of its own.
 */

/**
 * Reseed drops tables the target already populated (`filterUnpopulated`) — but a
 * dropped table whose ids the kept rows still REFERENCE cannot simply vanish:
 * with no id map, every FK into it is nulled (nullable) or left dangling at the
 * source company's row (NOT NULL, committed under replica mode). That is how
 * creating a company from a backup detached every workCenter and job from its
 * location — onboarding had inserted one "Headquarters" row, so the backup's
 * whole `location` table was dropped as "already populated".
 *
 * Returns the dropped tables that must be imported anyway: those referenced via
 * an `id` FK from any kept table, transitively (a re-added table's own FK
 * targets may also have been dropped). Colliding rows are handled separately —
 * see `mapCollidingRows`.
 */
export function referencedDroppedTables(
  kept: TableInfo[],
  dropped: TableInfo[]
): TableInfo[] {
  const droppedByName = new Map(dropped.map((t) => [t.name, t]));
  const included = new Set(kept.map((t) => t.name));
  const readded = new Map<string, TableInfo>();
  const queue = [...kept];
  while (queue.length > 0) {
    const table = queue.pop()!;
    for (const fk of table.foreignKeys) {
      if (fk.refColumn !== "id") continue;
      if (included.has(fk.refTable) || readded.has(fk.refTable)) continue;
      const target = droppedByName.get(fk.refTable);
      if (!target) continue;
      readded.set(target.name, target);
      queue.push(target);
    }
  }
  return [...readded.values()];
}

/**
 * Unique index column groups usable for matching a backup row onto an EXISTING
 * target row before insert. The scope column is dropped from each group (it is
 * re-stamped to the target, so it matches by construction); a group left empty,
 * or containing `id` or any FK column, is unusable — those values are remapped
 * on load, so comparing raw backup values against target rows would be wrong.
 */
export function matchableUniqueGroups(
  groups: string[][],
  table: TableInfo
): string[][] {
  const remapped = new Set(table.foreignKeys.map((fk) => fk.column));
  remapped.add("id");
  const scopeColumn = table.scope.kind === "direct" ? table.scope.column : null;
  const usable: string[][] = [];
  for (const group of groups) {
    const cols = group.filter((c) => c !== scopeColumn);
    if (cols.length === 0) continue;
    if (cols.some((c) => remapped.has(c))) continue;
    usable.push(cols);
  }
  return usable;
}

export type CollisionResolution = {
  /** Source ids of backup rows NOT to insert — the target already has them. */
  skippedSourceIds: Set<string>;
  /** source id → the existing target row's id, applied onto the table's id map
   *  so every FK into the skipped row lands on the target's own row. */
  overrides: Map<string, string>;
};

/**
 * Match backup rows against the target's existing rows on the given unique
 * column groups. A re-added table (see `referencedDroppedTables`) is by
 * definition already populated in the target, and inserting a backup row that
 * shares a unique key with an existing one would abort the whole load — unique
 * constraints stay enforced even under replica mode. The canonical case: both
 * sides carry a "Headquarters" location (onboarding names its first location
 * that), and the backup's must MAP onto the target's, not fight it.
 *
 * NULL never matches (Postgres unique treats NULLs as distinct); the first
 * matching group wins.
 */
export function mapCollidingRows(
  groups: string[][],
  backupRows: Array<{ [col: string]: unknown }>,
  targetRows: Array<{ [col: string]: unknown }>
): CollisionResolution {
  const skippedSourceIds = new Set<string>();
  const overrides = new Map<string, string>();

  const keyFor = (
    row: { [col: string]: unknown },
    cols: string[]
  ): string | null => {
    const values: unknown[] = [];
    for (const col of cols) {
      const v = row[col];
      if (v == null) return null;
      values.push(v);
    }
    return JSON.stringify(values);
  };

  const targetByKey = groups.map((cols) => {
    const index = new Map<string, string>();
    for (const row of targetRows) {
      if (typeof row.id !== "string") continue;
      const key = keyFor(row, cols);
      if (key !== null && !index.has(key)) index.set(key, row.id);
    }
    return index;
  });

  for (const row of backupRows) {
    if (typeof row.id !== "string") continue;
    for (let g = 0; g < groups.length; g++) {
      const key = keyFor(row, groups[g]!);
      if (key === null) continue;
      const targetId = targetByKey[g]!.get(key);
      if (targetId !== undefined) {
        skippedSourceIds.add(row.id);
        overrides.set(row.id, targetId);
        break;
      }
    }
  }

  return { skippedSourceIds, overrides };
}

/**
 * Composite unique index column groups of one table, for `mapCollidingRows`.
 * Primary keys are excluded (ids are minted fresh); partial and expression
 * indexes are excluded (their uniqueness is predicate/expression-dependent, so
 * raw column equality over-detects collisions).
 */
export async function getUniqueColumnGroups(
  db: Kysely<KyselyDatabase>,
  tableName: string
): Promise<string[][]> {
  const result = await sql<{ cols: string[] }>`
    -- attname is the "name" type; cast so the driver parses a real text[]
    SELECT array_agg(a.attname::text ORDER BY x.ordinality) AS cols
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
    WHERE n.nspname = 'public'
      AND t.relname = ${tableName}
      AND ix.indisunique
      AND NOT ix.indisprimary
      AND ix.indexprs IS NULL
      AND ix.indpred IS NULL
    GROUP BY ix.indexrelid
  `.execute(db);
  return result.rows.map((r) => r.cols);
}

/**
 * Of the given tables, return only those the target has NOT yet populated in
 * its scope (companyId or companyGroupId). Reseed import uses this so it
 * never overwrites data the target already owns — a bare clone keeps every
 * table, an identity-seeded onboard drops the ones its seed/triggers filled.
 */
export async function filterUnpopulated(
  db: Kysely<KyselyDatabase>,
  tables: TableInfo[],
  byName: Map<string, TableInfo>,
  companyId: string,
  companyGroupId: string | null
): Promise<TableInfo[]> {
  const isEmpty = await Promise.all(
    tables.map(async (t) => {
      const result = await sql<{ present: boolean }>`
        SELECT EXISTS(
          SELECT 1 FROM ${sql.id(t.name)}
          WHERE ${buildScopeFilter(t, byName, companyId, companyGroupId)}
        ) AS present
      `.execute(db);
      return !result.rows[0]?.present;
    })
  );
  return tables.filter((_, i) => isEmpty[i]);
}
