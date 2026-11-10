// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createGunzip, createGzip } from "node:zlib";
import type { ColumnInfo } from "./catalog";

/**
 * The backup format: a folder `exports/<name>/` of small objects (each under the
 * bucket size cap) holding `manifest.json`, one `tables/<table>.ndjson.gz` per
 * non-empty table and `assets/<path>` files. Bundled as one `.carbon.tar.gz` for
 * cross-environment download and upload. Tables are written and read a line at
 * a time, so a huge table never becomes one string.
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

export const EXPORTS_PREFIX = "exports";

export type CompanyBackup = {
  manifest: Manifest;
  data: Record<string, Record<string, unknown>[]>;
};

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

/** A new backup's folder name: when it was taken, then a slug of its label. */
export function newBackupName(takenAt: string, label?: string | null): string {
  const slug = label
    ? `_${label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40)}`
    : "";
  return `${takenAt.replace(/[:.]/g, "-")}${slug}`;
}

/** The hidden backup a restore or template run takes before it loads, for a revert. */
export function snapshotName(run: "restore" | "template", runId: string) {
  return `_pre-${run}-${runId}`;
}

/** Snapshots share the backup layout; the Backups page leaves them out. */
export function isSnapshotName(name: string): boolean {
  return name.startsWith("_pre-");
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
