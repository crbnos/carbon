// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Kysely, sql } from "kysely";
import type { KyselyDatabase } from "./client.ts";

/**
 * Which bucket holds each of `names`, from storage's own table: the first of
 * `buckets` that has the object. One indexed query, where probing each bucket
 * over the storage API was an HTTP call per bucket per name. A name in none of
 * the buckets is absent from the map.
 */
export async function findStorageObjectBuckets(
  db: Kysely<KyselyDatabase>,
  { names, buckets }: { names: string[]; buckets: string[] }
): Promise<Map<string, string>> {
  if (names.length === 0 || buckets.length === 0) return new Map();
  const { rows } = await sql<{ name: string; bucket_id: string }>`
    SELECT DISTINCT ON (name) name, bucket_id
    FROM storage.objects
    WHERE bucket_id = ANY(${buckets}::text[])
      AND name = ANY(${names}::text[])
    ORDER BY name, array_position(${buckets}::text[], bucket_id)
  `.execute(db);
  return new Map(rows.map((row) => [row.name, row.bucket_id]));
}

/**
 * The files directly inside each of `folders` in `bucket`, with their sizes, in
 * one query: what a storage `list` per folder returns, without a call per
 * folder. Storage's `.emptyFolderPlaceholder` objects are left out. `size` is
 * null when the object's metadata has none.
 */
export async function listStorageObjects(
  db: Kysely<KyselyDatabase>,
  { bucket, folders }: { bucket: string; folders: string[] }
): Promise<
  { folder: string; name: string; path: string; size: number | null }[]
> {
  if (folders.length === 0) return [];
  const { rows } = await sql<{
    folder: string;
    path: string;
    size: string | null;
  }>`
    SELECT
      regexp_replace(name, '/[^/]*$', '') AS folder,
      name AS path,
      metadata->>'size' AS size
    FROM storage.objects
    WHERE bucket_id = ${bucket}
      AND name LIKE ANY(${folders.map((folder) => `${folder}/%`)}::text[])
      AND regexp_replace(name, '/[^/]*$', '') = ANY(${folders}::text[])
      AND name NOT LIKE '%/.emptyFolderPlaceholder'
    ORDER BY name
  `.execute(db);
  return rows.map((row) => ({
    folder: row.folder,
    name: row.path.slice(row.folder.length + 1),
    path: row.path,
    size: row.size === null ? null : Number(row.size)
  }));
}
