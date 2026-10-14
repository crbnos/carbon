// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@carbon/auth";

/**
 * `storage.uploadToSignedUrl` with upload progress. supabase-js sends the PUT
 * through `fetch`, which exposes no upload progress, so this sends the same
 * request (multipart body, `cacheControl` + the file under an empty field name)
 * over XHR. Use it for paths the user cannot write directly, where the server
 * mints a signed upload token; user-writable paths use `uploadModelResumable`.
 */
export function uploadToSignedUrlWithProgress({
  bucket,
  path,
  token,
  file,
  onProgress
}: {
  bucket: string;
  path: string;
  token: string;
  file: File;
  onProgress: (uploaded: number, total: number) => void;
}): Promise<void> {
  const url = new URL(
    `${SUPABASE_URL}/storage/v1/object/upload/sign/${bucket}/${path}`
  );
  url.searchParams.set("token", token);

  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url.toString());
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY ?? "");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      reject(new Error(storageErrorMessage(xhr) ?? `HTTP ${xhr.status}`));
    };
    // No message: the caller shows its own (translated) network-error copy.
    xhr.onerror = () => reject(new Error());
    xhr.send(body);
  });
}

function storageErrorMessage(xhr: XMLHttpRequest): string | null {
  try {
    const parsed = JSON.parse(xhr.responseText) as { message?: string };
    return parsed.message ?? null;
  } catch {
    return xhr.responseText || null;
  }
}
