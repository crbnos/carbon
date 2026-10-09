// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Legacy documents (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a):
// posted, dated on or after the cutover, and with no journal line under
// their document keys in a journal of any status. A company with accounting
// off wrote no journal, and the reset deleted the journals of the others.
//
// The one definition of the detection. Each function returns a query, not
// its rows: the enable (server-functions activate-accounting/legacy) runs it
// and journals the rows, and `getLegacyDocumentCounts`
// (accounting-cutover-reads.ts) counts the same rows for the wizard.
// Server-only.

import { type Kysely, sql } from "kysely";
import type { KyselyDatabase } from "./client";
import { EPSILON } from "./precision";
import type { Database } from "./types";
import { journalReference } from "./utils";

type Db = Kysely<KyselyDatabase>;
type Args = { companyId: string; cutoverDate: string };
type Enums = Database["public"]["Enums"];

/**
 * The families the enable journals, in the order it writes them. A count is
 * one document, except: a job issue is one job and posting date, a job
 * completion one completion, an adjustment one document at one instant, and
 * a depreciation or recognition run one run.
 */
export const LEGACY_DOCUMENT_FAMILIES = [
  "salesInvoices",
  "purchaseInvoices",
  "memos",
  "charges",
  "reimbursements",
  "payments",
  "purchaseReceipts",
  "salesReturnReceipts",
  "salesShipments",
  "returnShipments",
  "inventoryAdjustments",
  "inventoryCounts",
  "nonConformances",
  "maintenanceConsumptions",
  "jobConsumptions",
  "jobOutputs",
  "depreciationRuns",
  "assetDisposals",
  "revenueRecognitionRuns"
] as const;

export type LegacyDocumentFamily = (typeof LEGACY_DOCUMENT_FAMILIES)[number];

/** Legacy documents per family. */
export type LegacyDocumentCounts = Record<LegacyDocumentFamily, number>;

/** Statuses of a document that was never posted, or whose post and void net. */
const NOT_POSTED = ["Draft", "Pending", "Voided"] as const;

export const POSTED_INVOICE_EXCLUDED_STATUSES = NOT_POSTED;

/** Posted sales invoices dated on or after the cutover with no journal. */
export function legacySalesInvoices(db: Db, { companyId, cutoverDate }: Args) {
  return db
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
    .orderBy("invoice.createdAt");
}

/** Posted purchase invoices dated on or after the cutover with no journal. */
export function legacyPurchaseInvoices(
  db: Db,
  { companyId, cutoverDate }: Args
) {
  return db
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
    .orderBy("invoice.createdAt");
}

/** Posted memos dated on or after the cutover with no journal. */
export function legacyMemos(db: Db, { companyId, cutoverDate }: Args) {
  return db
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
    .orderBy("memo.id");
}

/**
 * Posted payments dated on or after the cutover with no journal, in posting
 * order: a payment reads the control line of what it settles, and of the
 * earlier payment whose credit funds it.
 */
export function legacyPayments(db: Db, { companyId, cutoverDate }: Args) {
  return db
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
    .orderBy("payment.id");
}

/** Posted charges dated on or after the cutover with no journal. The date is
 *  the one the posting uses: `postingDate`, else `transactionDate`. */
export function legacyCharges(db: Db, { companyId, cutoverDate }: Args) {
  return db
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
    .orderBy("charge.id");
}

/** Posted reimbursements dated on or after the cutover with no journal. The
 *  date is the one the posting uses: `postingDate`, else `reimbursementDate`. */
export function legacyReimbursements(db: Db, { companyId, cutoverDate }: Args) {
  return db
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
    .orderBy("reimbursement.id");
}

/**
 * Posted receipts of one source document dated on or after the cutover with
 * no 'Receipt' journal line. A voided receipt is left out: its post and its
 * void net to zero.
 */
export function legacyReceipts(
  db: Db,
  { companyId, cutoverDate }: Args,
  sourceDocument: Extract<
    Enums["receiptSourceDocument"],
    "Purchase Order" | "Sales Return Order"
  >
) {
  return db
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
    .orderBy("receipt.id");
}

