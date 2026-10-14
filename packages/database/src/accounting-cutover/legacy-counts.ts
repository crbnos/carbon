// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// How many legacy documents the enable journals, per family
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a).

import { type Expression, sql } from "kysely";
import {
  LEGACY_DOCUMENT_FAMILIES,
  LEGACY_PURCHASE_RETURN_SHIPMENT,
  LEGACY_SALES_RETURN_SHIPMENT,
  LEGACY_SALES_SHIPMENT,
  type LegacyDocumentCounts,
  legacyAdjustmentCostRows,
  legacyCharges,
  legacyDepreciationRunLines,
  legacyDisposals,
  legacyJobMovements,
  legacyMemos,
  legacyPayments,
  legacyPurchaseInvoices,
  legacyReceipts,
  legacyRecognitionSchedule,
  legacyReimbursements,
  legacySalesInvoices,
  legacyShipments
} from "../legacy-documents";
import type { CutoverArgs, CutoverDb } from "./shared";

/**
 * The legacy documents the enable journals (spec section 5a), per family, in
 * one statement: posted on or after the cutover with no journal. It counts
 * the rows of the detection the enable runs (legacy-documents.ts). A sales
 * shipment that stored no cost row counts: the enable writes the row first.
 * The enable returns the journals it wrote, and writes none for a document
 * whose journal has no lines, so its count can be lower.
 *
 * Grouped as the enable groups its journals: a job issue per job and posting
 * date, and a job completion per completion, on a day with no job journal;
 * an adjustment per document and instant (a movement with no document per
 * instant, so a CSV import is one); a depreciation or recognition run per
 * run. The keys are in the order the enable writes the families
 * (`LEGACY_DOCUMENT_FAMILIES`).
 */
export async function getLegacyDocumentCounts(
  db: CutoverDb,
  args: CutoverArgs
): Promise<LegacyDocumentCounts> {
  const adjustmentFamily = (
    family: Extract<
      keyof LegacyDocumentCounts,
      | "inventoryAdjustments"
      | "inventoryCounts"
      | "nonConformances"
      | "maintenanceConsumptions"
    >
  ) => sql<number>`(
    SELECT count(DISTINCT CASE
      WHEN "documentType" IS NULL THEN "createdAt"
      ELSE "documentType"::text || ':' || "documentId" || ':' || "createdAt"
    END)::int
    FROM "adjustment"
    WHERE "family" = ${family}
  )`;
  // A query in the template is a parenthesized subquery.
  const count = (query: { clearOrderBy(): Expression<unknown> }) =>
    sql<number>`(SELECT count(*)::int FROM ${query.clearOrderBy()} AS "row")`;

  const counts = await sql<LegacyDocumentCounts>`
    WITH
      "adjustment" AS ${legacyAdjustmentCostRows(db, args).clearOrderBy()},
      "jobMovement" AS ${legacyJobMovements(db, args).clearOrderBy()}
    SELECT
      ${count(legacySalesInvoices(db, args))} AS "salesInvoices",
      ${count(legacyPurchaseInvoices(db, args))} AS "purchaseInvoices",
      ${count(legacyMemos(db, args))} AS "memos",
      ${count(legacyCharges(db, args))} AS "charges",
      ${count(legacyReimbursements(db, args))} AS "reimbursements",
      ${count(legacyPayments(db, args))} AS "payments",
      ${count(legacyReceipts(db, args, "Purchase Order"))} AS "purchaseReceipts",
      ${count(legacyReceipts(db, args, "Sales Return Order"))} AS "salesReturnReceipts",
      ${count(
        legacyShipments(db, args, LEGACY_SALES_SHIPMENT, {
          withUncostedSales: true
        })
      )} AS "salesShipments",
      ${count(legacyShipments(db, args, LEGACY_SALES_RETURN_SHIPMENT))}
        + ${count(legacyShipments(db, args, LEGACY_PURCHASE_RETURN_SHIPMENT))}
        AS "returnShipments",
      ${adjustmentFamily("inventoryAdjustments")} AS "inventoryAdjustments",
      ${adjustmentFamily("inventoryCounts")} AS "inventoryCounts",
      ${adjustmentFamily("nonConformances")} AS "nonConformances",
      ${adjustmentFamily("maintenanceConsumptions")} AS "maintenanceConsumptions",
      (
        SELECT count(DISTINCT ("documentId", "postingDate"))::int
        FROM "jobMovement"
        WHERE "entryType" = 'Consumption' AND NOT "journaled"
      ) AS "jobConsumptions",
      (
        SELECT count(DISTINCT ("documentId", "itemId", "postingDate", "createdAt"))::int
        FROM "jobMovement"
        WHERE "entryType" = 'Assembly Output' AND NOT "journaled"
      ) AS "jobOutputs",
      (
        SELECT count(DISTINCT "depreciationRunId")::int
        FROM ${legacyDepreciationRunLines(db, args).clearOrderBy()} AS "line"
      ) AS "depreciationRuns",
      ${count(legacyDisposals(db, args))} AS "assetDisposals",
      (
        SELECT count(DISTINCT "runId")::int
        FROM ${legacyRecognitionSchedule(db, args).clearOrderBy()} AS "schedule"
      ) AS "revenueRecognitionRuns"
  `.execute(db);
  const row = counts.rows[0];
  return Object.fromEntries(
    LEGACY_DOCUMENT_FAMILIES.map((family) => [
      family,
      Number(row?.[family] ?? 0)
    ])
  ) as LegacyDocumentCounts;
}

/**
 * Whether the enable would journal any legacy document: true exactly when
 * some family of `getLegacyDocumentCounts` is above zero. One statement of
 * EXISTS tests over the same detection queries, joined by OR: Postgres
 * evaluates them left to right and stops at the first one found, so the
 * cheap document families go first and the movement and run families last.
 */
export async function hasLegacyDocuments(
  db: CutoverDb,
  args: CutoverArgs
): Promise<boolean> {
  const exists = (query: { clearOrderBy(): Expression<unknown> }) =>
    sql<boolean>`EXISTS ${query.clearOrderBy()}`;

  const result = await sql<{ found: boolean }>`
    SELECT (
      ${exists(legacySalesInvoices(db, args))}
      OR ${exists(legacyPurchaseInvoices(db, args))}
      OR ${exists(legacyMemos(db, args))}
      OR ${exists(legacyCharges(db, args))}
      OR ${exists(legacyReimbursements(db, args))}
      OR ${exists(legacyPayments(db, args))}
      OR ${exists(legacyReceipts(db, args, "Purchase Order"))}
      OR ${exists(legacyReceipts(db, args, "Sales Return Order"))}
      OR ${exists(
        legacyShipments(db, args, LEGACY_SALES_SHIPMENT, {
          withUncostedSales: true
        })
      )}
      OR ${exists(legacyShipments(db, args, LEGACY_SALES_RETURN_SHIPMENT))}
      OR ${exists(legacyShipments(db, args, LEGACY_PURCHASE_RETURN_SHIPMENT))}
      OR ${exists(legacyDisposals(db, args))}
      OR ${exists(legacyAdjustmentCostRows(db, args))}
      OR EXISTS (
        SELECT 1
        FROM ${legacyJobMovements(db, args).clearOrderBy()} AS "jobMovement"
        WHERE NOT "journaled"
      )
      OR ${exists(legacyDepreciationRunLines(db, args))}
      OR ${exists(legacyRecognitionSchedule(db, args))}
    ) AS "found"
  `.execute(db);
  return result.rows[0]?.found === true;
}
