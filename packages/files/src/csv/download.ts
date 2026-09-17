import { downloadText } from "../download";
import { CSV_CONTENT_TYPE, type EncodeCsvOptions, encodeCsv } from "./csv";

/** Encode object rows and download them as `filename` (browser only). */
export function downloadCsv(
  rows: Record<string, unknown>[],
  filename: string,
  options?: EncodeCsvOptions
): void {
  // No rows and no explicit fields would produce a headerless empty file —
  // never useful. Explicit fields still download (template/header-only export).
  if (rows.length === 0 && !options?.fields) return;
  downloadText(encodeCsv(rows, options), filename, CSV_CONTENT_TYPE);
}
