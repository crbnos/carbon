import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createGunzip, createGzip } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ColumnInfo } from "./catalog";
import { mapWithConcurrency, TABLE_CONCURRENCY } from "./concurrency";

/**
 * The backup format: a folder `exports/<name>/` holding `manifest.json`, one
 * `tables/<table>.ndjson.gz` per non-empty table and `assets/<path>` files.
 * Tables are written and read a line at a time, so a huge table never becomes
 * one string.
 */

export const BACKUP_KIND = "carbon-company-backup";

export const BACKUP_VERSION = 1;

export type Manifest = {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  schemaVersion: string;
  sourceCompanyId: string;
  sourceCompanyGroupId: string | null;
  sourceCompanyName: string | null;
  exportedAt: string;
  exportedBy: string;
  label: string | null;
  includeStorage: "none" | "all";
  tables: Array<{ name: string; rows: number; columns: string[] }>;
  storage: Array<{ path: string; size: number; included: boolean }>;
  excludedTables: string[];
  /**
   * Rows deliberately left out because a NOT-NULL FK escaped company scope
   * ("violation") or pointed at such a row ("cascade"). Absent/empty = full
   * export. Written only when the export ran with `skipCorrupted`.
   */
  excludedRows?: Array<{
    table: string;
    column: string;
    refTable: string;
    rows: number;
    cause: "violation" | "cascade";
  }>;
  /**
   * DISTINCT rows excluded, per table. `excludedRows` is per FK EDGE and
   * double-counts a row that violated several of its foreign keys, so this is
   * the only field a total may be summed from. Absent on backups taken before
   * it existed — treat as "unknown", not zero.
   */
  excludedRowsByTable?: Array<{ table: string; rows: number }>;
};

export const BACKUP_INTEGRATION = "company-backup";

export const EXPORTS_PREFIX = "exports";

export type CompanyBackup = {
  manifest: Manifest;
  data: Record<string, Record<string, unknown>[]>;
};

// ── File-per-table layout ──────────────────────────────────────────────────
// A backup is a folder `exports/<name>/` of small objects (each under the bucket
// size cap): `manifest.json`, one `tables/<table>.ndjson.gz` per non-empty table
// (dumped + loaded in parallel), and `assets/<path>` files. Bundled as one
// `.carbon.tar.gz` for cross-environment download / upload.

export function backupDir(name: string): string {
  return `${EXPORTS_PREFIX}/${name}`;
}

export function backupManifestPath(name: string): string {
  return `${EXPORTS_PREFIX}/${name}/manifest.json`;
}

export function backupTablePath(name: string, table: string): string {
  return `${EXPORTS_PREFIX}/${name}/tables/${table}.ndjson.gz`;
}

export function backupAssetsDir(name: string): string {
  return `${EXPORTS_PREFIX}/${name}/assets`;
}

/**
 * Write `manifest.json` — the LAST thing written for a backup, after every table
 * file and asset is in place. Its presence is the "backup is complete" marker:
 * the UI lists a folder without a manifest as still-preparing (no size yet), and
 * restore/import refuse to read one until its manifest exists.
 */
export async function writeBackupManifest(
  client: SupabaseClient,
  companyId: string,
  name: string,
  manifest: Manifest
): Promise<void> {
  const up = await client.storage
    .from(companyId)
    .upload(backupManifestPath(name), Buffer.from(JSON.stringify(manifest)), {
      contentType: "application/json",
      upsert: true
    });
  if (up.error) throw new Error(`manifest: ${up.error.message}`);
}

/**
 * Gzip one table's rows as NDJSON (one JSON object per line). Streamed, so a huge
 * table never builds a `>512MB` string.
 */
