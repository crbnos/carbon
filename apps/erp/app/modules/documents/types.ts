import type { Database } from "@carbon/database";

import type { getDocumentLabels, getDocuments } from "./documents.service";

export type Document = NonNullable<
  Awaited<ReturnType<typeof getDocuments>>["data"]
>[number] & {
  // Signed, server-minted token for the public `/download/:token` route. Present
  // only for rows backed by a file; surfaced as a link in the CSV export.
  downloadToken?: string;
};

export type DocumentLabel = NonNullable<
  Awaited<ReturnType<typeof getDocumentLabels>>["data"]
>[number];

export type DocumentTransactionType =
  Database["public"]["Enums"]["documentTransactionType"];
