/**
 * The documentation host lives here and nowhere else.
 *
 * `apps/erp/app/utils/training.ts` hardcodes an absolute learn.carbon.ms URL in
 * every entry; that is the pattern this file exists to avoid — a host change
 * there is a find-and-replace across the file, here it is one constant.
 */

import type { LearnDocLink } from "./types";

export const DOCS_URL = "https://docs.carbon.ms";

/** `docsRef("/docs/reference/receipts#status", "Receipt status")` */
export function docsRef(path: string, title: string): LearnDocLink {
  return { title, url: `${DOCS_URL}${path}` };
}
