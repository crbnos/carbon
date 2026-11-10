// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Catalog } from "./catalog";
import { BACKUP_VERSION, type CompanyBackup, type Manifest } from "./format";
import { CATALOG_EXCLUDED_TABLES } from "./policy";
import { renameColumns, renameLiveColumns, TABLE_RENAMES } from "./renames";

/**
 * Whether a backup still loads into today's schema: the per-finding report the
 * Backups page shows, its one-word status, and the gate the load jobs enforce.
 * Free of runtime `@carbon/*` imports: the drift check runs under bare `tsx`.
 */

export type CompatibilityFinding = {
  /**
   * `defaulted` — a column added since this backup, which will take its DEFAULT.
   * `discarded` — a column removed since this backup; its values land nowhere.
   * `blocked`   — the restore cannot proceed.
   */
  kind: "defaulted" | "discarded" | "blocked";
  table: string;
  column?: string;
  reason: string;
};

/**
 * Diff a backup's manifest against a catalog: what a restore would fill with a
 * default, discard, or refuse outright. Only meaningful when the two come from
 * DIFFERENT points in time — the ERP loader computes it against the live schema,
 * and `assertBackupImportable` refuses on it inside the jobs.
 *
 * A NULLABLE column added since the backup is not reported — the ordinary
 * additive case would bury the findings that matter.
 */
export function reportBackupCompatibility(
  catalog: Catalog,
  manifest: Manifest
): { findings: CompatibilityFinding[]; blocked: boolean } {
  const findings: CompatibilityFinding[] = [];

  if (manifest.version !== BACKUP_VERSION) {
    // Nothing else about an unsupported generation is worth reporting.
    findings.push({
      kind: "blocked",
      table: "*",
      reason: `its format (generation ${manifest.version}) is no longer supported (current is ${BACKUP_VERSION})`
    });
    return { findings, blocked: true };
  }

  // Account defaults and the chart of accounts must travel together, or the
  // restore leaves a dangling FK. Read from the manifest: an empty table is
  // omitted entirely, so an absent entry IS a zero count.
  const rowsIn = (table: string) =>
    manifest.tables.find((t) => t.name === table)?.rows ?? 0;
  if (rowsIn("accountDefault") > 0 && rowsIn("account") === 0) {
    findings.push({
      kind: "blocked",
      table: "accountDefault",
      reason:
        "it has account defaults but no chart of accounts (exported from a company with no group)"
    });
  }

  const liveByName = new Map(catalog.tables.map((t) => [t.name, t]));
  const backupTableNames = new Set(manifest.tables.map((t) => t.name));
  for (const backupTable of manifest.tables) {
    if (CATALOG_EXCLUDED_TABLES.has(backupTable.name)) continue;

    // A table missing from the catalog resolves through TABLE_RENAMES: a mapped
    // name is the new table, an explicit null was dropped with its feature, and
    // an UNMAPPED name blocks — see renames.ts for why guessing is unacceptable.
    let live = liveByName.get(backupTable.name);
    if (!live) {
      const renamedTo = TABLE_RENAMES[backupTable.name];
      if (renamedTo === undefined) {
        findings.push({
          kind: "blocked",
          table: backupTable.name,
          reason: `table "${backupTable.name}" is not in the current schema and has no rename mapping`
        });
        continue;
      }
      if (renamedTo === null) {
        findings.push({
          kind: "discarded",
          table: backupTable.name,
          reason:
            "this table was removed along with its feature; its rows will not be restored"
        });
        continue;
      }
      // The backup carries BOTH names — applying the rename would merge two
      // tables and silently drop the old one's rows. Refuse.
      if (backupTableNames.has(renamedTo)) {
        findings.push({
          kind: "blocked",
          table: backupTable.name,
          reason: `it maps to "${renamedTo}", which this backup also contains`
        });
        continue;
      }
      live = liveByName.get(renamedTo);
      if (!live) {
        findings.push({
          kind: "blocked",
          table: backupTable.name,
          reason: `it maps to "${renamedTo}", which is not in the current schema either`
        });
        continue;
      }
    }

    // A renamed table's (or renamed column's) values are compared under their
    // CURRENT names, so a column that moved is not reported as both added and
    // removed.
    const backupColumnNames = liveByName.has(backupTable.name)
      ? renameLiveColumns(backupTable.name, backupTable.columns)
      : renameColumns(backupTable.name, backupTable.columns);
    const backupCols = new Set(backupColumnNames);
    for (const c of live.columns) {
      if (backupCols.has(c.name) || c.isGenerated || c.isNullable) continue;
      if (c.hasDefault) {
        findings.push({
          kind: "defaulted",
          table: backupTable.name,
          column: c.name,
          reason: "added since this backup; will take its default value"
        });
      } else {
        findings.push({
          kind: "blocked",
          table: backupTable.name,
          column: c.name,
          reason:
            "required since this backup, with no default value to fall back on"
        });
      }
    }

    const liveCols = new Set(live.columns.map((c) => c.name));
    for (const name of backupColumnNames) {
      if (liveCols.has(name)) continue;
      findings.push({
        kind: "discarded",
        table: backupTable.name,
        column: name,
        reason: "removed since this backup; its values will not be restored"
      });
    }
  }

  return {
    findings,
    blocked: findings.some((f) => f.kind === "blocked")
  };
}

export type BackupCompatibilityStatus =
  | "ready"
  | "restorable-with-changes"
  | "not-restorable";

/** Map a compatibility report onto the shared status vocabulary. */
export function compatibilityStatus(report: {
  findings: CompatibilityFinding[];
  blocked: boolean;
}): BackupCompatibilityStatus {
  if (report.blocked) return "not-restorable";
  return report.findings.length > 0 ? "restorable-with-changes" : "ready";
}

/**
 * Refuse a backup today's schema can't load: the restore and import jobs' gate.
 * It reads the same `blocked` findings the Backups page shows, so the screen and
 * the job can't disagree, and it reads only the manifest, so the verdict doesn't
 * depend on which table files a caller has loaded.
 */
export function assertBackupImportable(
  catalog: Catalog,
  backup: CompanyBackup
): void {
  const { findings } = reportBackupCompatibility(catalog, backup.manifest);
  const f = findings.find((x) => x.kind === "blocked");
  if (!f) return;
  const reason = f.column
    ? `"${f.table}" now requires column "${f.column}", which this backup predates`
    : f.reason;
  throw new Error(`This backup can't be restored: ${reason}.`);
}
