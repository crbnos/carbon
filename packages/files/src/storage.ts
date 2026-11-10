// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Company-private storage.
 *
 * Private files live in one bucket PER COMPANY (bucket id = companyId).
 * Object keys keep the `${companyId}/...` first segment, so a stored path
 * names its own bucket.
 *
 *   const { data, error } = await storage(client).company(companyId).download(path);
 *   await storage(client).company(companyId).upload(path, file, { upsert: true });
 *   await storage(client).from("public").upload(path, file);
 */

import {
  type DownloadResult,
  type FileObject,
  type SearchV2Result,
  type StorageClient,
  StorageError,
  type TransformOptions
} from "@supabase/storage-js";

/**
 * The URL segment `/file/preview/private/<path>` — a stored link format
 * (rich text, inspection documents) that the preview routes serve from the
 * caller's own company bucket. The shared `private` bucket it once named no
 * longer exists.
 */
export const PRIVATE_PREVIEW_ALIAS = "private";
// Ephemeral staging for uploads too big for a company bucket's per-object cap
// (raw CAD, backup archives). 2.5 GB cap; stale objects are pruned by the
// scheduled cleanup job. Object keys start with the companyId segment.
export const TEMP_STAGING_BUCKET = "temp-staging";
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

// A well-formed key stops changing after one decode (a key cannot hold a
// literal `%`), so anything still decoding after this many passes is refused.
const MAX_STORAGE_PATH_DECODES = 4;

const isDotSegment = (segment: string) => segment === "." || segment === "..";

const hasUnsafeStorageSyntax = (path: string) => {
  if (/[\\?#]/.test(path)) return true;
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return path.split("/").some(isDotSegment);
};

/**
 * True when an object key could resolve somewhere other than where its text
 * says. storage-js puts the key into the request URL UNENCODED, and the WHATWG
 * URL parser resolves `.` / `..` segments (percent-encoded `%2e` too), reads
 * `\` as `/`, strips tabs and newlines, and ends the path at `?` / `#`. Any of
 * those lets a key pass a `${companyId}/` prefix check and then read or write
 * another company's object — or another bucket.
 *
 * The key is checked as given and after every decode until it stops changing,
 * so single- and double-encoded traversal (`%2e%2e`, `%252e%252e`) is caught
 * wherever a caller sits in the decode chain. A malformed escape is refused:
 * storage never accepts a key containing a literal `%`.
 */
export function isUnsafeStoragePath(path: string): boolean {
  let current = path;
  for (let pass = 0; pass <= MAX_STORAGE_PATH_DECODES; pass++) {
    if (hasUnsafeStorageSyntax(current)) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return true;
    }
    if (decoded === current) return false;
    current = decoded;
  }
  return true;
}

/**
 * A caller-supplied file name made safe to use as the LAST segment of an
 * object key: the basename only (anything before a `/` or `\` is dropped),
 * trimmed, with `?`, `#` and `%` removed ("Drawing #3.pdf" → "Drawing 3.pdf",
 * the same result `stripSpecialCharacters` gives). Null when nothing usable is
 * left or the name fails `isUnsafeStoragePath`.
 */
export function safeStorageFileName(name: string): string | null {
  // `?` / `#` would end the key at that character and `%` would be decoded
  // into a different key, so they are dropped rather than refusing the upload.
  const base = (name.split(/[/\\]/).pop() ?? "")
    .replace(/[?#%]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!base || isUnsafeStoragePath(base)) return null;
  return base;
}

type Bucket = ReturnType<StorageClient["from"]>;

/**
 * A company's private bucket with the supabase `StorageFileApi` shape. Every
 * key must sit under `${companyId}/`: a company bucket must never hold a key
 * that `getPrivateUrl` would resolve to another company's bucket.
 *
 * `list(folder)` returns EVERY entry directly inside the folder, sorted by
 * name, in the shape the old list endpoint used (a sub-folder is an entry with
 * a null `id`). It takes no options — it reads the cursor-paged list endpoint
 * to the end, so there is no limit or offset to pass.
 *
 * Deliberately absent: `getPublicUrl` (private bucket) and `createSignedUrls`.
 * Use `.from()` if one is ever needed.
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
  list(folder: string): ReturnType<Bucket["list"]>;
  remove(paths: string[]): ReturnType<Bucket["remove"]>;
};

export type CarbonStorage = {
  /** Any other bucket (`public`, `temp-staging`, …) — plain supabase. */
  from(bucket: string): Bucket;
  company(companyId: string): CompanyBucket;
};

/**
 * What to say when a storage image transform fails. Storage hands transforms
 * to imgproxy, and when that service is not running the failure names it
 * (`getaddrinfo ENOTFOUND imgproxy`) — a stack problem, not a bad image, and
 * the local dev stack leaves imgproxy off by default. Anything else gets the
 * caller's own message.
 */
export function imageTransformErrorMessage(
  error: unknown,
  fallback: string
): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && /imgproxy/i.test(message)
    ? "Image transformation is unavailable: storage cannot reach imgproxy. On the local dev stack, start it with `crbn reload imgproxy` or boot with `crbn up --full`."
    : fallback;
}

/**
 * The HTTP status behind a storage error. `download()` skips reading the
 * error body, so a 400/404 arrives as `StorageUnknownError("{}")` with the
 * status only on the raw response in `originalError`.
 */
export function storageErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { status, originalError } = error as {
    status?: unknown;
    originalError?: { status?: unknown };
  };
  if (typeof status === "number") return status;
  return typeof originalError?.status === "number"
    ? originalError.status
    : undefined;
}

