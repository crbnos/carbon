// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SupabaseClient } from "@supabase/supabase-js";

/** The most entries storage's `list` returns in one call. */
const LIST_PAGE = 1000;

/**
 * Every file under `prefix` in `bucket`, recursing into folders. `list(prefix)`
 * matches the exact folder, never a sibling that shares the prefix string.
 * Pages past storage's 1000 entries per call: a folder with more (a company's
 * thumbnails) was cut short, and a backup silently left the rest out.
 *
 * A listing error reads as "no files" (a backup of a company with no bucket yet),
 * unless `strict`: a caller that must know the folder is really empty, such as a
 * delete, gets the error thrown instead.
 */
export async function listBucketFilesRecursive(
  client: SupabaseClient,
  bucket: string,
  prefix = "",
  { strict = false }: { strict?: boolean } = {}
): Promise<Array<{ path: string; size: number }>> {
  const files: Array<{ path: string; size: number }> = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error && strict) throw error;
    if (error || !data) return files;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        // folder
        files.push(
          ...(await listBucketFilesRecursive(client, bucket, path, { strict }))
        );
      } else {
        files.push({
          path,
          size: (entry.metadata as { size?: number } | null)?.size ?? 0
        });
      }
    }
    if (data.length < LIST_PAGE) return files;
  }
}

/**
 * Delete every file under `prefix` (a backup or snapshot folder). Lists the
 * whole folder first, then removes in batches: removing while paging would
 * shift the pages. `strict` throws on a list or remove error, for a caller
 * that tells the person the backup is gone.
 */
export async function removeBucketPrefix(
  client: SupabaseClient,
  bucket: string,
  prefix: string,
  { strict = false }: { strict?: boolean } = {}
): Promise<void> {
  const files = await listBucketFilesRecursive(client, bucket, prefix, {
    strict
  });
  for (let i = 0; i < files.length; i += LIST_PAGE) {
    const { error } = await client.storage
      .from(bucket)
      .remove(files.slice(i, i + LIST_PAGE).map((f) => f.path));
    if (error && strict) throw error;
  }
}
