// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CompanyBackup, Row } from "./format";

/**
 * Tenant-scoped tables that have been RENAMED or DROPPED, so an older backup
 * naming them can still be read. A migration that renames or drops a
 * tenant-scoped table MUST add an entry here in the same commit: the new name
 * for a rename, `null` for a table dropped with its feature.
 *
 * The schema alone cannot tell those two apart, and guessing "dropped" when it
 * was a rename silently discards a customer's rows while reporting success —
 * so an unmapped missing table refuses the restore and names itself.
 *
 * Entries are added only with certainty: a wrong historical mapping is worse
 * than none.
 */
export const TABLE_RENAMES: Record<string, string | null> = {
  // Dropped 2026-09 (currency/exchange-rate refactor): the group-scoped daily
  // rate table never had a writer and held zero rows everywhere; replaced by
  // the platform-global "exchangeRate" table, which is not tenant-scoped and
  // therefore never appears in a backup.
  exchangeRateHistory: null,
  // Renamed 2026-09 (sales rules): the storage-rule tables merged into the
  // shared enforcement-rule tables (20260817143512). Column lists carry over
  // 1:1; the new "family" column defaults to 'storage', which is what every
  // pre-merge row was.
  storageRule: "enforcementRule",
  storageRuleItemAssignment: "enforcementRuleItemAssignment",
  storageRuleWorkCenterAssignment: "enforcementRuleWorkCenterAssignment",
  // Renamed 2026-09-22 (card transactions are charges, 20260922195151). Both
  // tables held zero rows everywhere when renamed — the feature had not been
  // used — so a pre-rename backup carries only their empty shells. The
  // readable-id / parent column moved with them (cardTransactionId → chargeId).
  cardTransaction: "charge",
  cardTransactionLine: "chargeLine",
  // Dropped 2026-10-23 with the old field-service module (service orders,
  // visits and installed components; 20261023065804). Service jobs replace
  // it with new tables; nothing carries over.
  serviceOrder: null,
  serviceVisit: null,
  customerAssetComponent: null
};

/**
 * Columns that moved WITH a table in TABLE_RENAMES, keyed by the OLD table
 * name. Only consulted for a table that resolved through TABLE_RENAMES, so a
 * live table never has its columns rewritten; a rename that keeps its column
 * list 1:1 needs no entry.
 */
const COLUMN_RENAMES: Record<string, Record<string, string>> = {
  cardTransaction: { cardTransactionId: "chargeId" },
  cardTransactionLine: { cardTransactionId: "chargeId" }
};

/**
 * Columns renamed on a table that KEPT its name, keyed by the table's current
 * name. Without an entry an older backup's values for the old column are
 * reported "removed since this backup" and silently not restored. A column is
 * only renamed when the backup does not already carry the new name, so a
 * backup taken after the rename passes through untouched.
 */
export const LIVE_COLUMN_RENAMES: Record<string, Record<string, string>> = {
  // 2026-10 (supplier part currency): the price is now stored in the supplier
  // part's own currency, which every pre-rename price was (the base currency;
  // a NULL currencyCode reads as base).
  supplierPart: { unitPrice: "supplierUnitPrice" },
  supplierPartPrice: { unitPrice: "supplierUnitPrice" }
};

/** A live table's column list under its CURRENT column names. */
export function renameLiveColumns(table: string, columns: string[]): string[] {
  const map = liveColumnMap(table, columns);
  if (!map) return columns;
  return columns.map((column) => map[column] ?? column);
}

/** The renames that apply to this backup's copy of the table, if any. */
function liveColumnMap(
  table: string,
  columns: string[]
): Record<string, string> | null {
  const map = LIVE_COLUMN_RENAMES[table];
  if (!map) return null;
  const present = new Set(columns);
  const applicable = Object.fromEntries(
    Object.entries(map).filter(
      ([from, to]) => present.has(from) && !present.has(to)
    )
  );
  return Object.keys(applicable).length > 0 ? applicable : null;
}

/** A renamed table's column list under its CURRENT column names. */
export function renameColumns(oldTable: string, columns: string[]): string[] {
  const map = COLUMN_RENAMES[oldTable];
  if (!map) return columns;
  return columns.map((column) => map[column] ?? column);
}

function renameRows(map: Record<string, string>, rows: Row[]): Row[] {
  return rows.map((row) => {
    const renamed: Row = {};
    for (const [column, value] of Object.entries(row)) {
      renamed[map[column] ?? column] = value;
    }
    return renamed;
  });
}

/**
 * Read a backup under the CURRENT table and column names. Runs once, right
 * after `readBackup`, so the gate, the closure preflight and `wipeAndLoad` all
 * agree on what the backup contains. Rows are renamed as they stream through.
 */
export function applyTableRenames(
  catalog: { tables: Array<{ name: string }> },
  backup: CompanyBackup
): CompanyBackup {
  const live = new Set(catalog.tables.map((t) => t.name));
  const stored = new Set(backup.manifest.tables.map((t) => t.name));

  // Only consulted for a name the schema no longer has, which is what makes a
  // rename cycle (A→B→A) safe: the stale `A: "B"` entry is never read.
  const resolve = (name: string): string | null => {
    if (live.has(name)) return name;
    const mapped = TABLE_RENAMES[name];
    if (mapped === null) return null;
    // Can't resolve confidently — leave it for the gate to refuse by name.
    if (mapped === undefined || !live.has(mapped) || stored.has(mapped)) {
      return name;
    }
    return mapped;
  };

  const tables: CompanyBackup["manifest"]["tables"] = [];
  // Today's name → the stored table it reads, and the column renames to apply.
  const sources = new Map<
    string,
    { from: string; columns: Record<string, string> | null }
  >();
  for (const t of backup.manifest.tables) {
    const to = resolve(t.name);
    if (to === null) continue;
    if (to === t.name) {
      const columns = liveColumnMap(t.name, t.columns);
      tables.push(
        columns ? { ...t, columns: renameLiveColumns(t.name, t.columns) } : t
      );
      sources.set(t.name, { from: t.name, columns });
      continue;
    }
    tables.push({ ...t, name: to, columns: renameColumns(t.name, t.columns) });
    sources.set(to, { from: t.name, columns: COLUMN_RENAMES[t.name] ?? null });
  }

  return {
    manifest: { ...backup.manifest, tables },
    async *rows(table) {
      const source = sources.get(table);
      if (!source) return;
      for await (const batch of backup.rows(source.from)) {
        yield source.columns ? renameRows(source.columns, batch) : batch;
      }
    }
  };
}