export async function serializeTable(
  rows: Record<string, unknown>[]
): Promise<Buffer> {
  const gzip = createGzip();
  const chunks: Buffer[] = [];
  gzip.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    gzip.on("end", resolve);
    gzip.on("error", reject);
  });
  for (const row of rows) {
    // JSON.stringify leaves U+2028/U+2029 raw; escaped, every line-based
    // reader sees one row per line.
    const line = JSON.stringify(row)
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
    await new Promise<void>((resolve, reject) => {
      gzip.write(`${line}\n`, (err) => (err ? reject(err) : resolve()));
    });
  }
  gzip.end();
  await finished;
  return Buffer.concat(chunks);
}

/**
 * Parse a `tables/<table>.ndjson.gz` into rows. Streams the gunzip line by line,
 * so a huge table is never one giant string nor a single JSON.parse.
 *
 * Splits on "\n" only, the one separator `serializeTable` writes. Not readline:
 * from Node 24 it also ends a line at U+2028/U+2029, which JSON.stringify
 * leaves unescaped, so a row with pasted text was cut mid-string.
 */
export async function deserializeTable(
  bytes: ArrayBuffer
): Promise<Record<string, unknown>[]> {
  const gunzip = createGunzip();
  Readable.from(Buffer.from(bytes)).pipe(gunzip);
  const decoder = new StringDecoder("utf8");
  const rows: Record<string, unknown>[] = [];
  let rest = "";
  for await (const chunk of gunzip) {
    const lines = (rest + decoder.write(chunk as Buffer)).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) if (line) rows.push(JSON.parse(line));
  }
  rest += decoder.end();
  if (rest) rows.push(JSON.parse(rest));
  return rows;
}

/** A restore/import `source` is the backup folder name. Bridge legacy single-gz
 *  sources (`exports/<name>.carbon.json.gz`) to the folder name during the
 *  transition. */
export function backupNameFromSource(source: string): string {
  return source.replace(/^exports\//, "").replace(/\.carbon\.json\.gz$/, "");
}

/**
 * Read a backup folder `exports/<name>/`: its manifest, then every table file in
 * parallel, into the in-memory `CompanyBackup` the load pipeline expects.
 */
export async function readBackup(
  client: SupabaseClient,
  companyId: string,
  name: string
): Promise<CompanyBackup> {
  const mf = await client.storage
    .from(companyId)
    .download(backupManifestPath(name));
  if (mf.error || !mf.data) {
    throw new Error(
      `Failed to download backup manifest ${name}: ${
        mf.error?.message || JSON.stringify(mf.error) || "not found"
      }`
    );
  }
  const manifest = JSON.parse(await mf.data.text()) as Manifest;
  if (manifest.kind !== BACKUP_KIND) {
    throw new Error("Not a Carbon company backup");
  }

  const data: CompanyBackup["data"] = {};
  await mapWithConcurrency(manifest.tables, TABLE_CONCURRENCY, async (t) => {
    const f = await client.storage
      .from(companyId)
      .download(backupTablePath(name, t.name));
    if (f.error || !f.data) {
      throw new Error(
        `Failed to download table ${t.name} for ${name}: ${
          f.error?.message || JSON.stringify(f.error) || "not found"
        }`
      );
    }
    data[t.name] = await deserializeTable(await f.data.arrayBuffer());
  });
  return { manifest, data };
}

/** Convert a pg-returned value into a JSON-safe backup value. */
export function encodeValue(value: unknown, col: ColumnInfo): unknown {
  if (value === null || value === undefined) return null;
  if (col.udtName === "bytea" && Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Convert a backup value into a parameter node-pg can bind for this
 * column. Strings pass through untyped so Postgres coerces them into
 * enums/timestamps/numerics by column type; json(b) values are stringified
 * so JS arrays inside jsonb are not mistaken for Postgres arrays.
 */
export function bindValue(value: unknown, col: ColumnInfo): unknown {
  if (value === null || value === undefined) return null;
  if (col.udtName === "bytea" && typeof value === "string") {
    return Buffer.from(value, "base64");
  }
  if (col.udtName === "json" || col.udtName === "jsonb") {
    return JSON.stringify(value);
  }
  return value;
}
