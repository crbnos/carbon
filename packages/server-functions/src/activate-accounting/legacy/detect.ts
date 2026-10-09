// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Legacy documents (.ai/specs/2026-10-08-accounting-cutover.md section 5a):
// posted, dated on or after the cutover, and with no journal line under
// their document keys in a journal of any status. A company with accounting
// off wrote no journal, and the reset deleted the journals of the others.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";

/** Statuses of a document that was never posted, or whose post and void net. */
const NOT_POSTED = ["Draft", "Pending", "Voided"] as const;

type Args = { companyId: string; cutoverDate: string };

/** Posted sales invoices dated on or after the cutover with no journal. */
export function legacySalesInvoices(
  trx: KyselyTx,
  { companyId, cutoverDate }: Args
) {
  return trx
    .selectFrom("salesInvoice as invoice")
    .select([
      "invoice.id",
      "invoice.invoiceId",
      "invoice.customerId",
      "invoice.customerReference",
      "invoice.postingDate"
    ])
    .where("invoice.companyId", "=", companyId)
    .where("invoice.status", "not in", [...NOT_POSTED])
    .where("invoice.postingDate", ">=", cutoverDate)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("journalLine as line")
            .select("line.id")
            .whereRef("line.companyId", "=", "invoice.companyId")
            .whereRef("line.documentId", "=", "invoice.id")
            .where("line.documentType", "=", "Invoice")
        )
      )
    )
    .orderBy("invoice.postingDate")
    .orderBy("invoice.createdAt")
    .execute();
}

/** Posted purchase invoices dated on or after the cutover with no journal. */
export function legacyPurchaseInvoices(
  trx: KyselyTx,
  { companyId, cutoverDate }: Args
) {
  return trx
    .selectFrom("purchaseInvoice as invoice")
    .select([
      "invoice.id",
      "invoice.invoiceId",
      "invoice.supplierId",
      "invoice.supplierReference",
      "invoice.exchangeRate",
      "invoice.postingDate",
      "invoice.createdAt"
    ])
    .where("invoice.companyId", "=", companyId)
    .where("invoice.status", "not in", [...NOT_POSTED])
    .where("invoice.postingDate", ">=", cutoverDate)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("journalLine as line")
            .select("line.id")
            .whereRef("line.companyId", "=", "invoice.companyId")
            .whereRef("line.documentId", "=", "invoice.id")
            .where("line.documentType", "=", "Invoice")
        )
      )
    )
    .orderBy("invoice.postingDate")
    .orderBy("invoice.createdAt")
    .execute();
}

/** Posted memos dated on or after the cutover with no journal. */
export function legacyMemos(trx: KyselyTx, { companyId, cutoverDate }: Args) {
  return trx
    .selectFrom("memo")
    .selectAll("memo")
    .where("memo.companyId", "=", companyId)
    .where("memo.status", "=", "Posted")
    .where("memo.postingDate", ">=", cutoverDate)
    .where("memo.journalId", "is", null)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("journalLine as line")
            .select("line.id")
            .whereRef("line.companyId", "=", "memo.companyId")
            .whereRef("line.documentId", "=", "memo.id")
            .where("line.documentType", "=", "Memo")
        )
      )
    )
    .orderBy("memo.postingDate")
    .orderBy("memo.createdAt")
    .orderBy("memo.id")
    .execute();
}

/**
 * Posted payments dated on or after the cutover with no journal, in posting
 * order: a payment reads the control line of what it settles, and of the
 * earlier payment whose credit funds it.
 */
export function legacyPayments(
  trx: KyselyTx,
  { companyId, cutoverDate }: Args
) {
  return trx
    .selectFrom("payment")
    .selectAll("payment")
    .where("payment.companyId", "=", companyId)
    .where("payment.status", "=", "Posted")
    .where("payment.postingDate", ">=", cutoverDate)
    .where("payment.journalId", "is", null)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("journalLine as line")
            .select("line.id")
            .whereRef("line.companyId", "=", "payment.companyId")
            .whereRef("line.documentId", "=", "payment.id")
            .where("line.documentType", "=", "Payment")
        )
      )
    )
    .orderBy("payment.postingDate")
    .orderBy("payment.createdAt")
    .orderBy("payment.id")
    .execute();
}

/** Posted charges dated on or after the cutover with no journal. The date is
 *  the one the posting uses: `postingDate`, else `transactionDate`. */
