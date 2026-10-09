// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Legacy documents (.ai/specs/2026-10-08-accounting-cutover.md section 5a):
// posted, dated on or after the cutover, and with no journal line under
// their document keys in a journal of any status. A company with accounting
// off wrote no journal, and the reset deleted the journals of the others.

import type { KyselyTx } from "@carbon/database/client";

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

export const POSTED_INVOICE_EXCLUDED_STATUSES = NOT_POSTED;
