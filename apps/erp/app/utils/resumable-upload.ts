import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@carbon/auth";
import * as tus from "tus-js-client";

// Supabase resumable (TUS) uploads. A standard `.upload()` buffers the whole
// file into ONE multipart request; a multi-GB CAD model then times out at the
// dev `.dev` proxy (it waits for storage to respond, but storage only responds
// once the entire body has arrived). TUS streams the file in fixed chunks, so
// the gateways never see a multi-GB body and the upload is resumable on failure.
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
  /** Object key within the bucket, e.g. `${companyId}/models/${id}.step`. */
  path: string;
  file: File;
  /** Overwrite an existing object at `path` (default true). */
  upsert?: boolean;
  onProgress?: (
    percent: number,
    bytesUploaded: number,
    bytesTotal: number
  ) => void;
};

/** Upload a file to Supabase Storage via the resumable (TUS) protocol. */
export function uploadModelResumable({
  accessToken,
  bucket,
  path,
  file,
  upsert = true,
  onProgress
}: ResumableUploadOptions): Promise<void> {
  return new Promise((resolve, reject) => {
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
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600"
      },
      onError: reject,
      onProgress: (bytesUploaded, bytesTotal) => {
        onProgress?.(
          bytesTotal ? (bytesUploaded / bytesTotal) * 100 : 0,
          bytesUploaded,
          bytesTotal
        );
      },
      onSuccess: () => resolve()
    });

    // Resume a previously-interrupted upload of the same file if one is pending.
    upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) {
        upload.resumeFromPreviousUpload(previous[0]);
      }
      upload.start();
    });
  });
}