/** Which shipments `legacyShipments` reads, and the keys of their rows. */
export type LegacyShipmentKind = {
  sourceDocument: Extract<
    Enums["shipmentSourceDocument"],
    "Sales Order" | "Sales Return Order" | "Purchase Return Order"
  >;
  journalDocumentType: Enums["journalLineDocumentType"];
  costDocumentType: Enums["itemLedgerDocumentType"];
  itemLedgerType: Enums["itemLedgerType"];
};

export const LEGACY_SALES_SHIPMENT: LegacyShipmentKind = {
  sourceDocument: "Sales Order",
  journalDocumentType: "Sales Shipment",
  costDocumentType: "Sales Shipment",
  itemLedgerType: "Sale"
};

export const LEGACY_SALES_RETURN_SHIPMENT: LegacyShipmentKind = {
  sourceDocument: "Sales Return Order",
  journalDocumentType: "Return Order",
  costDocumentType: "Sales Return Shipment",
  itemLedgerType: "Sale"
};

export const LEGACY_PURCHASE_RETURN_SHIPMENT: LegacyShipmentKind = {
  sourceDocument: "Purchase Return Order",
  journalDocumentType: "Return Order",
  costDocumentType: "Purchase Return Shipment",
  itemLedgerType: "Purchase"
};

/**
 * Posted shipments of one source document dated on or after the cutover
 * that stored a cost row and have no journal line under `journalDocumentType`.
 * A sales shipment stored its "Sale" cost row only when the company had
 * accounting on; the enable writes the row of one without it first
 * (`legacySaleMovements`). `withUncostedSales` also takes a sales shipment
 * whose row the enable will write, so a count before the enable finds what
 * the enable journals.
 */
export function legacyShipments(
  db: Db,
  args: Args,
  {
    sourceDocument,
    journalDocumentType,
    costDocumentType,
    itemLedgerType
  }: LegacyShipmentKind,
  { withUncostedSales = false }: { withUncostedSales?: boolean } = {}
) {
  const { companyId, cutoverDate } = args;
  return db
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
    .where((eb) => {
      const costed = eb.exists(
        eb
          .selectFrom("costLedger as cost")
          .select("cost.id")
          .whereRef("cost.companyId", "=", "shipment.companyId")
          .whereRef("cost.documentId", "=", "shipment.id")
          .where("cost.documentType", "=", costDocumentType)
          .where("cost.itemLedgerType", "=", itemLedgerType)
      );
      return withUncostedSales
        ? eb.or([
            costed,
            eb(
              "shipment.id",
              "in",
              legacySaleMovements(db, args)
                .clearSelect()
                .clearOrderBy()
                .select("movement.documentId")
                .$narrowType<{ documentId: string }>()
            )
          ])
        : costed;
    })
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
    .orderBy("shipment.id");
}

/**
 * The cost rows of the adjustment core dated on or after the cutover whose
 * document has no journal line on that date: manual adjustments and the CSV
 * stock import (no document type), scrap and unscrap, inventory counts,
 * non-conformance and inspection write-offs, and maintenance parts. A
 * zero-cost row is left out, as the core posts no journal for it. `family`
 * is the count each row's journal is reported under.
 *
 * Left out: a stock movement correction (it carries the original's document
 * keys), found as an item ledger row with `correctionOfItemLedgerId` written
 * in the same transaction as the cost row. A tracked unscrap also sets that
 * column, so a correction written with an Unscrap activity is kept.
 * A day is matched, not the document: a maintenance dispatch can consume
 * parts on more than one day, and only the legacy days lack a journal.
 */
export function legacyAdjustmentCostRows(
  db: Db,
  { companyId, cutoverDate }: Args
) {
  return db
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
      sql<string>`"cost"."createdAt"::text`.as("createdAt"),
      sql<
        Extract<
          LegacyDocumentFamily,
          | "inventoryAdjustments"
          | "inventoryCounts"
          | "nonConformances"
          | "maintenanceConsumptions"
        >
      >`CASE "cost"."documentType"
          WHEN 'Inventory Count' THEN 'inventoryCounts'
          WHEN 'Non-Conformance' THEN 'nonConformances'
          WHEN 'Inbound Inspection' THEN 'nonConformances'
          WHEN 'Maintenance Consumption' THEN 'maintenanceConsumptions'
          ELSE 'inventoryAdjustments'
        END`.as("family")
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
    .orderBy("cost.entryNumber");
}

