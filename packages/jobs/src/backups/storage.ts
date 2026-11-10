// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyPrivateBucket, isStorageNotFound } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { async, chunkArray } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BACKUP_KIND,
  backupAssetsDir,
  backupManifestPath,
  backupTablePath,
  type CompanyBackup,
  EXPORTS_PREFIX,
  isSnapshotName,
  type Manifest,
  readTableRows
} from "./format";
import { rewriteStoragePath } from "./remap";

const log = getLogger("jobs", "backup-storage");

/** The most entries storage's `list` returns in one call. */
const LIST_PAGE = 1000;

/**
 * Every file under `prefix` in the company's bucket, recursing into folders.
 * `list(prefix)` matches the exact folder, never a sibling that shares the
 * prefix string. Pages past storage's 1000 entries per call: a folder with more
 * (a company's thumbnails) was cut short, and a backup silently left the rest
 * out. A bucket not created yet holds no files; any other listing error throws,
 * so a cut-short list never passes for a complete one.
 */
export async function listCompanyFiles(
  client: SupabaseClient,
  companyId: string,
  prefix = ""
): Promise<Array<{ path: string; size: number }>> {
  return listFolder(client, getCompanyPrivateBucket(companyId), prefix);
}

async function listFolder(
  client: SupabaseClient,
  bucket: string,
  prefix: string
): Promise<Array<{ path: string; size: number }>> {
  const files: Array<{ path: string; size: number }> = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) {
      if (await isStorageNotFound(error)) return files;
      throw error;
    }

    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        files.push(...(await listFolder(client, bucket, path)));
      } else {
        files.push({
          path,
          size: (entry.metadata as { size?: number } | null)?.size ?? 0
        });
      }
    }
    if ((data?.length ?? 0) < LIST_PAGE) return files;
  }
}

/**
 * Open a backup folder `exports/<name>/`: its manifest now, each table only when
 * a caller asks for its rows, streamed straight from storage.
 */
export async function readBackup(
  client: SupabaseClient,
  companyId: string,
  name: string
): Promise<CompanyBackup> {
  const bucket = getCompanyPrivateBucket(companyId);
  const mf = await client.storage
    .from(bucket)
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
  const stored = new Set(manifest.tables.map((t) => t.name));

  return {
    manifest,
    async *rows(table) {
      if (!stored.has(table)) return;
      const f = await client.storage
        .from(bucket)
        .download(backupTablePath(name, table))
        .asStream();
      if (f.error || !f.data) {
        throw new Error(
          `Failed to download table ${table} for ${name}: ${
            f.error?.message || JSON.stringify(f.error) || "not found"
          }`
        );
      }
      yield* readTableRows(f.data as unknown as AsyncIterable<Uint8Array>);
    }
  };
}

/**
 * The company's backups, newest first, each with its manifest: null while the
 * export is still writing the folder, or when the manifest is unreadable, so it
 * still lists and can be deleted. Snapshots are left out. A failed download
 * other than "not found" throws, so a good backup is never shown as unfinished.
 */
export async function listBackups(
  client: SupabaseClient,
  companyId: string
): Promise<Array<{ name: string; manifest: Manifest | null }>> {
  const bucket = client.storage.from(getCompanyPrivateBucket(companyId));
  const names: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(EXPORTS_PREFIX, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: "name", order: "desc" }
    });
    if (error) throw error;
    for (const entry of data ?? []) {
      if (entry.id === null && !isSnapshotName(entry.name)) {
        names.push(entry.name);
      }
    }
    if ((data?.length ?? 0) < LIST_PAGE) break;
  }

  return async.map(
    names,
    async (name) => {
      const mf = await bucket.download(backupManifestPath(name));
      if (mf.error) {
        if (await isStorageNotFound(mf.error)) return { name, manifest: null };
        throw mf.error;
      }
      try {
        return { name, manifest: JSON.parse(await mf.data.text()) as Manifest };
      } catch {
        return { name, manifest: null };
      }
    },
    { concurrency: ASSET_COPY_CONCURRENCY }
  );
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
 * Delete every file under `prefix` of the company's bucket ("" for all of it).
 * Lists the whole folder first, then removes in batches: removing while paging
 * would shift the pages. Throws on any error, so a caller knows the files are gone.
 */
