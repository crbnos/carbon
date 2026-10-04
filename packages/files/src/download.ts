// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Trigger a browser download of in-memory bytes. The one implementation of
 * the blob → object URL → anchor click → revoke sequence, so every export
 * cleans up its object URL and detaches its anchor.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Fetch `url` and download it as `filename`. Throws when the response is not a
 * success — an expired session or a missing file otherwise saves the error
 * page under the file's name.
 */
export async function downloadUrl(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }
  downloadBlob(await response.blob(), filename);
}

/** Download text content under `filename` with the given MIME type. */
export function downloadText(
  text: string,
  filename: string,
  contentType: string
): void {
  downloadBlob(new Blob([text], { type: contentType }), filename);
}
