import type {
  FkDisplayHop,
  SnapshotFieldEntry
} from "@carbon/database/audit.config";
import {
  fkDisplayHops,
  fkDisplayRegistry
} from "@carbon/database/audit.config";

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
 *
 * When `hop` is set, `table` is a junction with no displayable columns of
 * its own: the handler reads `hop.column` off the junction row, then fetches
 * `displayColumns` from `hop.table` (tenant-scoped iff `hop.hasCompanyId`).
 */
export type SnapshotSpec = {
  table: string;
  displayColumns: readonly string[];
  hasCompanyId: boolean;
  hop?: { column: string; table: string; hasCompanyId: boolean };
};

/**
 * Resolve the snapshot spec for a changed column, or null if the column is
 * not a snapshot-able FK.
 *
 * Precedence:
 * 1. A per-column `snapshotFields` override on the table config — explicit
 *    display columns for this one FK.
 * 2. Schema-discovered FK (fkMap) whose target is a junction in
 *    `fkDisplayHops` — two-stage resolution through the junction.
 * 3. Schema-discovered FK whose target table is in `fkDisplayRegistry` —
 *    the automatic path covering every direct FK.
 *
 * Nested diff keys ("notes.content") and non-FK columns miss all three and
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
      // The override's column may have no schema FK at all (overrides exist
      // precisely for constraint-less columns), so fall back to the tenancy
      // of ANY schema FK referencing the same target table — a global table
      // like "user" is global no matter which column points at it. Default
      // to tenant-scoped only when the fkMap has no knowledge of the target.
      hasCompanyId:
        fk && fk.targetTable === override.table
          ? fk.targetHasCompanyId
          : (targetTenancy(fkMap, override.table) ?? true)
    };
  }

  if (!fk) return null;

  const hop = (fkDisplayHops as Record<string, FkDisplayHop | undefined>)[
    fk.targetTable
  ];
  if (hop) {
    return {
      table: fk.targetTable,
      displayColumns: hop.displayColumns,
      hasCompanyId: fk.targetHasCompanyId,
      hop: {
        column: hop.column,
        table: hop.table,
        hasCompanyId: targetTenancy(fkMap, hop.table) ?? true
      }
    };
  }

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

/**
 * Tenancy of a target table according to any schema FK that references it,
 * regardless of which column does the referencing. Undefined when no FK in
 * the map points at the table.
 */
function targetTenancy(fkMap: FkMap, table: string): boolean | undefined {
  for (const entry of fkMap.values()) {
    if (entry.targetTable === table) return entry.targetHasCompanyId;
  }
  return undefined;
}