export function legacyCharges(trx: KyselyTx, { companyId, cutoverDate }: Args) {
  return trx
    .selectFrom("charge")
    .selectAll("charge")
    .where("charge.companyId", "=", companyId)
    .where("charge.status", "=", "Posted")
    .where(({ eb, fn }) =>
      eb(
        fn.coalesce("charge.postingDate", "charge.transactionDate"),
        ">=",
        cutoverDate
      )
    )
    .where("charge.journalId", "is", null)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("journalLine as line")
            .select("line.id")
            .whereRef("line.companyId", "=", "charge.companyId")
            .whereRef("line.documentId", "=", "charge.id")
            .where("line.documentType", "=", "Charge")
        )
      )
    )
    .orderBy("charge.transactionDate")
    .orderBy("charge.createdAt")
    .orderBy("charge.id")
    .execute();
}

/** Posted reimbursements dated on or after the cutover with no journal. The
 *  date is the one the posting uses: `postingDate`, else `reimbursementDate`. */
export function legacyReimbursements(
  trx: KyselyTx,
  { companyId, cutoverDate }: Args
) {
  return trx
    .selectFrom("reimbursement")
    .selectAll("reimbursement")
    .where("reimbursement.companyId", "=", companyId)
    .where("reimbursement.status", "=", "Posted")
    .where(({ eb, fn }) =>
      eb(
        fn.coalesce(
          "reimbursement.postingDate",
          "reimbursement.reimbursementDate"
        ),
        ">=",
        cutoverDate
      )
    )
    .where("reimbursement.journalId", "is", null)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("journalLine as line")
            .select("line.id")
            .whereRef("line.companyId", "=", "reimbursement.companyId")
            .whereRef("line.documentId", "=", "reimbursement.id")
            .where("line.documentType", "=", "Reimbursement")
        )
      )
    )
    .orderBy("reimbursement.reimbursementDate")
    .orderBy("reimbursement.createdAt")
    .orderBy("reimbursement.id")
    .execute();
}

export const POSTED_INVOICE_EXCLUDED_STATUSES = NOT_POSTED;

type Enums = Database["public"]["Enums"];

/**
 * Posted receipts of one source document dated on or after the cutover with
 * no 'Receipt' journal line. A voided receipt is left out: its post and its
 * void net to zero.
 */
export function legacyReceipts(
  trx: KyselyTx,
  { companyId, cutoverDate }: Args,
  sourceDocument: Extract<
    Enums["receiptSourceDocument"],
    "Purchase Order" | "Sales Return Order"
  >
) {
  return trx
    .selectFrom("receipt")
    .select([
      "receipt.id",
      "receipt.receiptId",
      "receipt.sourceDocumentId",
      "receipt.externalDocumentId",
      "receipt.postingDate"
    ])
    .where("receipt.companyId", "=", companyId)
    .where("receipt.status", "=", "Posted")
    .where("receipt.sourceDocument", "=", sourceDocument)
    .where("receipt.postingDate", ">=", cutoverDate)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("journalLine as line")
            .select("line.id")
            .whereRef("line.companyId", "=", "receipt.companyId")
            .whereRef("line.documentId", "=", "receipt.id")
            .where("line.documentType", "=", "Receipt")
        )
      )
    )
    .orderBy("receipt.postingDate")
    .orderBy("receipt.createdAt")
    .orderBy("receipt.id")
    .execute();
}

/**
 * Posted shipments of one source document dated on or after the cutover
 * that stored a cost row and have no journal line under `journalDocumentType`.
 * A sales shipment stored its "Sale" cost row only when the company had
 * accounting on; the enable writes the row of one without it first
 * (`legacySaleMovements`, movement-cost.ts).
 */
export function legacyShipments(
  trx: KyselyTx,
  { companyId, cutoverDate }: Args,
  {
    sourceDocument,
    journalDocumentType,
    costDocumentType,
    itemLedgerType
  }: {
    sourceDocument: Extract<
      Enums["shipmentSourceDocument"],
      "Sales Order" | "Sales Return Order" | "Purchase Return Order"
    >;
    journalDocumentType: Enums["journalLineDocumentType"];
    costDocumentType: Enums["itemLedgerDocumentType"];
    itemLedgerType: Enums["itemLedgerType"];
  }
) {
  return trx
    .selectFrom("shipment")
    .select([
      "shipment.id",
      "shipment.shipmentId",
      "shipment.sourceDocumentId",
      "shipment.locationId",
      "shipment.postingDate"
    ])
    .where("shipment.companyId", "=", companyId)
    .where("shipment.status", "=", "Posted")
    .where("shipment.sourceDocument", "=", sourceDocument)
    .where("shipment.postingDate", ">=", cutoverDate)
    .where(({ exists, selectFrom }) =>
      exists(
        selectFrom("costLedger as cost")
          .select("cost.id")
          .whereRef("cost.companyId", "=", "shipment.companyId")
          .whereRef("cost.documentId", "=", "shipment.id")
          .where("cost.documentType", "=", costDocumentType)
          .where("cost.itemLedgerType", "=", itemLedgerType)
      )
    )
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("journalLine as line")
            .select("line.id")
            .whereRef("line.companyId", "=", "shipment.companyId")
            .whereRef("line.documentId", "=", "shipment.id")
            .where("line.documentType", "=", journalDocumentType)
        )
      )
    )
    .orderBy("shipment.postingDate")
    .orderBy("shipment.createdAt")
    .orderBy("shipment.id")
    .execute();
}

