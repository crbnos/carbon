// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type PageGate, pageOfTable } from "@carbon/database/access";
import type {
  DocumentEditType,
  DocumentTemplateType
} from "@carbon/documents/template";
import type { PartNumberParty } from "@carbon/documents/utils";
import { isJobLocked } from "@carbon/utils";
import { isStockTransferLocked } from "~/modules/inventory/inventory.models";
import { isSalesInvoiceLocked } from "~/modules/invoicing/invoicing.models";
import {
  isPurchaseOrderLocked,
  isPurchaseReturnOrderLocked,
  isRfqLocked,
  purchaseOrderPartNumberRefusal
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
 * the record's own lock, the page whose Edit level edits it, and the
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
  notesColumn: "externalNotes" | "notes" | "content" | null;
  /**
   * The lines that store a part number display choice: their table, the column
   * that names the document, whose part number "theirs" is, and why the choice
   * cannot change in a status the record's own lock allows (a purchase order
   * waiting for approval). Absent: the document has no part number choice.
   */
  partNumberLines?: {
    table:
      | "quoteLine"
      | "salesOrderLine"
      | "salesInvoiceLine"
      | "shipmentLine"
      | "purchaseOrderLine";
    documentColumn:
      | "quoteId"
      | "salesOrderId"
      | "invoiceId"
      | "shipmentId"
      | "purchaseOrderId";
    party: PartNumberParty;
    refusal?: (status: string | null | undefined) => string | null;
    /** A record column whose values mean the document prints no lines. */
    noLinesWhen?: { column: "sourceDocument"; values: readonly string[] };
  };
}

export const DOCUMENT_EDIT_RECORDS: Record<
  DocumentEditType,
  DocumentEditRecord
> = {
  purchaseOrder: {
    table: "purchaseOrder",
    readableId: "purchaseOrderId",
    isLocked: isPurchaseOrderLocked,
    notesColumn: "externalNotes",
    partNumberLines: {
      table: "purchaseOrderLine",
      documentColumn: "purchaseOrderId",
      party: "supplier",
      refusal: purchaseOrderPartNumberRefusal
    }
  },
  purchaseReturnOrder: {
    table: "purchaseReturnOrder",
    readableId: "purchaseReturnOrderId",
    isLocked: isPurchaseReturnOrderLocked,
    notesColumn: "externalNotes"
  },
  purchasingRfq: {
    table: "purchasingRfq",
    readableId: "rfqId",
    isLocked: isRfqLocked,
    notesColumn: "notes"
  },
  quote: {
    table: "quote",
    readableId: "quoteId",
    isLocked: isQuoteLocked,
    notesColumn: "externalNotes",
    partNumberLines: {
      table: "quoteLine",
      documentColumn: "quoteId",
      party: "customer"
    }
  },
  salesOrder: {
    table: "salesOrder",
    readableId: "salesOrderId",
    isLocked: isSalesOrderLocked,
    notesColumn: "externalNotes",
    partNumberLines: {
      table: "salesOrderLine",
      documentColumn: "salesOrderId",
      party: "customer"
    }
  },
  salesReturnOrder: {
    table: "salesReturnOrder",
    readableId: "salesReturnOrderId",
    isLocked: isSalesReturnOrderLocked,
    notesColumn: "externalNotes"
  },
  salesInvoice: {
    table: "salesInvoice",
    readableId: "invoiceId",
    isLocked: isSalesInvoiceLocked,
    notesColumn: "externalNotes",
    partNumberLines: {
      table: "salesInvoiceLine",
      documentColumn: "invoiceId",
      party: "customer"
    }
  },
  packingSlip: {
    table: "shipment",
    readableId: "shipmentId",
    isLocked: (status) => status === "Posted" || status === "Voided",
    notesColumn: "externalNotes",
    partNumberLines: {
      table: "shipmentLine",
      documentColumn: "shipmentId",
      party: "customer",
      // A Delivery Ticket and a Receiving Report print rental units and
      // contract lines, not the shipment's lines.
      noLinesWhen: {
        column: "sourceDocument",
        values: ["Rental Agreement", "Customer Contract"]
      }
    }
  },
  stockTransfer: {
    table: "stockTransfer",
    readableId: "stockTransferId",
    isLocked: isStockTransferLocked,
    notesColumn: null
  },
  jobTraveler: {
    table: "job",
    readableId: "jobId",
    isLocked: isJobLocked,
    notesColumn: "notes"
  },
  issue: {
    table: "nonConformance",
    readableId: "nonConformanceId",
    isLocked: isIssueLocked,
    notesColumn: "content"
  }
};

/**
 * Why a document's lines cannot change which part numbers they print, else
 * null: the record's lock, or a rule of the lines' own.
 */
export function partNumberLinesRefusal(
  documentType: DocumentEditType,
  status: string | null | undefined
): string | null {
  const record = DOCUMENT_EDIT_RECORDS[documentType];
  return (
    record.partNumberLines?.refusal?.(status) ??
    (record.isLocked(status) ? "This document is locked." : null)
  );
}

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

/** Editing how a document prints needs Edit on the page that owns its record's table. */
export const documentEditPermissions = Object.fromEntries(
  Object.entries(DOCUMENT_EDIT_RECORDS).map(([type, record]) => [
    type,
    { [pageOfTable(record.table)]: "Edit" }
  ])
) as Record<DocumentEditType, PageGate>;
