import type { SnapshotFieldEntry } from "@carbon/database/audit.config";
import { fkDisplayRegistry } from "@carbon/database/audit.config";

/**
 * FK topology for the audited tables, discovered from the schema via the
 * `get_foreign_key_map` RPC: which columns point at which table, and whether
 * the target table is tenant-scoped. Keyed `"${tableName}.${columnName}"`.
 */
export type FkMapEntry = {
  targetTable: string;
  targetHasCompanyId: boolean;
};

export type FkMap = ReadonlyMap<string, FkMapEntry>;

export type FkMapRow = {
  tableName: string;
  columnName: string;
  targetTable: string;
  targetHasCompanyId: boolean;
};

export function fkMapKey(tableName: string, columnName: string): string {
  return `${tableName}.${columnName}`;
}

export function parseFkMapRows(
  rows: readonly FkMapRow[]
): Map<string, FkMapEntry> {
  const map = new Map<string, FkMapEntry>();
  for (const row of rows) {
    map.set(fkMapKey(row.tableName, row.columnName), {
      targetTable: row.targetTable,
      targetHasCompanyId: row.targetHasCompanyId
    });
  }
  return map;
}

/**
 * What to snapshot for one diff column: the FK target table, the display
 * columns to freeze, and whether the lookup can be tenant-scoped.
 */
export type SnapshotSpec = {
  table: string;
  displayColumns: readonly string[];
  hasCompanyId: boolean;
};

/**
 * Resolve the snapshot spec for a changed column, or null if the column is
 * not a snapshot-able FK.
 *
 * Precedence:
 * 1. A per-column `snapshotFields` override on the table config — explicit
 *    display columns for this one FK.
 * 2. Schema-discovered FK (fkMap) whose target table is in
 *    `fkDisplayRegistry` — the automatic path covering every FK.
 *
 * Nested diff keys ("notes.content") and non-FK columns miss both and
 * resolve to null — the diff keeps its raw values.
 */
export function resolveSnapshotSpec(
  tableName: string,
  column: string,
  overrides: ReadonlyMap<string, SnapshotFieldEntry>,
  fkMap: FkMap
): SnapshotSpec | null {
  const fk = fkMap.get(fkMapKey(tableName, column));

  const override = overrides.get(column);
  if (override) {
    return {
      table: override.table,
      displayColumns: override.displayColumns,
      // The override's target may differ from the schema FK's target (or the
      // fkMap may be unavailable); only trust the fkMap's tenancy flag when
      // it describes the same target table. Default to tenant-scoped — the
      // behavior overrides always had.
      hasCompanyId:
        fk && fk.targetTable === override.table ? fk.targetHasCompanyId : true
    };
  }

  if (!fk) return null;
  const displayColumns = (
    fkDisplayRegistry as Record<string, readonly string[] | undefined>
  )[fk.targetTable];
  if (!displayColumns || displayColumns.length === 0) return null;

  return {
    table: fk.targetTable,
    displayColumns,
    hasCompanyId: fk.targetHasCompanyId
  };
}
