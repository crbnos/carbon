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
 * Starts EMPTY on purpose: a wrong historical mapping is worse than none.
 */
export const TABLE_RENAMES: Record<string, string | null> = {};

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
    tables.push(to === t.name ? t : { ...t, name: to });
    if (to !== t.name && backup.data[t.name]) {
      data[to] = backup.data[t.name]!;
      delete data[t.name];
    }
  }

  return { ...backup, manifest: { ...backup.manifest, tables }, data };
}
