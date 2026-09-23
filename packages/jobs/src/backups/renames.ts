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
  cardTransactionLine: "chargeLine"
};

/**
 * Columns that moved WITH a table in TABLE_RENAMES, keyed by the OLD table
 * name. Only consulted for a table that resolved through TABLE_RENAMES, so a
 * live table never has its columns rewritten; a rename that keeps its column
 * list 1:1 needs no entry.
 */
export const COLUMN_RENAMES: Record<string, Record<string, string>> = {
  cardTransaction: { cardTransactionId: "chargeId" },
  cardTransactionLine: { cardTransactionId: "chargeId" }
};

/** A renamed table's column list under its CURRENT column names. */
export function renameColumns(oldTable: string, columns: string[]): string[] {
  const map = COLUMN_RENAMES[oldTable];
  if (!map) return columns;
  return columns.map((column) => map[column] ?? column);
}

function renameRowColumns(
  oldTable: string,
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  const map = COLUMN_RENAMES[oldTable];
  if (!map) return rows;
  return rows.map((row) => {
    const renamed: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(row)) {
      renamed[map[column] ?? column] = value;
    }
    return renamed;
  });
}

/**
 * Move a just-read backup's tables onto their CURRENT names. Runs once, right
 * after `readBackup`, so the gate, the closure preflight and `wipeAndLoad` all
 * agree on what the backup contains.
 */
export function applyTableRenames<
  T extends {
    manifest: {
      tables: Array<{ name: string; rows: number; columns: string[] }>;
    };
    data: Record<string, Record<string, unknown>[]>;
  }
>(catalog: { tables: Array<{ name: string }> }, backup: T): T {
  const live = new Set(catalog.tables.map((t) => t.name));

  // Only consulted for a name the schema no longer has, which is what makes a
  // rename cycle (A→B→A) safe: the stale `A: "B"` entry is never read.
  const resolve = (name: string): string | null => {
    if (live.has(name)) return name;
    const mapped = TABLE_RENAMES[name];
    if (mapped === null) return null;
    // Can't resolve confidently — leave it for the gate to refuse by name.
    if (mapped === undefined || !live.has(mapped) || backup.data[mapped]) {
      return name;
    }
    return mapped;
  };

  const tables: typeof backup.manifest.tables = [];
  const data: Record<string, Record<string, unknown>[]> = { ...backup.data };
  for (const t of backup.manifest.tables) {
    const to = resolve(t.name);
    if (to === null) {
      delete data[t.name];
      continue;
    }
    tables.push(
      to === t.name
        ? t
        : { ...t, name: to, columns: renameColumns(t.name, t.columns) }
    );
    if (to !== t.name && backup.data[t.name]) {
      data[to] = renameRowColumns(t.name, backup.data[t.name]!);
      delete data[t.name];
    }
  }

  return { ...backup, manifest: { ...backup.manifest, tables }, data };
}
