// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@carbon/auth";
import * as tus from "tus-js-client";

// Supabase resumable (TUS) uploads. A standard `.upload()` buffers the whole
// file into ONE multipart request; a multi-GB CAD model then times out at the
// dev `.dev` proxy (it waits for storage to respond, but storage only responds
// once the entire body has arrived). TUS streams the file in fixed chunks, so
// the gateways never see a multi-GB body, a dropped chunk is retried, and an
// upload a reload cut off resumes when the same file is dropped again.
//
// Supabase requires the chunk size to be EXACTLY 6 MB (except the final chunk).
const CHUNK_SIZE = 6 * 1024 * 1024;

// The TUS create (POST) returns a `Location` for subsequent PATCH/HEAD requests.
// Behind the dev proxy chain (portless → kong → storage), kong overwrites
// `X-Forwarded-Host` with its own internal address, so storage builds that
// Location against `http://127.0.0.1:8000` (unreachable from the browser) and
// drops the `/storage/v1` route prefix. Rewrite any non-public-origin request URL
// back onto the public Supabase origin so the chunks route correctly.
const PUBLIC_ORIGIN = (() => {
  try {
    return new URL(SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

function rewriteToPublicOrigin(url: string): string {
  if (!PUBLIC_ORIGIN) return url;
  try {
    const parsed = new URL(url, PUBLIC_ORIGIN);
    if (parsed.origin === PUBLIC_ORIGIN) return url;
    const pathname = parsed.pathname.startsWith("/storage/v1")
      ? parsed.pathname
      : `/storage/v1${parsed.pathname}`;
    return `${PUBLIC_ORIGIN}${pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * Wraps tus-js-client's default HTTP stack, rewriting every request URL through
 * `rewriteToPublicOrigin` before the request is built — so a `Location` the
 * proxy mangled to an internal host is corrected on the PATCH/HEAD.
 */
class PublicOriginHttpStack implements tus.HttpStack {
  constructor(private readonly inner: tus.HttpStack) {}

  createRequest(method: string, url: string): tus.HttpRequest {
    return this.inner.createRequest(method, rewriteToPublicOrigin(url));
  }

  getName(): string {
    return "PublicOriginHttpStack";
  }
}

export type ResumableUploadOptions = {
  /** The signed-in user's Supabase access token (from `useCarbon()`). */
  accessToken: string;
  bucket: string;
  /** Object key within the bucket, e.g. `${companyId}/models/${id}.step`.
   *  Used unless an unfinished upload of the same file is resumed. */
  path: string;
  /** Which unfinished upload to resume when several match the file. */
  preferPath?: string;
  file: File;
  /** Overwrite an existing object at `path` (default true). */
  upsert?: boolean;
  /** The path the bytes go to: `path`, or the resumed upload's. */
  onStart?: (path: string) => void;
  onProgress?: (
    percent: number,
    bytesUploaded: number,
    bytesTotal: number
  ) => void;
};

// Paths an upload in this tab is still sending. A second drop of the same file
// must not resume the first while it runs.
const inFlight = new Set<string>();

type StoredUpload = { metadata: { [key: string]: string } };

/**
 * Which of tus's stored uploads of this file to resume, if any: one to the same
 * bucket and folder (the same company's models; the browser may hold another
 * company's), not still running in this tab, `preferPath` first.
 */
export function pickResumableUpload<T extends StoredUpload>(
  previous: T[],
  {
    bucket,
    path,
    preferPath,
    running
  }: { bucket: string; path: string; preferPath?: string; running: Set<string> }
): T | undefined {
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  const resumable = previous.filter(
    (p) =>
      p.metadata.bucketName === bucket &&
      p.metadata.objectName?.startsWith(folder) &&
      !running.has(p.metadata.objectName)
  );
  return (
    resumable.find((p) => p.metadata.objectName === preferPath) ?? resumable[0]
  );
}

/**
 * Upload a file to Supabase Storage via the resumable (TUS) protocol, and
 * resolve to the path it was written to.
 *
 * tus recognises an unfinished upload by the FILE (name, size, type, mtime),
 * not by its destination. Resuming one therefore continues ITS path, not the
 * one passed in, and the caller must record the path this returns. Recording
 * the new path while the bytes went to the old one left a model with no file.
 */
export function uploadModelResumable({
  accessToken,
  bucket,
  path,
  preferPath,
  file,
  upsert = true,
  onStart,
  onProgress
}: ResumableUploadOptions): Promise<{ path: string }> {
  return new Promise((resolve, reject) => {
    const metadata = {
      bucketName: bucket,
      objectName: path,
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600"
    };
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      httpStack: new PublicOriginHttpStack(new tus.DefaultHttpStack({})),
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY ?? "",
        "x-upsert": upsert ? "true" : "false"
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK_SIZE,
      metadata,
      onError: (error) => {
        inFlight.delete(metadata.objectName);
        reject(error);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        onProgress?.(
          bytesTotal ? (bytesUploaded / bytesTotal) * 100 : 0,
          bytesUploaded,
          bytesTotal
        );
      },
      onSuccess: () => {
        inFlight.delete(metadata.objectName);
        resolve({ path: metadata.objectName });
      }
    });

    upload.findPreviousUploads().then((previous) => {
      const earlier = pickResumableUpload(previous, {
        bucket,
        path,
        preferPath,
        running: inFlight
      });
      if (earlier) {
        // Also what a new upload is created with, should the stored one have
        // expired on the server.
        metadata.objectName = earlier.metadata.objectName;
        upload.resumeFromPreviousUpload(earlier);
      }
      inFlight.add(metadata.objectName);
      onStart?.(metadata.objectName);
      upload.start();
    }, reject);
  });
}

/** An upload the page lost (a reload, a closed tab) before it finished. */
export type InterruptedUpload = {
  path: string;
  name: string;
  size: number;
  percent: number;
};

type UploadNote = InterruptedUpload & { scope: string; startedAt: number };

const NOTE_PREFIX = "carbon:model-upload:";
// Supabase discards an unfinished resumable upload after 24 hours.
const NOTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Runs `use` against localStorage. Storage can be missing or throw (a private
 * window, blocked site data, a full quota); a lost note only costs the
 * reminder, never the upload, so the error is swallowed.
 */
function withStorage<T>(use: (store: Storage) => T): T | null {
  try {
    return use(window.localStorage);
  } catch {
    return null;
  }
}

function readNote(store: Storage, key: string): UploadNote | null {
  const raw = store.getItem(key);
  return raw ? (JSON.parse(raw) as UploadNote) : null;
}

/** Remember an upload under `scope` (the record it belongs to) until it ends. */
export function noteUploadStarted(
  scope: string,
  upload: Omit<InterruptedUpload, "percent">
) {
  const note: UploadNote = {
    ...upload,
    scope,
    percent: 0,
    startedAt: Date.now()
  };
  withStorage((store) =>
    store.setItem(NOTE_PREFIX + upload.path, JSON.stringify(note))
  );
}

/** Saves the progress about once per percent, not on every chunk event. */
export function noteUploadProgress(path: string, percent: number) {
  withStorage((store) => {
    const note = readNote(store, NOTE_PREFIX + path);
    if (!note || percent - note.percent < 1) return;
    store.setItem(NOTE_PREFIX + path, JSON.stringify({ ...note, percent }));
  });
}

export function forgetUpload(path: string) {
  withStorage((store) => store.removeItem(NOTE_PREFIX + path));
}

/**
 * The newest unfinished upload noted under `scope` that tus can still resume.
 * Notes past the server's 24 hours, or with no tus entry left, are dropped.
 */
export async function findInterruptedUpload(
  scope: string
): Promise<InterruptedUpload | null> {
  const store = withStorage((store) => store);
  if (!store) return null;
  try {
    const resumable = new Set(
      (await tus.defaultOptions.urlStorage.findAllUploads()).map(
        (p) => p.metadata.objectName
      )
    );
    const now = Date.now();
    const notes: UploadNote[] = [];
    for (const key of Object.keys(store)) {
      if (!key.startsWith(NOTE_PREFIX)) continue;
      const note = readNote(store, key);
      if (
        !note ||
        now - note.startedAt > NOTE_MAX_AGE_MS ||
        !resumable.has(note.path)
      ) {
        store.removeItem(key);
      } else if (note.scope === scope && !inFlight.has(note.path)) {
        notes.push(note);
      }
    }
    const newest = notes.sort((a, b) => b.startedAt - a.startedAt)[0];
    return newest
      ? {
          path: newest.path,
          name: newest.name,
          size: newest.size,
          percent: newest.percent
        }
      : null;
  } catch {
    return null;
  }
}
