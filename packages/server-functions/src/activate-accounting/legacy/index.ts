// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Step 1a of the enable (.ai/specs/implemented/2026-10-08-accounting-cutover.md section
// 5a): the journals of legacy documents dated on or after the cutover. Each
// is the journal the document's posting writes today, Provisional and dated
// the document's posting date, so the later steps re-cost, period, re-point
// and promote it like every other Provisional journal. First the cost rows
// of movements that stored none (movement-cost.ts): the shipment and invoice
// builders then read a sale row like any other. Invoices, memos, charges and
// reimbursements come next; payments follow in posting order, because a
// payment reads the control line of what it settles. Movements come last:
// receipts, return receipts, shipments with their sale cost row, return
// shipments, the movements of the adjustment core, then job issues and job
// completions. The inventory reset and re-cost after this step find their
// inventory lines. Then the asset and revenue runs (runs.ts): depreciation
// runs, scrap disposals and revenue recognition runs. Run journals, and
// movement journals built from a cost row the posting stored, are kept out
// of provider sync (`keepOutOfProviderSync`).

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import {
  type LegacyDocumentCounts,
  legacyPayments
} from "@carbon/database/legacy-documents";
import { buildLegacyAdjustmentJournals } from "./adjustment";
import { buildLegacyChargeJournals } from "./charge";
import { buildLegacyMemoJournals } from "./memo";
import { writeLegacyMovementCosts } from "./movement-cost";
import { journalLegacyPayments } from "./payment";
import { buildLegacyPurchaseInvoiceJournals } from "./purchase-invoice";
import {
  buildLegacyPurchaseReceiptJournals,
  buildLegacySalesReturnReceiptJournals
} from "./receipt";
import { buildLegacyReimbursementJournals } from "./reimbursement";
import { journalLegacyRuns } from "./runs";
import { buildLegacySalesInvoiceJournals } from "./sales-invoice";
import {
  buildLegacyReturnShipmentJournals,
  buildLegacySalesShipmentJournals
} from "./shipment";
import {
  attachJournalIds,
  insertProvisionalJournals,
  type JournalDocumentTable,
  keepOutOfProviderSync,
  type LegacyDocumentJournal,
  readByIds
} from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

/** The documents the enable wrote a journal for, per family: the families
 *  `getLegacyDocumentCounts` counts before the enable. */
export type LegacyJournalCounts = LegacyDocumentCounts & {
  /** Cost rows written for movements that stored none. */
  movementCostRows: number;
};

