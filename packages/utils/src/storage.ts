/**
 * Company-private storage contract.
 *
 * Private files live in one bucket PER COMPANY (bucket id = companyId).
 * Object paths keep the legacy `${companyId}/...` first segment so paths
 * stored in the database stay valid and the legacy→company copy is same-key.
 *
 * The legacy shared `private` bucket is read-only fallback until the copy
 * script has run everywhere; every fallback lives in this file so removing
 * it later is a one-file change.
 */

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

export type PrivateStorageTarget = {
  physicalBucket: string;
  logicalFolder: string;
  objectPath: string;
};

export const buildCompanyPrivateStorageTarget = ({
  companyId,
  logicalFolder,
  entityId,
  fileName
}: {
  companyId: string;
  logicalFolder: string;
  entityId?: string;
  fileName: string;
}): PrivateStorageTarget => {
  const physicalBucket = getCompanyPrivateBucket(companyId);
  const normalizedLogicalFolder = normalizeStorageSegment(logicalFolder);
  const normalizedEntityId = entityId
    ? normalizeStorageSegment(entityId)
    : undefined;
  const normalizedFileName = normalizeStorageSegment(fileName);

  return {
    physicalBucket,
    logicalFolder: normalizedLogicalFolder,
    objectPath: [
      physicalBucket,
      normalizedLogicalFolder,
      normalizedEntityId,
      normalizedFileName
    ]
      .filter(Boolean)
      .join("/")
  };
};

/**
 * Minimal structural view of `SupabaseClient["storage"]` so this package
 * does not depend on supabase-js. Only the members the helpers use.
 */
export type StorageFileLike = {
  name: string;
  id?: string | null;
};

export type StorageResult<TData> = {
  data: TData | null;
  error: { message?: string } | null;
};

// Method syntax (not property arrows) on purpose: methods get bivariant
// parameter checking, which lets supabase-js's more precisely typed storage
// client satisfy this structural view without casts.
export type StorageBucketLike = {
  download(path: string): Promise<StorageResult<Blob>>;
  createSignedUrl(
    path: string,
    expiresIn: number
  ): Promise<StorageResult<{ signedUrl: string }>>;
  list(
    path?: string,
    options?: Record<string, unknown>
  ): Promise<StorageResult<StorageFileLike[]>>;
  remove(paths: string[]): Promise<StorageResult<StorageFileLike[]>>;
};

export type StorageClientLike = {
  from(bucket: string): StorageBucketLike;
};

export type PrivateBucketAttemptError = {
  bucket: string;
  error: { message?: string } | null;
};

export const downloadCompanyPrivateObject = async ({
  storage,
  companyId,
  objectPath
}: {
  storage: StorageClientLike;
  companyId: string;
  objectPath: string;
}): Promise<{
  data: Blob | null;
  physicalBucket: string | null;
  errors: PrivateBucketAttemptError[];
}> => {
  // Callers often hold a service-role client, where the `${companyId}/` key
  // prefix is the ONLY tenant boundary on the shared legacy bucket — refuse a
  // path outside it before touching storage.
  if (!hasCompanyPrivateObjectPathPrefix(companyId, objectPath)) {
    return {
      data: null,
      physicalBucket: null,
      errors: [
        {
          bucket: LEGACY_PRIVATE_BUCKET,
          error: {
            message: "objectPath is outside the company's storage prefix"
          }
        }
      ]
    };
  }

  const companyBucket = getCompanyPrivateBucket(companyId);
  const errors: PrivateBucketAttemptError[] = [];

  for (const bucket of [companyBucket, LEGACY_PRIVATE_BUCKET]) {
    const result = await storage.from(bucket).download(objectPath);
    if (!result.error && result.data) {
      return { data: result.data, physicalBucket: bucket, errors };
    }
    errors.push({ bucket, error: result.error });
  }

  return { data: null, physicalBucket: null, errors };
};

export const createCompanyPrivateSignedUrl = async ({
  storage,
  companyId,
  objectPath,
  expiresIn
}: {
  storage: StorageClientLike;
  companyId: string;
  objectPath: string;
  expiresIn: number;
}): Promise<{
  signedUrl: string | null;
  physicalBucket: string | null;
  errors: PrivateBucketAttemptError[];
}> => {
  // Same tenant-boundary guard as downloadCompanyPrivateObject.
  if (!hasCompanyPrivateObjectPathPrefix(companyId, objectPath)) {
    return {
      signedUrl: null,
      physicalBucket: null,
      errors: [
        {
          bucket: LEGACY_PRIVATE_BUCKET,
          error: {
            message: "objectPath is outside the company's storage prefix"
          }
        }
      ]
    };
  }

  const companyBucket = getCompanyPrivateBucket(companyId);
  const errors: PrivateBucketAttemptError[] = [];

  for (const bucket of [companyBucket, LEGACY_PRIVATE_BUCKET]) {
    const result = await storage
      .from(bucket)
      .createSignedUrl(objectPath, expiresIn);
    if (!result.error && result.data?.signedUrl) {
      return {
        signedUrl: result.data.signedUrl,
        physicalBucket: bucket,
        errors
      };
    }
    errors.push({ bucket, error: result.error });
  }

  return { signedUrl: null, physicalBucket: null, errors };
};

export const listCompanyPrivateObjects = async ({
  storage,
  companyId,
  prefix,
  options
}: {
  storage: StorageClientLike;
  companyId: string;
  prefix: string;
  options?: Record<string, unknown>;
}): Promise<{
  data: StorageFileLike[];
  errors: PrivateBucketAttemptError[];
}> => {
  const companyBucket = getCompanyPrivateBucket(companyId);
  const errors: PrivateBucketAttemptError[] = [];

  const [companyResult, legacyResult] = await Promise.all([
    storage.from(companyBucket).list(prefix, options),
    storage.from(LEGACY_PRIVATE_BUCKET).list(prefix, options)
  ]);

  if (companyResult.error) {
    errors.push({ bucket: companyBucket, error: companyResult.error });
  }
  if (legacyResult.error) {
    errors.push({ bucket: LEGACY_PRIVATE_BUCKET, error: legacyResult.error });
  }

  const byName = new Map<string, StorageFileLike>();
  for (const file of legacyResult.data ?? []) {
    byName.set(file.name, file);
  }
  for (const file of companyResult.data ?? []) {
    byName.set(file.name, file);
  }

  return { data: Array.from(byName.values()), errors };
};

/**
 * During the fallback window a file exists in exactly one bucket (or both
 * after the copy script), so a delete must hit both. A miss on either bucket
 * is not an error — supabase `remove` returns an empty data array for
 * missing keys rather than failing, and a real failure sets `error`.
 */
export const removeCompanyPrivateObjects = async ({
  storage,
  companyId,
  objectPaths
}: {
  storage: StorageClientLike;
  companyId: string;
  objectPaths: string[];
}): Promise<{ errors: PrivateBucketAttemptError[] }> => {
  const companyBucket = getCompanyPrivateBucket(companyId);
  const errors: PrivateBucketAttemptError[] = [];

  const [companyResult, legacyResult] = await Promise.all([
    storage.from(companyBucket).remove(objectPaths),
    storage.from(LEGACY_PRIVATE_BUCKET).remove(objectPaths)
  ]);

  if (companyResult.error) {
    errors.push({ bucket: companyBucket, error: companyResult.error });
  }
  if (legacyResult.error) {
    errors.push({ bucket: LEGACY_PRIVATE_BUCKET, error: legacyResult.error });
  }

  return { errors };
};
