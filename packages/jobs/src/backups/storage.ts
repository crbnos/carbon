// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyPrivateBucket } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { chunkArray } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapWithConcurrency, TABLE_CONCURRENCY } from "./concurrency";
import {
  BACKUP_KIND,
  backupAssetsDir,
  backupManifestPath,
  backupTablePath,
  type CompanyBackup,
  deserializeTable,
  type Manifest
} from "./format";
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
 * Read a backup folder `exports/<name>/`: its manifest, then every table file in
 * parallel, into the in-memory `CompanyBackup` the load pipeline expects.
 */
export async function readBackup(
  client: SupabaseClient,
  companyId: string,
  name: string
): Promise<CompanyBackup> {
  const mf = await client.storage
    .from(getCompanyPrivateBucket(companyId))
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
      .from(getCompanyPrivateBucket(companyId))
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

/** Upload one table file of a backup being written. */
export async function writeBackupTable(
  client: SupabaseClient,
  companyId: string,
  name: string,
  table: string,
  file: Buffer
): Promise<void> {
  const up = await client.storage
    .from(getCompanyPrivateBucket(companyId))
    .upload(backupTablePath(name, table), file, {
      contentType: "application/gzip",
      upsert: true
    });
  if (up.error) throw new Error(`table ${table}: ${up.error.message}`);
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
    .from(getCompanyPrivateBucket(companyId))
    .upload(backupManifestPath(name), Buffer.from(JSON.stringify(manifest)), {
      contentType: "application/json",
      upsert: true
    });
  if (up.error) throw new Error(`manifest: ${up.error.message}`);
}

/**
 * Delete every file under `prefix` ("" for the whole bucket). Lists the whole
 * folder first, then removes in batches: removing while paging would shift the
 * pages. `strict` throws on a list or remove error, for a caller that must know
 * the files are gone.
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
  // Small requests: storage deletes the rows and the objects in one statement
  // timeout, and each row fires `delete_orphaned_documents`.
  for (const paths of chunkArray(
    files.map((f) => f.path),
    200
  )) {
    const { error } = await client.storage.from(bucket).remove(paths);
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
    /** The backup the files are copied into. */
    name: string;
  },
  onProgress?: (done: number, total: number) => Promise<void>
): Promise<{ copied: number; failed: number }> {
  const { companyId, sourcePaths, name } = args;
  const bucket = getCompanyPrivateBucket(companyId);
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
        srcBucket: bucket,
        srcPath: path,
        destBucket: bucket,
        destPath: `${backupAssetsDir(name)}/${path}`
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
    /** The backup, in the target company's own bucket. */
    name: string;
    sourceCompanyId: string;
    companyId: string;
    idRewrite: Map<string, string>;
  },
  onProgress?: (done: number, total: number) => Promise<void>
): Promise<{ copied: number; failed: number }> {
  const { files, name, sourceCompanyId, companyId, idRewrite } = args;
  const bucket = getCompanyPrivateBucket(companyId);
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
      srcBucket: bucket,
      srcPath: `${backupAssetsDir(name)}/${file.path}`,
      destBucket: bucket,
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
