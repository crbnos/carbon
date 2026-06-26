import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { sql } from "kysely";
import { inngest } from "../../client";
import type { Manifest } from "./company-backup";
import {
  BACKUP_INTEGRATION,
  BACKUP_KIND,
  BACKUP_VERSION,
  backupAssetsDir,
  backupTablePath,
  buildScopeFilter,
  copyAssetsToBackup,
  encodeValue,
  findExportScopeViolations,
  getCompanyTableCatalog,
  getJobDatabaseClient,
  mapWithConcurrency,
  SECRET_TABLES,
  STORAGE_BUCKET,
  serializeTable,
  writeBackupManifest
} from "./company-backup";

// Assets are copied server-side into the backup's `assets/` folder (no bytes pass
// through this process), so there's no memory reason to cap a single file — the
// bucket already bounds uploads (120MB CAD models, 50MB docs). The only bound is a
// storage-cost guard on the whole backup: each export duplicates the bundled
// bytes, so cap the total at 1GB.
const MAX_STORAGE_TOTAL_BYTES = 1024 * 1024 * 1024;

// How many tables to dump concurrently (query + gzip + upload). Matched by the
// export job's connection pool size.
const TABLE_CONCURRENCY = 6;

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;
type JobDatabase = ReturnType<typeof getJobDatabaseClient>;

/**
 * Build a company backup as a folder of small objects under `exports/<name>/`:
 * one `tables/<table>.ndjson.gz` per non-empty table (dumped in parallel), a
 * `manifest.json`, and (via the caller) `assets/<path>` files. Returns the folder
 * name. Exported so the same logic backs the export job, snapshots and onboarding
 * templates.
 */
export async function buildCompanyBackup(
  client: ServiceRole,
  db: JobDatabase,
  opts: {
    companyId: string;
    userId: string;
    label?: string | null;
    includeStorage: "none" | "all";
    /** Override the generated folder name (snapshots pass their own). */
    name?: string;
    /** Live progress of the table-dump phase (`tables`). Throttled by the caller. */
    onProgress?: (p: {
      phase: string;
      done: number;
      total: number;
    }) => Promise<void>;
  }
): Promise<{
  name: string;
  manifest: Manifest;
  rows: number;
  /** `private`-bucket paths to copy into the backup's `assets/` folder. */
  assetSourcePaths: string[];
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

  const exportedAt = new Date().toISOString();
  const slug = label
    ? `_${label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40)}`
    : "";
  const name = opts.name ?? `${exportedAt.replace(/[:.]/g, "-")}${slug}`;

  const catalog = await getCompanyTableCatalog(db);
  // Secrets (credentials/tokens) never travel — they belong to the source
  // company, not a copy. (Billing identity like companyPlan never enters the
  // catalog: it's a company-singleton deliberately left out of the scoped set.)
  const secretTables = new Set<string>(SECRET_TABLES);
  const excludedTables = catalog.tables
    .filter((t) => secretTables.has(t.name))
    .map((t) => t.name);
  const exportable = catalog.tables.filter((t) => !secretTables.has(t.name));
  const byName = new Map(catalog.tables.map((t) => [t.name, t]));

  // Closure guard — never write a backup that couldn't be restored. A NOT-NULL FK
  // pointing outside the company's scope (cross-company / out-of-scope) would dump
  // the child but not its parent, dangling on restore. Fail BEFORE writing any
  // table file, listing every offending FK.
  const scopeViolations = await findExportScopeViolations(
    db,
    exportable,
    byName,
    companyId,
    companyGroupId
  );
  if (scopeViolations.length > 0) {
    throw new Error(
      `Refusing to export ${companyId}: ${scopeViolations.length} NOT-NULL reference(s) ` +
        `escape company scope, so the backup could never be restored:\n  ${scopeViolations.join(
          "\n  "
        )}`
    );
  }

  // Dump each non-empty table to its own `tables/<table>.ndjson.gz`, in parallel.
  const tableManifest: Manifest["tables"] = [];
  let dumped = 0; // incremented as each table completes (single-threaded → safe)
  await mapWithConcurrency(exportable, TABLE_CONCURRENCY, async (table) => {
    const columns = table.columns.filter((c) => !c.isGenerated);
    // a prior import's revert ledger must never travel in an artifact
    const ledgerFilter =
      table.name === "externalIntegrationMapping"
        ? sql` AND ${sql.id("integration")} != ${BACKUP_INTEGRATION}`
        : sql``;
    // Direct-scoped tables filter by their companyId/companyGroupId column;
    // transitively-scoped child tables (contacts, line prices, …) filter through
    // their parent FK — see buildScopeFilter.
    const result = await sql<Record<string, unknown>>`
      SELECT ${sql.join(columns.map((c) => sql.id(c.name)))}
      FROM ${sql.id(table.name)}
      WHERE ${buildScopeFilter(table, byName, companyId, companyGroupId)}${ledgerFilter}
    `.execute(db);

    if (result.rows.length === 0) {
      dumped++;
      await opts.onProgress?.({
        phase: "tables",
        done: dumped,
        total: exportable.length
      });
      return; // empty tables get no file
    }

    const rows = result.rows.map((row) => {
      const encoded: Record<string, unknown> = {};
      for (const col of columns) {
        encoded[col.name] = encodeValue(row[col.name], col);
      }
      return encoded;
    });
    const buf = await serializeTable(rows);
    const up = await client.storage
      .from(companyId)
      .upload(backupTablePath(name, table.name), buf, {
        contentType: "application/gzip",
        upsert: true
      });
    if (up.error) throw new Error(`table ${table.name}: ${up.error.message}`);

    tableManifest.push({
      name: table.name,
      rows: result.rows.length,
      columns: columns.map((c) => c.name)
    });
    dumped++;
    await opts.onProgress?.({
      phase: "tables",
      done: dumped,
      total: exportable.length
    });
  });

  // Decide which storage assets are in scope. They live in the shared `private`
  // bucket under a `{companyId}/` prefix (3D models, item thumbnails,
  // attachments). They are NOT embedded — the caller copies the included files
  // server-side into the backup's `assets/` folder, so a large asset set costs no
  // memory. Skip anything over the total size guard.
  const storageManifest: Manifest["storage"] = [];
  const assetSourcePaths: string[] = [];

  if (includeStorage === "all") {
    let totalBytes = 0;
    const paths = await listBucketFilesRecursive(
      client,
      STORAGE_BUCKET,
      companyId
    );
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
    excludedTables
  };

  // The manifest is NOT written here — the caller writes it LAST (after assets)
  // via writeBackupManifest, so its presence marks the backup as complete.
  const rows = tableManifest.reduce((sum, t) => sum + t.rows, 0);
  return { name, manifest, rows, assetSourcePaths };
}

