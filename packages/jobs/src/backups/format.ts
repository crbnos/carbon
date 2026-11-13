// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createGunzip, createGzip } from "node:zlib";
import { type RawBuilder, sql } from "kysely";
import { z } from "zod";
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

const manifestSchema = z.object({
  kind: z.literal(BACKUP_KIND),
  // Any generation parses: `reportBackupCompatibility` names an unsupported one.
  version: z.number().int(),
  schemaVersion: z.string(),
  sourceCompanyId: z.string(),
  sourceCompanyGroupId: z.string().nullable(),
  sourceCompanyName: z.string().nullable(),
  exportedAt: z.string(),
  exportedBy: z.string(),
  label: z.string().nullable(),
  includeStorage: z.enum(["none", "all"]),
  tables: z.array(
    z.object({
      name: z.string(),
      rows: z.number().int().nonnegative(),
      columns: z.array(z.string()),
      /** Files the table is split across (`backupTablePath`). Absent = 1. */
      parts: z.number().int().positive().optional()
    })
  ),
  storage: z.array(
    z.object({ path: z.string(), size: z.number(), included: z.boolean() })
  ),
  excludedTables: z.array(z.string()),
  /**
   * Rows deliberately left out because a NOT-NULL FK escaped company scope
   * ("violation") or pointed at such a row ("cascade"). Absent/empty = full
   * export. Written only when the export ran with `skipCorrupted`.
   */
  excludedRows: z
    .array(
      z.object({
        table: z.string(),
        column: z.string(),
        refTable: z.string(),
        rows: z.number(),
        cause: z.enum(["violation", "cascade"])
      })
    )
    .optional(),
  /**
   * DISTINCT rows excluded, per table. `excludedRows` is per FK EDGE and
   * double-counts a row that violated several of its foreign keys, so this is
   * the only field a total may be summed from. Absent on backups taken before
   * it existed — treat as "unknown", not zero.
   */
  excludedRowsByTable: z
    .array(z.object({ table: z.string(), rows: z.number() }))
    .optional()
});

export type Manifest = z.infer<typeof manifestSchema>;

/**
 * A `manifest.json`'s text as a manifest, or null when it is not one. An
 * uploaded archive's manifest is user-supplied, so nothing reads it unchecked.
 */
