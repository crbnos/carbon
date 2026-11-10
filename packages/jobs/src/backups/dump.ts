// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { async, datetime } from "@carbon/utils";
import { sql } from "kysely";
import type { JobDatabase } from "../db";
import {
  exportableColumns,
  getCompanyTableCatalog,
  selectExportableTables
} from "./catalog";
import { TABLE_CONCURRENCY } from "./concurrency";
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  encodeValue,
  type Manifest,
  newBackupName,
  ROW_BATCH,
  tableWriter
} from "./format";
import type { JobProgress } from "./runs";
import {
  buildScopeFilter,
  computeScopeExclusions,
  ExportScopeViolationError,
  findExportScopeViolations,
  type ScopeExclusions
} from "./scope";
import {
  copyAssetsToBackup,
  listCompanyFiles,
  writeBackupManifest,
  writeBackupTable
} from "./storage";

const log = getLogger("jobs", "backup-dump");

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

/**
 * Dumping a company into a backup folder: the export and both snapshots.
 */

// Assets are copied server-side into the backup's `assets/` folder (no bytes pass
// through this process), so there's no memory reason to cap a single file — the
// bucket already bounds uploads (120MB CAD models, 50MB docs). The only bound is a
// storage-cost guard on the whole backup: each export duplicates the bundled
// bytes, so cap the total at 1GB.
const MAX_STORAGE_TOTAL_BYTES = 1024 * 1024 * 1024;

/**
 * Write a company backup as a folder under `exports/<name>/`: one
 * `tables/<table>.ndjson.gz` per non-empty table (dumped in parallel), the
 * in-scope storage files copied server-side into `assets/`, then
 * `manifest.json` LAST, whose presence marks the backup complete. The export
 * and both snapshots write through here, so a snapshot carries its files and
 * a revert can put them back.
 */