// One company-scoped progress marker (exports run one-at-a-time, so no run id).
// The UI polls it for live phase/done/total; it's cleared when the run ends, and
// the backup appearing in the list is what signals completion.
const EXPORT_INTEGRATION = "company-export";
type ExportProgress = { phase: string; done: number; total: number };

async function upsertExportMarker(
  client: ServiceRole,
  companyId: string,
  userId: string,
  metadata: { status: "running"; startedAt: string; progress?: ExportProgress }
): Promise<void> {
  const existing = await client
    .from("externalIntegrationMapping")
    .select("id")
    .eq("integration", EXPORT_INTEGRATION)
    .eq("companyId", companyId)
    .maybeSingle();
  if (existing.data) {
    await client
      .from("externalIntegrationMapping")
      .update({ metadata })
      .eq("id", existing.data.id)
      .eq("companyId", companyId);
  } else {
    await client.from("externalIntegrationMapping").insert({
      entityType: "export",
      entityId: companyId,
      integration: EXPORT_INTEGRATION,
      externalId: "",
      metadata,
      companyId,
      createdBy: userId
    });
  }
}

async function clearExportMarker(
  client: ServiceRole,
  companyId: string
): Promise<void> {
  await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", EXPORT_INTEGRATION)
    .eq("companyId", companyId);
}

export const companyExportFunction = inngest.createFunction(
  {
    id: "company-export",
    retries: 1,
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/company-export" },
  async ({ event, step }) => {
    const { companyId, userId, label, includeStorage } = event.data;

    return await step.run("export-company", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient(TABLE_CONCURRENCY);

      // Live-progress marker (cleared in `finally`, success or failure). Throttled
      // so a fast parallel dump doesn't hammer the row.
      const startedAt = new Date().toISOString();
      await upsertExportMarker(client, companyId, userId, {
        status: "running",
        startedAt
      });
      let lastAt = 0;
      let lastPhase = "";
      const report = async (progress: ExportProgress) => {
        const now = Date.now();
        const terminal = progress.done >= progress.total;
        if (progress.phase === lastPhase && !terminal && now - lastAt < 250) {
          return;
        }
        lastPhase = progress.phase;
        lastAt = now;
        await upsertExportMarker(client, companyId, userId, {
          status: "running",
          startedAt,
          progress
        });
      };

      try {
        const { name, manifest, rows, assetSourcePaths } =
          await buildCompanyBackup(client, db, {
            companyId,
            userId,
            label,
            includeStorage,
            onProgress: report
          });

        // Copy the in-scope assets server-side into the backup's `assets/` folder.
        // Best-effort (matches restore/import): the table files are already
        // committed; per-file copy failures only warn.
        await report({
          phase: "files",
          done: 0,
          total: assetSourcePaths.length
        });
        const assets = await copyAssetsToBackup(
          client,
          {
            sourcePaths: assetSourcePaths,
            destBucket: companyId,
            destPrefix: backupAssetsDir(name)
          },
          (done, total) => report({ phase: "files", done, total })
        );

        // Manifest LAST — its presence marks the backup complete, so the list
        // never shows a half-written backup as ready.
        await writeBackupManifest(client, companyId, name, manifest);

        console.log("Company export complete", {
          companyId,
          name,
          tables: manifest.tables.length,
          rows,
          assetsCopied: assets.copied,
          assetsFailed: assets.failed
        });

        return { name, tables: manifest.tables.length, rows };
      } finally {
        await clearExportMarker(client, companyId);
      }
    });
  }
);

async function listBucketFilesRecursive(
  client: ServiceRole,
  bucket: string,
  prefix = ""
): Promise<Array<{ path: string; size: number }>> {
  const files: Array<{ path: string; size: number }> = [];
  const { data, error } = await client.storage.from(bucket).list(prefix, {
    limit: 1000
  });
  if (error || !data) return files;

  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      // folder
      files.push(...(await listBucketFilesRecursive(client, bucket, path)));
    } else {
      files.push({
        path,
        size: (entry.metadata as { size?: number } | null)?.size ?? 0
      });
    }
  }
  return files;
}