/**
 * The cost rows of the adjustment core dated on or after the cutover whose
 * document has no journal line on that date: manual adjustments and the CSV
 * stock import (no document type), scrap and unscrap, inventory counts,
 * non-conformance and inspection write-offs, and maintenance parts. A
 * zero-cost row is left out, as the core posts no journal for it.
 *
 * Left out: a stock movement correction (it carries the original's document
 * keys), found as an item ledger row with `correctionOfItemLedgerId` written
 * in the same transaction as the cost row. A tracked unscrap also sets that
 * column, so a correction written with an Unscrap activity is kept.
 * A day is matched, not the document: a maintenance dispatch can consume
 * parts on more than one day, and only the legacy days lack a journal.
 */
export function legacyAdjustmentCostRows(
  trx: KyselyTx,
  { companyId, cutoverDate }: Args
) {
  return trx
    .selectFrom("costLedger as cost")
    .select([
      "cost.id",
      "cost.itemId",
      "cost.quantity",
      "cost.cost",
      "cost.documentType",
      "cost.documentId",
      "cost.postingDate",
      "cost.entryNumber",
      sql<string>`"cost"."createdAt"::text`.as("createdAt")
    ])
    .where("cost.companyId", "=", companyId)
    .where("cost.postingDate", ">=", cutoverDate)
    .where("cost.adjustment", "=", false)
    .where("cost.appliesToCostLedgerId", "is", null)
    .where("cost.costLedgerType", "=", "Direct Cost")
    .where("cost.cost", "!=", 0)
    .where("cost.quantity", "!=", 0)
    .where("cost.documentId", "is not", null)
    .where("cost.itemId", "is not", null)
    .where((eb) =>
      eb.or([
        eb.and([
          eb("cost.documentType", "is", null),
          eb("cost.itemLedgerType", "in", [
            "Positive Adjmt.",
            "Negative Adjmt."
          ])
        ]),
        eb.and([
          eb("cost.documentType", "in", [
            "Scrap",
            "Inventory Count",
            "Non-Conformance",
            "Inbound Inspection"
          ]),
          eb("cost.itemLedgerType", "in", [
            "Positive Adjmt.",
            "Negative Adjmt."
          ])
        ]),
        eb.and([
          eb("cost.documentType", "=", "Maintenance Consumption"),
          eb("cost.itemLedgerType", "=", "Consumption")
        ])
      ])
    )
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("itemLedger as correction")
            .select("correction.id")
            .whereRef("correction.companyId", "=", "cost.companyId")
            .whereRef("correction.createdAt", "=", "cost.createdAt")
            .where("correction.correctionOfItemLedgerId", "is not", null)
            .where(
              sql<boolean>`coalesce("correction"."documentId", "correction"."id") = "cost"."documentId"`
            )
            .where(
              sql<boolean>`"correction"."documentType" IS NOT DISTINCT FROM "cost"."documentType"`
            )
            .where(({ not, exists, selectFrom }) =>
              not(
                exists(
                  selectFrom("trackedActivity as activity")
                    .select("activity.id")
                    .whereRef("activity.companyId", "=", "correction.companyId")
                    .whereRef("activity.createdAt", "=", "correction.createdAt")
                    .where("activity.type", "=", "Unscrap")
                )
              )
            )
        )
      )
    )
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("journalLine as line")
            .innerJoin("journal", (join) =>
              join
                .onRef("journal.id", "=", "line.journalId")
                .onRef("journal.companyId", "=", "line.companyId")
            )
            .select("line.id")
            .whereRef("line.companyId", "=", "cost.companyId")
            .whereRef("line.documentId", "=", "cost.documentId")
            .whereRef("journal.postingDate", "=", "cost.postingDate")
            .where(
              sql<boolean>`"line"."documentType"::text = coalesce("cost"."documentType"::text, 'Inventory Adjustment')`
            )
        )
      )
    )
    .orderBy("cost.postingDate")
    .orderBy("cost.entryNumber")
    .execute();
}