export async function deleteCompanyFiles(
  client: SupabaseClient,
  companyId: string,
  prefix: string
): Promise<void> {
  const files = await listFolder(
    client,
    getCompanyPrivateBucket(companyId),
    prefix
  );
  await removeCompanyPaths(
    client,
    companyId,
    files.map((f) => f.path)
  );
}

/** Delete exactly these paths from the company's bucket. */
export async function removeCompanyPaths(
  client: SupabaseClient,
  companyId: string,
  paths: string[]
): Promise<void> {
  const bucket = getCompanyPrivateBucket(companyId);
  // Small requests: storage deletes the rows and the objects in one statement
  // timeout, and each row fires `delete_orphaned_documents`.
  for (const batch of chunkArray(paths, 200)) {
    const { error } = await client.storage.from(bucket).remove(batch);
    if (error) throw error;
  }
}

// Asset copies are server-side bucket→bucket (no bytes through this process), so
// they're I/O-bound — run them concurrently rather than one at a time.
const ASSET_COPY_CONCURRENCY = 8;

/**
 * Copy one storage object server-side, overwriting the destination in place
 * (`x-upsert`). Never remove-then-copy: deleting a storage object fires the
 * `delete_orphaned_documents` trigger, which drops the `document` row for that
 * path — the row a restore has just loaded.
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
  const { error } = await client.storage
    .from(srcBucket)
    .setHeader("x-upsert", "true")
    .copy(srcPath, destPath, { destinationBucket: destBucket });
  return { ok: !error, error: error?.message };
}

/**
 * Copy a company's storage assets (its own bucket, under `{companyId}/`) into
 * a backup's own `assets/` folder in the same bucket. Server-side —
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
  await async.map(
    sourcePaths,
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
    },
    { concurrency: ASSET_COPY_CONCURRENCY }
  );
  return { copied, failed };
}

/**
 * Copy a backup's stored assets back into the target company's own private
 * bucket, rewriting each path for a foreign restore or an import (no-op for an
 * own restore). Server-side, best-effort. Every write is guarded to the target
 * company's own `{companyId}/` prefix so a malformed path can never land in
 * another tenant's space.
 */
/**
 * Where a backup's included files land in the target company: the paths a
 * restore writes (those outside `{companyId}/` it then skips).
 */
export function assetTargets(args: {
  files: Array<{ path: string; included: boolean }>;
  sourceCompanyId: string;
  companyId: string;
  idRewrite: Map<string, string>;
}): Array<{ source: string; target: string }> {
  const { files, sourceCompanyId, companyId, idRewrite } = args;
  return files
    .filter((f) => f.included)
    .map((f) => ({
      source: f.path,
      target: rewriteStoragePath(f.path, sourceCompanyId, companyId, idRewrite)
    }));
}

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
  const { name, companyId } = args;
  const bucket = getCompanyPrivateBucket(companyId);
  const targets = assetTargets(args);
  const total = targets.length;
  let copied = 0;
  let failed = 0;
  let done = 0;
  await async.map(
    targets,
    async ({ source, target: targetPath }) => {
      if (!targetPath.startsWith(`${companyId}/`)) {
        log.warning("Skipping backup asset outside target company prefix", {
          path: source,
          targetPath
        });
        await onProgress?.(++done, total);
        return;
      }
      const { ok, error } = await copyStorageObject(client, {
        srcBucket: bucket,
        srcPath: `${backupAssetsDir(name)}/${source}`,
        destBucket: bucket,
        destPath: targetPath
      });
      if (ok) {
        copied++;
      } else {
        failed++;
        log.warning("Failed to restore backup asset", {
          path: source,
          targetPath,
          error
        });
      }
      await onProgress?.(++done, total);
    },
    { concurrency: ASSET_COPY_CONCURRENCY }
  );
  return { copied, failed };
}
