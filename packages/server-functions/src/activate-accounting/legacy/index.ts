// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Step 1a of the enable (.ai/specs/2026-10-08-accounting-cutover.md section
// 5a): the journals of legacy documents dated on or after the cutover. Each
// is the journal the document's posting writes today, Provisional and dated
// the document's posting date, so the later steps re-cost, period, re-point
// and promote it like every other Provisional journal. Invoices, memos,
// charges and reimbursements come first; payments follow in posting order,
// because a payment reads the control line of what it settles.

import type { KyselyTx } from "@carbon/database/client";
import { buildLegacyChargeJournals } from "./charge";
import { buildLegacyMemoJournals } from "./memo";
import { journalLegacyPayments } from "./payment";
import { buildLegacyPurchaseInvoiceJournals } from "./purchase-invoice";
import { buildLegacyReimbursementJournals } from "./reimbursement";
import { buildLegacySalesInvoiceJournals } from "./sales-invoice";
import {
  attachJournalIds,
  insertProvisionalJournals,
  type JournalDocumentTable,
  type LegacyDocumentJournal
} from "./write";

/** The documents the enable wrote a journal for, per family. */
export type LegacyJournalCounts = {
  salesInvoices: number;
  purchaseInvoices: number;
  memos: number;
  charges: number;
  reimbursements: number;
  payments: number;
};

export async function journalLegacyDocuments(
  trx: KyselyTx,
  {
    companyId,
    userId,
    cutoverDate
  }: { companyId: string; userId: string; cutoverDate: string }
): Promise<LegacyJournalCounts> {
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company?.companyGroupId) throw new Error("Company not found");
  const companyGroupId = company.companyGroupId;
  const defaults = await trx
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();
  const args = { companyId, companyGroupId, cutoverDate, defaults };

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
  const journalIds = await insertProvisionalJournals(trx, {
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
        journalId: journalIds[offset + index] ?? null,
        payableAccountId: journal.payableAccountId
      }))
    });
    offset += journals.length;
  }

  // After every document a payment can settle has its journal.
  const payments = await journalLegacyPayments(trx, {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults
  });

  // A zero-value document writes no journal, as its posting writes none.
  const written = (journals: { lines: unknown[] }[]) =>
    journals.filter((journal) => journal.lines.length > 0).length;
  return {
    salesInvoices: written(salesInvoices),
    purchaseInvoices: written(purchaseInvoices),
    memos: written(memos),
    charges: written(charges),
    reimbursements: written(reimbursements),
    payments
  };
}