/** A timestamp as a fixed-width UTC instant: it sorts as text, and inserts
 *  back as the same timestamp. */
export function utcInstant(column: string) {
  return sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * The sale movements dated on or after the cutover, per document and item:
 * the item ledger rows of a posted sales order shipment, and of a posted
 * sales invoice (a direct line ships through its invoice, under the
 * invoice's id). `covered` is the quantity the document's "Sale" cost rows
 * hold. A company with accounting off stored none: a sales order shipment
 * never costed its movement, and a direct line relieved its layers but wrote
 * no row. A correction is left out: it books its own cost row.
 */
export function legacySaleMovements(
  trx: KyselyTx,
  { companyId, cutoverDate }: Args
) {
  return trx
    .selectFrom("itemLedger as ledger")
    .select([
      "ledger.documentId",
      "ledger.itemId",
      sql<number>`-sum("ledger"."quantity")`.as("quantity"),
      sql<string>`min("ledger"."postingDate")::text`.as("postingDate"),
      sql<string>`min(${utcInstant("ledger.createdAt")})`.as("createdAt"),
      sql<number>`coalesce((
        SELECT -sum("cost"."quantity")
        FROM "costLedger" AS "cost"
        WHERE "cost"."companyId" = "ledger"."companyId"
          AND "cost"."documentId" = "ledger"."documentId"
          AND "cost"."itemId" = "ledger"."itemId"
          AND "cost"."documentType" = 'Sales Shipment'
          AND "cost"."itemLedgerType" = 'Sale'
          AND "cost"."adjustment" = false
          AND "cost"."appliesToCostLedgerId" IS NULL
          AND "cost"."quantity" < 0
      ), 0)`.as("covered")
    ])
    .where("ledger.companyId", "=", companyId)
    .where("ledger.documentType", "=", "Sales Shipment")
    .where("ledger.entryType", "=", "Negative Adjmt.")
    .where("ledger.postingDate", ">=", cutoverDate)
    .where("ledger.quantity", "<", 0)
    .where("ledger.correctionOfItemLedgerId", "is", null)
    .where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom("shipment")
            .select("shipment.id")
            .whereRef("shipment.companyId", "=", "ledger.companyId")
            .whereRef("shipment.id", "=", "ledger.documentId")
            .where("shipment.status", "=", "Posted")
            .where("shipment.sourceDocument", "=", "Sales Order")
        ),
        eb.exists(
          eb
            .selectFrom("salesInvoice as invoice")
            .select("invoice.id")
            .whereRef("invoice.companyId", "=", "ledger.companyId")
            .whereRef("invoice.id", "=", "ledger.documentId")
            .where("invoice.status", "not in", [...NOT_POSTED])
        )
      ])
    )
    .groupBy(["ledger.companyId", "ledger.documentId", "ledger.itemId"])
    .orderBy(sql`min("ledger"."postingDate")`)
    .orderBy(sql`min("ledger"."createdAt")`)
    .orderBy("ledger.documentId")
    .orderBy("ledger.itemId")
    .execute();
}

/**
 * The job movements dated on or after the cutover: material issued to a job
 * or returned from it, and the output a completion received. A correction
 * is left out: it books its own cost row.
 */
export function legacyJobMovements(
  trx: KyselyTx,
  { companyId, cutoverDate }: Args
) {
  return trx
    .selectFrom("itemLedger as ledger")
    .select([
      "ledger.id",
      "ledger.entryType",
      "ledger.documentId",
      "ledger.documentLineId",
      "ledger.itemId",
      "ledger.quantity",
      "ledger.locationId",
      sql<string>`"ledger"."postingDate"::text`.as("postingDate"),
      utcInstant("ledger.createdAt").as("createdAt")
    ])
    .where("ledger.companyId", "=", companyId)
    .where("ledger.postingDate", ">=", cutoverDate)
    .where("ledger.correctionOfItemLedgerId", "is", null)
    .where("ledger.documentId", "is not", null)
    .where("ledger.quantity", "!=", 0)
    .where((eb) =>
      eb.or([
        eb.and([
          eb("ledger.entryType", "=", "Consumption"),
          eb("ledger.documentType", "=", "Job Consumption")
        ]),
        eb.and([
          eb("ledger.entryType", "=", "Assembly Output"),
          eb("ledger.documentType", "=", "Job Receipt"),
          eb("ledger.quantity", ">", 0)
        ])
      ])
    )
    .orderBy("ledger.postingDate")
    .orderBy("ledger.createdAt")
    .orderBy("ledger.entryNumber")
    .execute();
}
