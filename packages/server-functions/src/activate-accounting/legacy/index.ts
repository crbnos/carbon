// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Step 1a of the enable (.ai/specs/2026-10-08-accounting-cutover.md section
// 5a): the journals of legacy documents dated on or after the cutover. Each
// is the journal the document's posting writes today, Provisional and dated
// the document's posting date, so the later steps re-cost, period, re-point
// and promote it like every other Provisional journal. Invoices come first:
// a payment reads the control line of what it settles.

import type { KyselyTx } from "@carbon/database/client";
import { buildLegacyPurchaseInvoiceJournals } from "./purchase-invoice";
import { buildLegacySalesInvoiceJournals } from "./sales-invoice";
import { insertProvisionalJournals } from "./write";

/** The documents the enable wrote a journal for, per family. */
export type LegacyJournalCounts = {
  salesInvoices: number;
  purchaseInvoices: number;
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
  const defaults = await trx
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();
  const args = {
    companyId,
    companyGroupId: company.companyGroupId,
    cutoverDate,
    defaults
  };

  const salesInvoices = await buildLegacySalesInvoiceJournals(trx, args);
  const purchaseInvoices = await buildLegacyPurchaseInvoiceJournals(trx, args);
  await insertProvisionalJournals(trx, {
    companyId,
    companyGroupId: company.companyGroupId,
    userId,
    journals: [...salesInvoices, ...purchaseInvoices]
  });

  // A zero-value document writes no journal, as its posting writes none.
  const written = (journals: { lines: unknown[] }[]) =>
    journals.filter((journal) => journal.lines.length > 0).length;
  return {
    salesInvoices: written(salesInvoices),
    purchaseInvoices: written(purchaseInvoices)
  };
}