export async function journalLegacyDocuments(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<{
  counts: LegacyJournalCounts;
  /** Every journal written, Provisional. */
  journalIds: string[];
}> {
  const args = { companyId, companyGroupId, cutoverDate, defaults };

  // Before the builders that read the sale rows.
  const movementCosts = await writeLegacyMovementCosts(trx, {
    companyId,
    cutoverDate,
    defaults
  });

  const salesInvoices = await buildLegacySalesInvoiceJournals(trx, args);
  const purchaseInvoices = await buildLegacyPurchaseInvoiceJournals(trx, args);
  const memos = await buildLegacyMemoJournals(trx, args);
  const charges = await buildLegacyChargeJournals(trx, args);
  const reimbursements = await buildLegacyReimbursementJournals(trx, args);
  const documentJournals: [JournalDocumentTable, LegacyDocumentJournal[]][] = [
    ["memo", memos],
    ["charge", charges],
    ["reimbursement", reimbursements]
  ];
  const documentJournalIds = await insertProvisionalJournals(trx, {
    companyId,
    companyGroupId,
    userId,
    journals: [
      ...salesInvoices,
      ...purchaseInvoices,
      ...documentJournals.flatMap(([, journals]) => journals)
    ]
  });
  // The memo, charge and reimbursement store the journal, as their postings do.
  let offset = salesInvoices.length + purchaseInvoices.length;
  for (const [table, journals] of documentJournals) {
    await attachJournalIds(trx, {
      table,
      companyId,
      userId,
      rows: journals.map((journal, index) => ({
        id: journal.documentId,
        journalId: documentJournalIds[offset + index] ?? null,
        payableAccountId: journal.payableAccountId
      }))
    });
    offset += journals.length;
  }

  // After every document a payment can settle has its journal. The payment
  // builder stores each journal on its payment.
  const paymentIds = (
    await legacyPayments(trx, { companyId, cutoverDate })
      .clearSelect()
      .select("payment.id")
      .execute()
  ).map((payment) => payment.id);
  const payments = await journalLegacyPayments(trx, {
    companyId,
    companyGroupId,
    userId,
    cutoverDate
  });
  const paymentJournalIds = await readByIds(paymentIds, (ids) =>
    trx
      .selectFrom("payment")
      .select("journalId")
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .where("journalId", "is not", null)
      .execute()
  );

  // The movements last: no document journal reads them, and the re-cost
  // after this step reads their inventory lines.
  const movementArgs = { companyId, cutoverDate, defaults };
  const purchaseReceipts = await buildLegacyPurchaseReceiptJournals(
    trx,
    movementArgs
  );
  const salesReturnReceipts = await buildLegacySalesReturnReceiptJournals(
    trx,
    movementArgs
  );
  const salesShipments = await buildLegacySalesShipmentJournals(trx, {
    ...movementArgs,
    backfilledSaleDocumentIds: movementCosts.backfilledSaleDocumentIds
  });
  const returnShipments = await buildLegacyReturnShipmentJournals(
    trx,
    movementArgs
  );
  const adjustments = await buildLegacyAdjustmentJournals(trx, movementArgs);
  const movements = [
    ...purchaseReceipts,
    ...salesReturnReceipts,
    ...salesShipments,
    ...returnShipments,
    ...adjustments.inventoryAdjustments,
    ...adjustments.inventoryCounts,
    ...adjustments.nonConformances,
    ...adjustments.maintenanceConsumptions,
    ...movementCosts.jobConsumptions,
    ...movementCosts.jobOutputs
  ];
  const movementJournalIds = await insertProvisionalJournals(trx, {
    companyId,
    companyGroupId,
    userId,
    journals: movements
  });
  await keepOutOfProviderSync(trx, {
    companyId,
    userId,
    journals: movements.flatMap((journal, index) => {
      const id = movementJournalIds[index];
      return id && journal.fromStoredCost
        ? [{ id, sourceType: journal.sourceType }]
        : [];
    })
  });

  // No other journal reads them, and the re-cost never touches them.
  const runs = await journalLegacyRuns(trx, {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults
  });

  // A journal with no lines is not written (`insertProvisionalJournals`).
  const written = (journals: { lines: unknown[] }[]) =>
    journals.filter((journal) => journal.lines.length > 0).length;
  return {
    counts: {
      salesInvoices: written(salesInvoices),
      purchaseInvoices: written(purchaseInvoices),
      memos: written(memos),
      charges: written(charges),
      reimbursements: written(reimbursements),
      payments,
      purchaseReceipts: written(purchaseReceipts),
      salesReturnReceipts: written(salesReturnReceipts),
      salesShipments: written(salesShipments),
      returnShipments: written(returnShipments),
      inventoryAdjustments: written(adjustments.inventoryAdjustments),
      inventoryCounts: written(adjustments.inventoryCounts),
      nonConformances: written(adjustments.nonConformances),
      maintenanceConsumptions: written(adjustments.maintenanceConsumptions),
      jobConsumptions: written(movementCosts.jobConsumptions),
      jobOutputs: written(movementCosts.jobOutputs),
      movementCostRows: movementCosts.costRows,
      ...runs.counts
    },
    journalIds: [
      ...documentJournalIds,
      ...paymentJournalIds.map((payment) => payment.journalId),
      ...movementJournalIds,
      ...runs.journalIds
    ].filter((id): id is string => id !== null)
  };
}
