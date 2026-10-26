// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { stripSpecialCharacters } from "@carbon/utils";

/**
 * The name a document's PDF is stored under when it is finalized, sent or
 * posted: `<display id> - <UTC time to the second>.pdf`, such as
 * `PO000123-1 - 2026-10-22T14:03:22.pdf`. `timestamp` is an ISO instant
 * (`datetime.timestamp()`).
 */
export function storedDocumentPdfName(displayId: string, timestamp: string) {
  return stripSpecialCharacters(`${displayId} - ${timestamp.slice(0, 19)}.pdf`);
}

// What follows the document id: an optional revision (`-2`), then the time.
const STORED_PDF_SUFFIX =
  /^(-\d+)? - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.pdf$/;

/**
 * Whether `fileName` is a PDF stored (`storedDocumentPdfName`) for one of
 * `documentIds`, at any revision. Documents that share a folder (purchase
 * orders converted from one supplier quote, the quote, order, invoice and
 * shipments of one opportunity) use it to tell their stored PDFs from the
 * files a person added.
 */
export function isStoredDocumentPdf(fileName: string, documentIds: string[]) {
  return documentIds.some((documentId) => {
    const prefix = stripSpecialCharacters(documentId);
    return (
      prefix.length > 0 &&
      fileName.startsWith(prefix) &&
      STORED_PDF_SUFFIX.test(fileName.slice(prefix.length))
    );
  });
}
