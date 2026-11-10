// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyPrivateBucket } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapWithConcurrency } from "./concurrency";
import { rewriteStoragePath } from "./remap";

const log = getLogger("jobs", "backup-storage");

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

// Asset copies are server-side bucket→bucket (no bytes through this process), so
// they're I/O-bound — run them concurrently rather than one at a time.
const ASSET_COPY_CONCURRENCY = 8;

/**
 * Copy one storage object server-side, overwriting the destination if it already
 * exists. `copy` has no upsert, so on a duplicate we remove the destination and
 * retry — the bytes never pass through this process either way.
 */
async function copyStorageObject(
  client: SupabaseClient,
  args: {
    srcBucket: string;
    srcPath: string;
    destBucket: string;
    destPath: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const { srcBucket, srcPath, destBucket, destPath } = args;
  const run = () =>
    client.storage
      .from(srcBucket)
      .copy(srcPath, destPath, { destinationBucket: destBucket });

  let { error } = await run();
  if (error && /exist|duplicate|409/i.test(error.message)) {
    await client.storage.from(destBucket).remove([destPath]);
    ({ error } = await run());
  }
  return { ok: !error, error: error?.message };
}

/**
 * Copy a company's storage assets (its own bucket, under `{companyId}/`) into
 * a backup's own `.assets/` folder in the same bucket. Server-side —
 * no bytes pass through this process, so a 200MB asset set costs no memory.
 * Best-effort: a per-file failure warns and continues, matching the
 * non-transactional storage semantics of restore/import.
 */
export async function copyAssetsToBackup(
  client: SupabaseClient,
  args: {
    companyId: string;
    sourcePaths: string[];
    destBucket: string;
    destPrefix: string;
  },
  onProgress?: (done: number, total: number) => Promise<void>
): Promise<{ copied: number; failed: number }> {
  const { companyId, sourcePaths, destBucket, destPrefix } = args;
  const srcBucket = getCompanyPrivateBucket(companyId);
  const total = sourcePaths.length;
  let copied = 0;
  let failed = 0;
  let done = 0;
  await mapWithConcurrency(
    sourcePaths,
    ASSET_COPY_CONCURRENCY,
    async (path) => {
      // The bucket comes from the company, never from the path: a path naming
      // another company would otherwise read that company's bucket.
      const { ok, error } = await copyStorageObject(client, {
        srcBucket,
        srcPath: path,
        destBucket,
        destPath: `${destPrefix}/${path}`
      });
      if (ok) {
        copied++;
      } else {
        failed++;
        log.warning("Failed to copy backup asset", { path, error });
      }
      await onProgress?.(++done, total);
    }
  );
  return { copied, failed };
}

/**
 * Copy a backup's stored assets back into the target company's own private
 * bucket, rewriting each path for a foreign/reseed restore (no-op for an own
 * restore). Server-side, best-effort. Every write is guarded to the target
 * company's own `{companyId}/` prefix so a malformed path can never land in
 * another tenant's space.
 */
export async function restoreAssetsFromBackup(
  client: SupabaseClient,
  args: {
    files: Array<{ path: string; included: boolean }>;
    srcBucket: string;
    srcPrefix: string;
    sourceCompanyId: string;
    companyId: string;
    idRewrite: Map<string, string>;
  },
  onProgress?: (done: number, total: number) => Promise<void>
): Promise<{ copied: number; failed: number }> {
  const { files, srcBucket, srcPrefix, sourceCompanyId, companyId, idRewrite } =
    args;
  const included = files.filter((f) => f.included);
  const total = included.length;
  let copied = 0;
  let failed = 0;
  let done = 0;
  await mapWithConcurrency(included, ASSET_COPY_CONCURRENCY, async (file) => {
    const targetPath = rewriteStoragePath(
      file.path,
      sourceCompanyId,
      companyId,
      idRewrite
    );
    if (!targetPath.startsWith(`${companyId}/`)) {
      log.warning("Skipping backup asset outside target company prefix", {
        path: file.path,
        targetPath
      });
      await onProgress?.(++done, total);
      return;
    }
    const { ok, error } = await copyStorageObject(client, {
      srcBucket,
      srcPath: `${srcPrefix}/${file.path}`,
      destBucket: getCompanyPrivateBucket(companyId),
      destPath: targetPath
    });
    if (ok) {
      copied++;
    } else {
      failed++;
      log.warning("Failed to restore backup asset", {
        path: file.path,
        targetPath,
        error
      });
    }
    await onProgress?.(++done, total);
  });
  return { copied, failed };
}