export async function writeCompanyBackup(
  client: ServiceRole,
  db: JobDatabase,
  opts: {
    companyId: string;
    userId: string;
    label?: string | null;
    includeStorage: "none" | "all";
    /** Override the generated folder name (snapshots pass their own). */
    name?: string;
    /**
     * Exclude (and record in `manifest.excludedRows`) rows whose NOT-NULL FK
     * escapes company scope, plus rows depending on them. Default false =
     * refuse: the guard is a tenant-leak detector, and skipping is a
     * user-confirmed recovery after a visible failure (spec 2026-09-01).
     */
    skipCorrupted?: boolean;
    /** Live progress of the `tables` and `files` phases. Throttled by the caller. */
    onProgress?: (p: JobProgress) => Promise<void>;
  }
): Promise<{
  name: string;
  manifest: Manifest;
  rows: number;
  /** Storage files copied into `assets/`, and those that failed to copy. */
  assets: { copied: number; failed: number };
}> {
  const { companyId, userId, includeStorage } = opts;
  const label = opts.label ?? null;

  const company = await client
    .from("company")
    .select("id, name, companyGroupId")
    .eq("id", companyId)
    .single();
  if (company.error) throw new Error(company.error.message);
  const companyGroupId = company.data?.companyGroupId ?? null;

  // A companyGroup-scoped backup (chart of accounts, currencies, dimensions) is
  // meaningless without a group. Fail loudly rather than silently omitting it —
  // a groupless shell company once produced "valid"-looking backups with an
  // empty chart of accounts that then propagated to every onboarded company.
  if (companyGroupId === null) {
    throw new Error(
      `Company ${companyId} has no companyGroup — a backup would omit the chart ` +
        "of accounts, currencies and dimensions. Seed the company before backing it up."
    );
  }

  const exportedAt = datetime.timestamp();
  const name = opts.name ?? newBackupName(exportedAt, label);

  const catalog = await getCompanyTableCatalog(db);
  // Secrets (credentials/tokens) never travel — they belong to the source
  // company, not a copy. (Billing identity like companyPlan never enters the
  // catalog: it's a company-singleton deliberately left out of the scoped set.)
  const { exportable, excludedTables } = selectExportableTables(catalog);
  const byName = new Map(catalog.tables.map((t) => [t.name, t]));

  // Closure guard — never write a backup that couldn't be restored. A NOT-NULL FK
  // pointing outside the company's scope (cross-company / out-of-scope) would dump
  // the child but not its parent, dangling on restore. Fail BEFORE writing any
  // table file, listing every offending FK.
  //
  // This refusal is DELIBERATE and is not a backup bug to route around. Row-level
  // security hides another tenant's rows from every ordinary read, so an export —
  // which runs without it — is the first thing in the system wide enough to see a
  // cross-tenant reference at all. Excluding the rows and carrying on would make
  // the only detector we have go quiet.
  //
  // `skipCorrupted` is the ONE sanctioned bypass — user-confirmed after a visible
  // failure, logged loudly here, and the manifest records what was dropped.
  let exclusions: ScopeExclusions | null = null;
  if (opts.skipCorrupted) {
    exclusions = await computeScopeExclusions(
      db,
      exportable,
      byName,
      companyId,
      companyGroupId
    );
    if (exclusions.summary.length > 0) {
      // Skipping a group-shared row deletes nothing, but the artifact then
      // lacks config the whole group depends on — worth its own log line. The
      // purge refuses outright on these; see `purgeScopeViolations`.
      const shared = exclusions.summary.filter(
        (e) => byName.get(e.table)?.scopeColumn === "companyGroupId"
      );
      log.warn("Company export skipping out-of-scope rows", {
        companyId,
        excludedRows: exclusions.summary,
        ...(shared.length > 0
          ? { sharedGroupTablesAffected: shared.map((e) => e.table) }
          : {})
      });
    }
  } else {
    const { violations, rowsByTable } = await findExportScopeViolations(
      db,
      exportable,
      byName,
      companyId,
      companyGroupId
    );
    if (violations.length > 0) {
      throw new ExportScopeViolationError(companyId, violations, rowsByTable);
    }
  }

  const tableManifest: Manifest["tables"] = [];
  let dumped = 0; // incremented as each table completes (single-threaded → safe)
  await async.map(
    exportable,
    async (table) => {
      const columns = exportableColumns(table);
      const exclusion = exclusions?.predicates.get(table.name);
      const exclusionFilter = exclusion ? sql` AND NOT (${exclusion})` : sql``;
      // A cursor, so a table of any size passes through a batch at a time and
      // only its compressed bytes are kept.
      const writer = tableWriter();
      let rowCount = 0;
      await db.transaction().execute(async (trx) => {
        await sql`
          DECLARE backup_rows NO SCROLL CURSOR FOR
          SELECT ${sql.join(columns.map((c) => sql.id(c.name)))}
          FROM ${sql.id(table.name)}
          WHERE ${buildScopeFilter(table, byName, companyId, companyGroupId)}${exclusionFilter}
        `.execute(trx);
        for (;;) {
          const { rows } = await sql<Record<string, unknown>>`
            FETCH ${sql.raw(String(ROW_BATCH))} FROM backup_rows
          `.execute(trx);
          if (rows.length === 0) break;
          await writer.write(
            rows.map((row) => {
              const encoded: Record<string, unknown> = {};
              for (const col of columns) {
                encoded[col.name] = encodeValue(row[col.name], col);
              }
              return encoded;
            })
          );
          rowCount += rows.length;
        }
      });

      if (rowCount === 0) {
        dumped++;
        await opts.onProgress?.({
          phase: "tables",
          done: dumped,
          total: exportable.length
        });
        return;
      }
      await writeBackupTable(
        client,
        companyId,
        name,
        table.name,
        await writer.finish()
      );

      tableManifest.push({
        name: table.name,
        rows: rowCount,
        columns: columns.map((c) => c.name)
      });
      dumped++;
      await opts.onProgress?.({
        phase: "tables",
        done: dumped,
        total: exportable.length
      });
    },
    { concurrency: TABLE_CONCURRENCY }
  );

  // The company's storage files under its `{companyId}/` prefix (3D models,
  // item thumbnails, attachments), up to the total size guard.
  const storageManifest: Manifest["storage"] = [];
  const assetSourcePaths: string[] = [];

  if (includeStorage === "all") {
    let totalBytes = 0;
    const paths = await listCompanyFiles(client, companyId, companyId);
    for (const file of paths) {
      const included = totalBytes + file.size <= MAX_STORAGE_TOTAL_BYTES;
      if (included) {
        assetSourcePaths.push(file.path);
        totalBytes += file.size;
      }
      storageManifest.push({ path: file.path, size: file.size, included });
    }
  }

  const manifest: Manifest = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    schemaVersion: catalog.schemaVersion,
    sourceCompanyId: companyId,
    sourceCompanyGroupId: companyGroupId,
    sourceCompanyName: company.data?.name ?? null,
    exportedAt,
    exportedBy: userId,
    label,
    includeStorage,
    tables: tableManifest,
    storage: storageManifest,
    excludedTables,
    excludedRows: exclusions?.summary ?? [],
    excludedRowsByTable: exclusions?.perTable ?? []
  };

  // Server-side copies, best-effort: a file that fails only warns.
  await opts.onProgress?.({
    phase: "files",
    done: 0,
    total: assetSourcePaths.length
  });
  const assets = await copyAssetsToBackup(
    client,
    {
      companyId,
      sourcePaths: assetSourcePaths,
      name
    },
    (done, total) =>
      opts.onProgress?.({ phase: "files", done, total }) ?? Promise.resolve()
  );

  await writeBackupManifest(client, companyId, name, manifest);

  const rows = tableManifest.reduce((sum, t) => sum + t.rows, 0);
  return { name, manifest, rows, assets };
}
