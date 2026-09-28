import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every file under `prefix` in `bucket`, recursing into folders. `list(prefix)`
 * matches the exact folder, never a sibling that shares the prefix string. At
 * most 1000 entries per folder, so a caller that deletes as it goes can drain a
 * larger folder in repeated passes.
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
  const { data, error } = await client.storage.from(bucket).list(prefix, {
    limit: 1000
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
  return files;
}
