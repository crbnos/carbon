import type { Database } from "@carbon/database";

import type { getDocumentLabels, getDocuments } from "./documents.service";

export type Document = NonNullable<
  Awaited<ReturnType<typeof getDocuments>>["data"]
>[number];

export type DocumentLabel = NonNullable<
  Awaited<ReturnType<typeof getDocumentLabels>>["data"]
>[number];

export type DocumentTransactionType =
  Database["public"]["Enums"]["documentTransactionType"];