/**
 * Whether a storage error means the object (or bucket) is not there. Storage
 * answers a miss with HTTP 400 and `"statusCode":"404"` in the body, the same
 * status it uses for an invalid key or request — so a 400 counts only when
 * its body says 404. `download()` never reads that body, so it is still
 * unread on `originalError`.
 */
export async function isStorageNotFound(error: unknown): Promise<boolean> {
  if (!error || typeof error !== "object") return false;
  const { statusCode, originalError } = error as {
    statusCode?: unknown;
    originalError?: unknown;
  };
  if (statusCode === "404" || storageErrorStatus(error) === 404) return true;
  if (!(originalError instanceof Response) || originalError.status !== 400) {
    return false;
  }
  const body = await originalError
    .clone()
    .json()
    .catch(() => null);
  return body?.statusCode === "404";
}

const lastSegment = (path: string) =>
  path.replace(/\/+$/, "").split("/").pop() ?? "";

// What the old endpoint returned for a folder, and every caller checks:
// the paged endpoint gives a folder only its name and key.
const FOLDER_FIELDS = {
  id: null,
  updated_at: null,
  created_at: null,
  last_accessed_at: null,
  metadata: null
};

type ListedEntry =
  | (SearchV2Result["folders"][number] & typeof FOLDER_FIELDS)
  | SearchV2Result["objects"][number];

/**
 * The cursor-paged endpoint names an entry by its full key; callers expect the
 * old endpoint's shape, where `name` is the entry's own name inside the folder.
 */
function toFileObjects(entries: ListedEntry[]): FileObject[] {
  return entries.map((entry) => ({
    ...entry,
    name: lastSegment(entry.key ?? entry.name)
  })) as unknown as FileObject[];
}

/** Everything directly inside `prefix`, read to the last page. */
async function listFolder(bucket: Bucket, prefix: string) {
  const entries: ListedEntry[] = [];
  let cursor: string | undefined;
  do {
    const { data, error } = await bucket.listV2({
      prefix,
      with_delimiter: true,
      cursor
    });
    if (error) return { data: null, error };
    entries.push(
      ...data.folders.map((folder) => ({ ...FOLDER_FIELDS, ...folder })),
      ...data.objects
    );
    if (!data.hasNext) break;
    // More pages promised with no way to reach them: a repeated cursor would
    // loop forever, a missing one would pass a partial list off as complete.
    if (!data.nextCursor || data.nextCursor === cursor) {
      return {
        data: null,
        error: new StorageError(`Listing "${prefix}" did not advance`)
      };
    }
    cursor = data.nextCursor;
  } while (cursor);
  const files = toFileObjects(entries).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  return { data: files, error: null };
}

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

  // The prefix is only a boundary if the key cannot climb out of it. Storage
  // uses the key only up to the first `?` / `#` (the URL parser ends the path
  // there), so that is the key checked: cutting a suffix off a key that starts
  // with `${companyId}/` cannot leave the company, and a name like
  // "Drawing #3.pdf" keeps uploading exactly as it always has.
  const owned = (path: string) => {
    const key = path.split(/[?#]/, 1)[0] ?? "";
    return (
      hasCompanyPrivateObjectPathPrefix(companyId, key) &&
      !isUnsafeStoragePath(key)
    );
  };
  const owns = (...paths: string[]) => paths.every(owned);
  const refuse = (...paths: string[]) =>
    Promise.resolve({
      data: null,
      error: new StorageError(
        `${paths.filter((path) => !owned(path)).join(", ")} is outside the "${id}/" storage prefix`
      )
    });

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
        ? own.exists(path)
        : refuse(path).then(({ error }) => ({ data: false, error })),
    info: (path) => (owns(path) ? own.info(path) : refuse(path)),
    download: (path, options) =>
      owns(path) ? own.download(path, options) : refuse(path),
    createSignedUrl: (path, expiresIn, options) =>
      owns(path) ? own.createSignedUrl(path, expiresIn, options) : refuse(path),

    list: (folder) =>
      owns(folder)
        ? // The endpoint matches a plain key prefix, so without the trailing
          // slash it would answer with the folder itself rather than what is
          // inside it.
          listFolder(own, `${folder.replace(/\/+$/, "")}/`)
        : refuse(folder),

    remove: (paths) => (owns(...paths) ? own.remove(paths) : refuse(...paths))
  };
}
