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