export function parseManifest(text: string): Manifest | null {
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const EXPORTS_PREFIX = "exports";

export type Row = Record<string, unknown>;

/** Rows per batch when a table is read or written. */
export const ROW_BATCH = 2000;

export type CompanyBackup = {
  manifest: Manifest;
  /**
   * One table's rows in batches, under today's table and column names. Each
   * call reads the table again, so no caller holds a whole backup in memory.
   */
  rows(table: string): AsyncIterable<Row[]>;
};

/** A table's row count as the manifest records it: 0 when it has none. */
export function tableRows(
  backup: { manifest: Manifest },
  table: string
): number {
  return backup.manifest.tables.find((t) => t.name === table)?.rows ?? 0;
}

/** A backup whose rows are already in memory (tests, and small sources). */
export function backupFromRows(
  manifest: Manifest,
  data: Record<string, Row[]>
): CompanyBackup {
  return {
    manifest,
    async *rows(table) {
      const rows = data[table];
      if (rows?.length) yield rows;
    }
  };
}

/** Every row of one table. Only for tables known to be small. */
export async function collectRows(
  backup: CompanyBackup,
  table: string
): Promise<Row[]> {
  const all: Row[] = [];
  for await (const batch of backup.rows(table)) {
    for (const row of batch) all.push(row);
  }
  return all;
}

export function backupDir(name: string): string {
  return `${EXPORTS_PREFIX}/${name}`;
}

export function backupManifestPath(name: string): string {
  return `${EXPORTS_PREFIX}/${name}/manifest.json`;
}

/** Part 0 keeps the one-file layout; a table split past it adds `.<part>`. */
export function backupTablePath(name: string, table: string, part = 0): string {
  const suffix = part === 0 ? "" : `.${part}`;
  return `${EXPORTS_PREFIX}/${name}/tables/${table}${suffix}.ndjson.gz`;
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
 * A table written as gzipped NDJSON, one batch of rows at a time. Only the
 * compressed bytes are kept, never the rows or one big string.
 */
export function tableWriter() {
  const gzip = createGzip();
  const chunks: Buffer[] = [];
  let bytes = 0;
  gzip.on("data", (c: Buffer) => {
    chunks.push(c);
    bytes += c.length;
  });
  const finished = new Promise<void>((resolve, reject) => {
    gzip.on("end", resolve);
    gzip.on("error", reject);
  });
  return {
    /** Compressed bytes so far, short of what zlib still buffers (a few KB). */
    get bytes() {
      return bytes;
    },
    async write(rows: Row[]) {
      let text = "";
      for (const row of rows) {
        // JSON.stringify leaves U+2028/U+2029 raw; escaped, every line-based
        // reader sees one row per line.
        text += `${JSON.stringify(row)
          .replaceAll("\u2028", "\\u2028")
          .replaceAll("\u2029", "\\u2029")}\n`;
      }
      await new Promise<void>((resolve, reject) => {
        gzip.write(text, (err) => (err ? reject(err) : resolve()));
      });
    },
    async finish(): Promise<Buffer> {
      gzip.end();
      await finished;
      return Buffer.concat(chunks);
    }
  };
}

/**
 * The longest row a table file may hold. A real row is kilobytes; this is far
 * past any of them and far below V8's ~512M-char string limit.
 */
const MAX_LINE_CHARS = 64 * 1024 * 1024;

/**
 * The most one table file may decompress to. A file is at most 50MB (the
 * bucket's object cap; the export splits a table at ~40MB), and NDJSON rows
 * compress 5-20x, so 4GiB is a ratio no real table reaches. Past it the file
 * is a decompression bomb, not a table.
 */
const MAX_TABLE_FILE_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * Parse a gzipped NDJSON table in batches, as the bytes arrive. Memory stays
 * at one batch plus one line, whatever the file holds.
 *
 * Splits on "\n" only, the one separator `tableWriter` writes. Not readline:
 * from Node 24 it also ends a line at U+2028/U+2029, which JSON.stringify
 * leaves unescaped, so a row with pasted text was cut mid-string.
 */
export async function* readTableRows(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  batchSize = ROW_BATCH,
  limits = { lineChars: MAX_LINE_CHARS, bytes: MAX_TABLE_FILE_BYTES }
): AsyncGenerator<Row[]> {
  const input = Readable.from(source);
  const gunzip = createGunzip();
  input.on("error", (err) => gunzip.destroy(err));
  input.pipe(gunzip);
  const decoder = new StringDecoder("utf8");
  let batch: Row[] = [];
  // The line still being read, in pieces: joining it to each new chunk
  // re-copied it every time a long line spanned many chunks.
  let pending: string[] = [];
  let pendingChars = 0;
  let bytes = 0;
  const tooLong = () =>
    new Error(
      `A backup table file holds a line over ${limits.lineChars} characters — the file is damaged or not a backup table.`
    );
  try {
    for await (const chunk of gunzip) {
      bytes += (chunk as Buffer).length;
      if (bytes > limits.bytes) {
        throw new Error(
          `A backup table file decompresses to over ${limits.bytes} bytes — the file is damaged or not a backup table.`
        );
      }
      const text = decoder.write(chunk as Buffer);
      let start = 0;
      for (
        let nl = text.indexOf("\n");
        nl !== -1;
        nl = text.indexOf("\n", start)
      ) {
        let line = text.slice(start, nl);
        start = nl + 1;
        if (pending.length > 0) {
          pendingChars += line.length;
          if (pendingChars > limits.lineChars) throw tooLong();
          pending.push(line);
          line = pending.join("");
          pending = [];
          pendingChars = 0;
        } else if (line.length > limits.lineChars) {
          throw tooLong();
        }
        if (!line) continue;
        batch.push(JSON.parse(line));
        if (batch.length >= batchSize) {
          yield batch;
          batch = [];
        }
      }
      if (start < text.length) {
        pending.push(text.slice(start));
        pendingChars += text.length - start;
        if (pendingChars > limits.lineChars) throw tooLong();
      }
    }
    pending.push(decoder.end());
    const last = pending.join("");
    if (last) batch.push(JSON.parse(last));
    if (batch.length > 0) yield batch;
  } finally {
    input.destroy();
    gunzip.destroy();
  }
}

/**
 * Element types node-pg parses into a value that writes back exactly. Every
 * other column is read as text: the process-global parsers turn NUMERIC into
 * a float, timestamps into a millisecond `Date` (and a timestamp without zone
 * through the process's time zone), and an interval into an object no insert
 * can bind. Text, bound untyped, is cast back by the column on insert.
 */
const PARSED_EXACTLY = new Set([
  "text",
  "varchar",
  "uuid",
  "bool",
  "int2",
  "int4",
  "float4",
  "float8",
  "json",
  "jsonb",
  "bytea"
]);

/** Arrays kept as parsed: the remap rewrites ids inside text and uuid arrays. */
const ARRAYS_PARSED_EXACTLY = new Set(["_text", "_varchar", "_uuid"]);

/** A column as the export selects it, under its own name. */
export function exportColumn(col: ColumnInfo): RawBuilder<unknown> {
  const id = sql.id(col.name);
  if (col.udtName.startsWith("_")) {
    return ARRAYS_PARSED_EXACTLY.has(col.udtName)
      ? id
      : sql`${id}::text[] AS ${id}`;
  }
  return PARSED_EXACTLY.has(col.udtName) ? id : sql`${id}::text AS ${id}`;
}

/** Convert a pg-returned value into a JSON-safe backup value. */
export function encodeValue(value: unknown, col: ColumnInfo): unknown {
  if (value === null || value === undefined) return null;
  if (col.udtName === "bytea" && Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
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