/** A timestamp as a fixed-width UTC instant: it sorts as text, and inserts
 *  back as the same timestamp. */
export function utcInstant(column: string) {
  return sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * The sale movements dated on or after the cutover that their "Sale" cost
 * rows do not cover, per document and item: the item ledger rows of a posted
 * sales order shipment, and of a posted sales invoice (a direct line ships
 * through its invoice, under the invoice's id). `covered` is the quantity
 * the document's "Sale" cost rows hold. A company with accounting off stored
 * none: a sales order shipment never costed its movement, and a direct line
 * relieved its layers but wrote no row. A correction is left out: it books
 * its own cost row.
 */
export function legacySaleMovements(db: Db, { companyId, cutoverDate }: Args) {
  const movements = db
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
    .groupBy(["ledger.companyId", "ledger.documentId", "ledger.itemId"]);
  return db
    .selectFrom(movements.as("movement"))
    .selectAll("movement")
    .where(
      sql<number>`"movement"."quantity" - "movement"."covered"`,
      ">",
      EPSILON
    )
    .orderBy("movement.postingDate")
    .orderBy("movement.createdAt")
    .orderBy("movement.documentId")
    .orderBy("movement.itemId");
}

/**
 * The job movements dated on or after the cutover: material issued to a job
 * or returned from it, and the output a completion received. A correction
 * is left out: it books its own cost row. `journaled` is true when the job
 * has a journal line of the movement's type ("Job Consumption" or "Job
 * Receipt") in a journal of that posting date: the enable writes no journal
 * for a stored cost row of that day.
 */
export function legacyJobMovements(db: Db, { companyId, cutoverDate }: Args) {
  return db
    .selectFrom("itemLedger as ledger")
    .select((eb) => [
      "ledger.id",
      "ledger.entryType",
      "ledger.documentId",
      "ledger.documentLineId",
      "ledger.itemId",
      "ledger.quantity",
      "ledger.locationId",
      sql<string>`"ledger"."postingDate"::text`.as("postingDate"),
      utcInstant("ledger.createdAt").as("createdAt"),
      eb
        .exists(
          eb
            .selectFrom("journalLine as line")
            .innerJoin("journal", (join) =>
              join
                .onRef("journal.id", "=", "line.journalId")
                .onRef("journal.companyId", "=", "line.companyId")
            )
            .select("line.id")
            .whereRef("line.companyId", "=", "ledger.companyId")
            .whereRef("line.documentId", "=", "ledger.documentId")
            .whereRef("journal.postingDate", "=", "ledger.postingDate")
            .where(
              sql<boolean>`"line"."documentType"::text = CASE "ledger"."entryType" WHEN 'Consumption' THEN 'Job Consumption' ELSE 'Job Receipt' END`
            )
        )
        .as("journaled")
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
    .orderBy("ledger.entryNumber");
}

// ---------------------------------------------------------------------------
// Asset and revenue runs
// ---------------------------------------------------------------------------

/** The disposal `postDisposal` writes. The enable writes its journal again. */
export const REBUILT_DISPOSAL_METHOD = "Scrapping" as const;

/** The journals that still move the books: a Reversed one is cancelled. */
const DISPOSAL_JOURNAL_STATUSES = ["Provisional", "Posted"] as const;

/**
 * Assets disposed on or after the cutover whose disposal has no journal and
 * gets none at the enable: a sale, a return to inventory or a lease
 * commencement posted before the reset, whose journal the reset deleted. The
 * enable rebuilds only the scrap (`REBUILT_DISPOSAL_METHOD`). A disposal
 * posted after the reset keeps its own journal. The asset transfer and the
 * lease commencement store it on `fixedAssetDisposal.journalId`. A sale
 * stores none: its journal is the shipment's or the sales invoice's, so the
 * asset keeps a journal when that document credits the asset account for it
 * (`post-shipment` on `shipment:<salesOrderLineId>`, a direct
 * `post-sales-invoice` line on the invoice). The enable does not write that
 * leg for a legacy sale (legacy/shipment.ts, legacy/sales-invoice.ts).
 * Such an asset leaves the books with no journal, so it is not in the opening
 * fixed assets, and its depreciation after the cutover is not rebuilt.
 */
export function assetsLeavingWithoutJournal(
  db: Db,
  { companyId, cutoverDate }: Args
) {
  const shipmentPrefix = journalReference.to.shipment("");
  return (
    db
      .selectFrom("fixedAsset as asset")
      .innerJoin("fixedAssetClass as class", (join) =>
        join
          .onRef("class.id", "=", "asset.fixedAssetClassId")
          .onRef("class.companyId", "=", "asset.companyId")
      )
      .select("asset.id")
      .where("asset.companyId", "=", companyId)
      .where("asset.status", "=", "Disposed")
      .where("asset.disposalDate", ">=", cutoverDate)
      .where((eb) =>
        eb.or([
          eb("asset.disposalMethod", "is", null),
          eb("asset.disposalMethod", "!=", REBUILT_DISPOSAL_METHOD)
        ])
      )
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("fixedAssetDisposal as disposal")
              .select("disposal.id")
              .whereRef("disposal.fixedAssetId", "=", "asset.id")
              .whereRef("disposal.companyId", "=", "asset.companyId")
              .where("disposal.journalId", "is not", null)
          )
        )
      )
      // The sale's own journal: the asset account line of the shipment or the
      // sales invoice that sold the asset.
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
              .whereRef("line.companyId", "=", "asset.companyId")
              .whereRef("line.accountId", "=", "class.assetAccountId")
              .where("journal.status", "in", [...DISPOSAL_JOURNAL_STATUSES])
              .where((eb) =>
                eb.or([
                  eb.and([
                    eb("line.documentType", "=", "Sales Shipment"),
                    eb.exists(
                      eb
                        .selectFrom("salesOrderLine as orderLine")
                        .select("orderLine.id")
                        .whereRef("orderLine.companyId", "=", "asset.companyId")
                        .whereRef("orderLine.assetId", "=", "asset.id")
                        .where(
                          sql<boolean>`"line"."documentLineReference" = ${shipmentPrefix} || "orderLine"."id"`
                        )
                    )
                  ]),
                  eb.and([
                    eb("line.documentType", "=", "Invoice"),
                    eb.exists(
                      eb
                        .selectFrom("salesInvoiceLine as invoiceLine")
                        .select("invoiceLine.id")
                        .whereRef(
                          "invoiceLine.companyId",
                          "=",
                          "asset.companyId"
                        )
                        .whereRef(
                          "invoiceLine.invoiceId",
                          "=",
                          "line.documentId"
                        )
                        .whereRef("invoiceLine.assetId", "=", "asset.id")
                        .where(
                          "invoiceLine.invoiceLineType",
                          "=",
                          "Fixed Asset"
                        )
                    )
                  ])
                ])
              )
          )
        )
      )
  );
}

