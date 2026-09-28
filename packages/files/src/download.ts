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

/** Download text content under `filename` with the given MIME type. */
export function downloadText(
  text: string,
  filename: string,
  contentType: string
): void {
  downloadBlob(new Blob([text], { type: contentType }), filename);
}
