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