/**
 * The lines of Posted depreciation runs for months on or after the cutover
 * with no journal or no deferred tax journal. A line from before per-month
 * lines has no month: it is the run's. The depreciation of an asset that
 * leaves the books with no journal (`assetsLeavingWithoutJournal`) is left
 * out: the opening fixed assets leave it out too.
 */
export function legacyDepreciationRunLines(db: Db, args: Args) {
  const { companyId, cutoverDate } = args;
  return db
    .selectFrom("depreciationRunLine as line")
    .innerJoin("depreciationRun as run", (join) =>
      join
        .onRef("run.id", "=", "line.depreciationRunId")
        .onRef("run.companyId", "=", "line.companyId")
    )
    .innerJoin("fixedAsset as asset", (join) =>
      join
        .onRef("asset.id", "=", "line.fixedAssetId")
        .onRef("asset.companyId", "=", "line.companyId")
    )
    .innerJoin("fixedAssetClass as class", (join) =>
      join
        .onRef("class.id", "=", "asset.fixedAssetClassId")
        .onRef("class.companyId", "=", "asset.companyId")
    )
    .select([
      "line.id",
      "line.depreciationRunId",
      "run.depreciationRunId as runReadableId",
      sql<string>`coalesce("line"."periodEnd", "run"."periodEnd")::text`.as(
        "monthEnd"
      ),
      "line.amount",
      "line.taxAmount",
      "line.journalId",
      "line.deferredTaxJournalId",
      "line.fixedAssetId",
      "asset.fixedAssetId as assetReadableId",
      "asset.locationId",
      "asset.fixedAssetClassId",
      "class.depreciationExpenseAccountId",
      "class.accumulatedDepreciationAccountId"
    ])
    .where("line.companyId", "=", companyId)
    .where("run.status", "=", "Posted")
    .where(
      sql<string>`coalesce("line"."periodEnd", "run"."periodEnd")`,
      ">=",
      cutoverDate
    )
    .where((eb) =>
      eb.or([
        eb("line.journalId", "is", null),
        eb("line.deferredTaxJournalId", "is", null)
      ])
    )
    .where("line.fixedAssetId", "not in", assetsLeavingWithoutJournal(db, args))
    .orderBy("run.periodEnd")
    .orderBy("line.id");
}

