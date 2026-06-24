import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { sql } from "kysely";
import { inngest } from "../../client";
import type { CompanyBackup, Manifest } from "./company-backup";
import {
  BACKUP_INTEGRATION,
  BACKUP_KIND,
  BACKUP_VERSION,
  EXPORTS_PREFIX,
  encodeValue,
  getCompanyTableCatalog,
  getJobDatabaseClient,
  SECRET_TABLES,
  STORAGE_BUCKET
} from "./company-backup";

/** Per-file and total caps for embedded storage files (base64 inflates ~33%). */
const MAX_STORAGE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_STORAGE_TOTAL_BYTES = 200 * 1024 * 1024;

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;
type JobDatabase = ReturnType<typeof getJobDatabaseClient>;

/**
 * Build a gzipped company backup (data + optional storage files). Exported so
 * the same logic that backs the export job can author onboarding templates.
 */
export async function buildCompanyBackup(
  client: ServiceRole,
  db: JobDatabase,
  opts: {
    companyId: string;
    userId: string;
    label?: string | null;
    includeStorage: "none" | "all";
  }
): Promise<{ compressed: Buffer; manifest: Manifest; rows: number }> {
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

  const catalog = await getCompanyTableCatalog(db);
  const secretTables = new Set(SECRET_TABLES);

  const data: CompanyBackup["data"] = {};
  const tableManifest: Manifest["tables"] = [];
  const excludedTables: string[] = [];

  for (const table of catalog.tables) {
    if (secretTables.has(table.name)) {
      excludedTables.push(table.name);
      continue;
    }

    // companyGroup-scoped tables (chart of accounts, currencies, …) are
    // filtered by the company's group; everything else by companyId.
    const scopeValue =
      table.scopeColumn === "companyGroupId" ? companyGroupId : companyId;

    const columns = table.columns.filter((c) => !c.isGenerated);
    // a prior import's revert ledger must never travel in an artifact
    const ledgerFilter =
      table.name === "externalIntegrationMapping"
        ? sql` AND ${sql.id("integration")} != ${BACKUP_INTEGRATION}`
        : sql``;
    const result = await sql<Record<string, unknown>>`
      SELECT ${sql.join(columns.map((c) => sql.id(c.name)))}
      FROM ${sql.id(table.name)}
      WHERE ${sql.id(table.scopeColumn)} = ${scopeValue}${ledgerFilter}
    `.execute(db);

    if (result.rows.length === 0) continue;

    data[table.name] = result.rows.map((row) => {
      const encoded: Record<string, unknown> = {};
      for (const col of columns) {
        encoded[col.name] = encodeValue(row[col.name], col);
      }
      return encoded;
    });

    tableManifest.push({
      name: table.name,
      rows: result.rows.length,
      columns: columns.map((c) => c.name)
    });
  }

  // Optionally embed the company's storage assets so the backup is a
  // self-contained unit. These live in the shared `private` bucket under a
  // `{companyId}/` prefix (3D models, item thumbnails, attachments) — NOT in
  // the per-company bucket. Skip anything over the size caps.
  const storageManifest: Manifest["storage"] = [];
  let storageFiles: Record<string, string> | undefined;

  if (includeStorage === "all") {
    storageFiles = {};
    let totalBytes = 0;
    const paths = await listBucketFilesRecursive(
      client,
      STORAGE_BUCKET,
      companyId
    );

    for (const file of paths) {
      let included =
        file.size <= MAX_STORAGE_FILE_BYTES &&
        totalBytes + file.size <= MAX_STORAGE_TOTAL_BYTES;

      if (included) {
        const download = await client.storage
          .from(STORAGE_BUCKET)
          .download(file.path);
        if (download.error || !download.data) {
          console.error("Failed to download storage file", {
            path: file.path,
            error: download.error
          });
          included = false;
        } else {
          storageFiles[file.path] = Buffer.from(
            await download.data.arrayBuffer()
          ).toString("base64");
          totalBytes += file.size;
        }
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
    exportedAt: new Date().toISOString(),
    exportedBy: userId,
    label,
    includeStorage,
    tables: tableManifest,
    storage: storageManifest,
    excludedTables
  };

  const backup: CompanyBackup = { manifest, data, storage: storageFiles };
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(backup)));
  const rows = tableManifest.reduce((sum, t) => sum + t.rows, 0);
  return { compressed, manifest, rows };
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
      const db = getJobDatabaseClient(1);

      const { compressed, manifest, rows } = await buildCompanyBackup(
        client,
        db,
        { companyId, userId, label, includeStorage }
      );

      const timestamp = manifest.exportedAt.replace(/[:.]/g, "-");
      const slug = label
        ? `_${label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 40)}`
        : "";
      const path = `${EXPORTS_PREFIX}/${timestamp}${slug}.carbon.json.gz`;

      const upload = await client.storage
        .from(companyId)
        .upload(path, compressed, {
          contentType: "application/gzip",
          upsert: false
        });
      if (upload.error) throw new Error(upload.error.message);

      console.log("Company export complete", {
        companyId,
        path,
        tables: manifest.tables.length,
        rows,
        bytes: compressed.byteLength
      });

      return { path, tables: manifest.tables.length, rows };
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
