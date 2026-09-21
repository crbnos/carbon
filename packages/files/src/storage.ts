/**
 * Company-private storage.
 *
 * Private files live in one bucket PER COMPANY (bucket id = companyId).
 * Object keys keep the legacy `${companyId}/...` first segment so paths
 * stored in the database stay valid and the legacy→company copy is same-key.
 *
 * The legacy shared `private` bucket is a read-only fallback until the copy
 * script has run everywhere; every fallback lives in this file so removing
 * it later is a one-file change.
 *
 *   const { data, error } = await storage(client).company(companyId).download(path);
 *   await storage(client).company(companyId).upload(path, file, { upsert: true });
 *   await storage(client).from("public").upload(path, file);
 */

import {
  type DownloadResult,
  type SearchOptions,
  type StorageClient,
  StorageError,
  type TransformOptions
} from "@supabase/storage-js";

export const LEGACY_PRIVATE_BUCKET = "private";
export const COMPANY_BUCKET_FILE_SIZE_LIMIT = 52428800; // 50 MB

export const normalizeStorageSegment = (value: string) =>
  value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");

export const getCompanyPrivateBucket = (companyId: string) => {
  const bucket = normalizeStorageSegment(companyId);
  if (!bucket) {
    // `.from("")` would silently probe a non-existent bucket and fall through
    // to whatever fallback the caller has — refuse loudly instead.
    throw new Error(
      "companyId is required to resolve a company private bucket"
    );
  }
  return bucket;
};

export const hasCompanyPrivateObjectPathPrefix = (
  companyId: string,
  objectPath: string
) => {
  const bucket = normalizeStorageSegment(companyId);
  return bucket ? objectPath.startsWith(`${bucket}/`) : false;
};

type Bucket = ReturnType<StorageClient["from"]>;

/**
 * A company's private bucket with the supabase `StorageFileApi` shape. Writes
 * go to the company bucket only; reads fall back to the legacy bucket; `list`
 * unions both and `remove` deletes from both. Every key must sit under
 * `${companyId}/` — under a service-role client that prefix is the only
 * tenant boundary on the shared legacy bucket, and a company bucket must never
 * hold a key that `getPrivateUrl` would resolve to another company's bucket.
 *
 * Deliberately absent: `getPublicUrl` (private bucket), `createSignedUrls`
 * and `listV2` (batch shapes with no single fallback answer). Use `.from()`
 * if one is ever needed.
 */
export type CompanyBucket = {
  upload: Bucket["upload"];
  update: Bucket["update"];
  uploadToSignedUrl: Bucket["uploadToSignedUrl"];
  move: Bucket["move"];
  copy: Bucket["copy"];
  createSignedUploadUrl: Bucket["createSignedUploadUrl"];
  exists: Bucket["exists"];
  info: Bucket["info"];
  download(
    path: string,
    options?: { transform?: TransformOptions }
  ): Promise<DownloadResult<Blob>>;
  createSignedUrl: Bucket["createSignedUrl"];
  list(prefix: string, options?: SearchOptions): ReturnType<Bucket["list"]>;
  remove: Bucket["remove"];
};

export type CarbonStorage = {
  /** Any other bucket (`public`, `temp-staging`, …) — plain supabase. */
  from(bucket: string): Bucket;
  company(companyId: string): CompanyBucket;
};

export function storage(client: { storage: StorageClient }): CarbonStorage {
  return {
    from: (bucket) => client.storage.from(bucket),
    company: (companyId) => companyBucket(client.storage, companyId)
  };
}

function companyBucket(
  storage: StorageClient,
  companyId: string
): CompanyBucket {
  const id = getCompanyPrivateBucket(companyId);
  const own = storage.from(id);
  const legacy = storage.from(LEGACY_PRIVATE_BUCKET);

  const owned = (path: string) =>
    hasCompanyPrivateObjectPathPrefix(companyId, path);
  const owns = (...paths: string[]) => paths.every(owned);
  const refuse = (...paths: string[]) =>
    Promise.resolve({
      data: null,
      error: new StorageError(
        `${paths.filter((path) => !owned(path)).join(", ")} is outside the "${id}/" storage prefix`
      )
    });

  // Company bucket first, legacy second; when both miss, the company bucket's
  // error is the one reported since that is where the file belongs.
  const withFallback = async <R extends { error: unknown }>(
    read: (bucket: Bucket) => PromiseLike<R>
  ) => {
    const primary = await read(own);
    if (!primary.error) return primary;
    const fallback = await read(legacy);
    return fallback.error ? primary : fallback;
  };

  return {
    upload: (path, ...rest) =>
      owns(path) ? own.upload(path, ...rest) : refuse(path),
    update: (path, ...rest) =>
      owns(path) ? own.update(path, ...rest) : refuse(path),
    uploadToSignedUrl: (path, ...rest) =>
      owns(path) ? own.uploadToSignedUrl(path, ...rest) : refuse(path),
    move: (from, to, options) =>
      owns(from, to) ? own.move(from, to, options) : refuse(from, to),
    copy: (from, to, options) =>
      owns(from, to) ? own.copy(from, to, options) : refuse(from, to),
    createSignedUploadUrl: (path, options) =>
      owns(path) ? own.createSignedUploadUrl(path, options) : refuse(path),

    exists: (path) =>
      owns(path)
        ? withFallback((b) => b.exists(path))
        : refuse(path).then(({ error }) => ({ data: false, error })),
    info: (path) =>
      owns(path) ? withFallback((b) => b.info(path)) : refuse(path),
    download: (path, options) =>
      owns(path)
        ? withFallback((b) => b.download(path, options))
        : refuse(path),
    createSignedUrl: (path, expiresIn, options) =>
      owns(path)
        ? withFallback((b) => b.createSignedUrl(path, expiresIn, options))
        : refuse(path),

    list: async (prefix, options) => {
      if (!owns(prefix)) return refuse(prefix);
      const [primary, fallback] = await Promise.all([
        own.list(prefix, options),
        legacy.list(prefix, options)
      ]);
      if (primary.error && fallback.error) return primary;
      // Union by name with the company copy winning: during the fallback
      // window a file sits in either bucket, after the copy script in both.
      const byName = new Map((fallback.data ?? []).map((f) => [f.name, f]));
      for (const f of primary.data ?? []) byName.set(f.name, f);
      return { data: [...byName.values()], error: null };
    },

    remove: async (paths) => {
      if (!owns(...paths)) return refuse(...paths);
      const [primary, fallback] = await Promise.all([
        own.remove(paths),
        legacy.remove(paths)
      ]);
      // A miss is not an error (supabase returns an empty array), so any
      // error is a real failure — and a file left behind in the legacy bucket
      // would still be readable through the fallback.
      if (primary.error) return primary;
      if (fallback.error) return fallback;
      return { data: [...primary.data, ...fallback.data], error: null };
    }
  };
}