/** Scrap disposals on or after the cutover with no journal. The asset's
 *  cost and accumulated depreciation did not change after its disposal. */
export function legacyDisposals(db: Db, { companyId, cutoverDate }: Args) {
  return db
    .selectFrom("fixedAssetDisposal as disposal")
    .innerJoin("fixedAsset as asset", (join) =>
      join
        .onRef("asset.id", "=", "disposal.fixedAssetId")
        .onRef("asset.companyId", "=", "disposal.companyId")
    )
    .innerJoin("fixedAssetClass as class", (join) =>
      join
        .onRef("class.id", "=", "asset.fixedAssetClassId")
        .onRef("class.companyId", "=", "asset.companyId")
    )
    .select([
      "disposal.id",
      sql<string>`"disposal"."disposalDate"::text`.as("disposalDate"),
      "asset.fixedAssetId as assetReadableId",
      "asset.acquisitionCost",
      "asset.accumulatedDepreciation",
      "asset.locationId",
      "asset.fixedAssetClassId",
      "class.assetAccountId",
      "class.accumulatedDepreciationAccountId",
      "class.lossOnDisposalAccountId"
    ])
    .where("disposal.companyId", "=", companyId)
    .where("disposal.disposalMethod", "=", REBUILT_DISPOSAL_METHOD)
    .where("disposal.journalId", "is", null)
    .where("disposal.disposalDate", ">=", cutoverDate)
    .orderBy("disposal.disposalDate")
    .orderBy("disposal.id");
}

/** The Posted revenue recognition schedule rows dated on or after the
 *  cutover with no journal, with their Posted run. */
export function legacyRecognitionSchedule(
  db: Db,
  { companyId, cutoverDate }: Args
) {
  return db
    .selectFrom("revenueRecognitionSchedule as schedule")
    .innerJoin("revenueRecognitionRunLine as runLine", (join) =>
      join
        .onRef("runLine.id", "=", "schedule.runLineId")
        .onRef("runLine.companyId", "=", "schedule.companyId")
    )
    .innerJoin("revenueRecognitionRun as run", (join) =>
      join
        .onRef("run.id", "=", "runLine.runId")
        .onRef("run.companyId", "=", "runLine.companyId")
    )
    .select([
      "schedule.id as scheduleId",
      "run.id as runId",
      "run.runId as runReadableId",
      sql<string>`"run"."periodEnd"::text`.as("runPeriodEnd"),
      sql<string>`"schedule"."scheduledDate"::text`.as("scheduledDate"),
      "schedule.type",
      "runLine.amount",
      "schedule.debitAccountId",
      "schedule.creditAccountId",
      "schedule.salesInvoiceLineId",
      "schedule.rentalAgreementLineId",
      "schedule.rentalLeaseScheduleLineId",
      "schedule.customerContractLineId"
    ])
    .where("schedule.companyId", "=", companyId)
    .where("schedule.status", "=", "Posted")
    .where("schedule.journalId", "is", null)
    .where("schedule.scheduledDate", ">=", cutoverDate)
    .where("run.status", "=", "Posted")
    .orderBy("run.periodEnd")
    .orderBy("schedule.scheduledDate")
    .orderBy("schedule.id");
}
