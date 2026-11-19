// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  DocumentEditType,
  DocumentTemplateType
} from "@carbon/documents/template";
import { isJobLocked } from "@carbon/utils";
import { isStockTransferLocked } from "~/modules/inventory/inventory.models";
import { isSalesInvoiceLocked } from "~/modules/invoicing/invoicing.models";
import {
  isPurchaseOrderLocked,
  isPurchaseReturnOrderLocked,
  isRfqLocked
} from "~/modules/purchasing/purchasing.models";
import { isIssueLocked } from "~/modules/quality/quality.models";
import {
  isQuoteLocked,
  isSalesOrderLocked,
  isSalesReturnOrderLocked
} from "~/modules/sales/sales.models";

/** DISTINCT rows per table. The ONLY shape a user-facing total may be summed from. */
export type RowsByTable = { table: string; rows: number };

/**
 * How many ROWS a skip or purge affects. `violations`/`excludedRows` are per FK
 * EDGE — a row escaping scope through three of its foreign keys appears three
 * times there — so totals must come from the per-table distinct counts.
 */
export function totalScopeRows(rowsByTable: RowsByTable[]): number {
  return rowsByTable.reduce((sum, t) => sum + t.rows, 0);
}

/**
 * Where each editable document lives: the record it prints, its readable number,
 * the record's own lock, the module whose update permission edits it, and the
 * column its Notes block prints (null: the document has no Notes block).
 */
export interface DocumentEditRecord {
  table:
    | "purchaseOrder"
    | "purchaseReturnOrder"
    | "purchasingRfq"
    | "quote"
    | "salesOrder"
    | "salesReturnOrder"
    | "salesInvoice"
    | "shipment"
    | "stockTransfer"
    | "job"
    | "nonConformance";
  readableId: string;
  isLocked: (status: string | null | undefined) => boolean;
  module:
    | "purchasing"
    | "sales"
    | "invoicing"
    | "inventory"
    | "production"
    | "quality";
  notesColumn: "externalNotes" | "notes" | "content" | null;
}

export const DOCUMENT_EDIT_RECORDS: Record<
  DocumentEditType,
  DocumentEditRecord
> = {
  purchaseOrder: {
    table: "purchaseOrder",
    readableId: "purchaseOrderId",
    isLocked: isPurchaseOrderLocked,
    module: "purchasing",
    notesColumn: "externalNotes"
  },
  purchaseReturnOrder: {
    table: "purchaseReturnOrder",
    readableId: "purchaseReturnOrderId",
    isLocked: isPurchaseReturnOrderLocked,
    module: "purchasing",
    notesColumn: "externalNotes"
  },
  purchasingRfq: {
    table: "purchasingRfq",
    readableId: "rfqId",
    isLocked: isRfqLocked,
    module: "purchasing",
    notesColumn: "notes"
  },
  quote: {
    table: "quote",
    readableId: "quoteId",
    isLocked: isQuoteLocked,
    module: "sales",
    notesColumn: "externalNotes"
  },
  salesOrder: {
    table: "salesOrder",
    readableId: "salesOrderId",
    isLocked: isSalesOrderLocked,
    module: "sales",
    notesColumn: "externalNotes"
  },
  salesReturnOrder: {
    table: "salesReturnOrder",
    readableId: "salesReturnOrderId",
    isLocked: isSalesReturnOrderLocked,
    module: "sales",
    notesColumn: "externalNotes"
  },
  salesInvoice: {
    table: "salesInvoice",
    readableId: "invoiceId",
    isLocked: isSalesInvoiceLocked,
    module: "invoicing",
    notesColumn: "externalNotes"
  },
  packingSlip: {
    table: "shipment",
    readableId: "shipmentId",
    isLocked: (status) => status === "Posted" || status === "Voided",
    module: "inventory",
    notesColumn: "externalNotes"
  },
  stockTransfer: {
    table: "stockTransfer",
    readableId: "stockTransferId",
    isLocked: isStockTransferLocked,
    module: "inventory",
    notesColumn: null
  },
  jobTraveler: {
    table: "job",
    readableId: "jobId",
    isLocked: isJobLocked,
    module: "production",
    notesColumn: "notes"
  },
  issue: {
    table: "nonConformance",
    readableId: "nonConformanceId",
    isLocked: isIssueLocked,
    module: "quality",
    notesColumn: "content"
  }
};

/**
 * The company terms setting a document's Terms block falls back to when it has
 * no content of its own. Internal documents have no terms.
 */
export const DOCUMENT_TERMS_FIELD: Partial<
  Record<DocumentTemplateType, "salesTerms" | "purchasingTerms">
> = {
  salesInvoice: "salesTerms",
  salesOrder: "salesTerms",
  quote: "salesTerms",
  packingSlip: "salesTerms",
  salesReturnOrder: "salesTerms",
  purchaseOrder: "purchasingTerms",
  purchaseReturnOrder: "purchasingTerms",
  purchasingRfq: "purchasingTerms"
};

/** Editing how a document prints needs the update permission of its record. */
export const documentEditPermissions = Object.fromEntries(
  Object.entries(DOCUMENT_EDIT_RECORDS).map(([type, record]) => [
    type,
    { update: record.module }
  ])
) as Record<DocumentEditType, { update: DocumentEditRecord["module"] }>;
