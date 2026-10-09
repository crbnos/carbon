// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal statuses each kind of reader may read
// (.ai/specs/2026-10-08-accounting-cutover.md section 2). A Provisional
// journal counts nowhere until the accounting cutover; a Superseded one never
// counts again.

// Statuses a balance, report, snapshot, tie-out or sync counts.
export const GL_JOURNAL_STATUSES = ["Posted", "Reversed"] as const;
// Statuses a reader that follows one document's chain reads: void builders,
// GR/IR, WIP sums, intercompany lookups.
export const DOCUMENT_JOURNAL_STATUSES = [
  "Provisional",
  "Posted",
  "Reversed"
] as const;
// Statuses an open-item lookup reads: payment control lines and the memo,
// charge and reimbursement void checks.
export const OPEN_ITEM_JOURNAL_STATUSES = ["Provisional", "Posted"] as const;

export const RECEIVABLE_POSTING_DESCRIPTIONS = [
  "Accounts Receivable",
  "IC Receivables"
] as const;
export const PAYABLE_POSTING_DESCRIPTIONS = [
  "Accounts Payable",
  "IC Payables"
] as const;

/** The description a payment's NEW on-account credit control line is written
 *  with, and the exact string a later payment reads back to find which account
 *  that credit was originally booked to.
 *
 *  The writer (build-payment-journal) and the reader (post-payment-transaction)
 *  MUST agree character for character: on a mismatch the lookup returns nothing
 *  and the consuming payment silently falls back to today's default control
 *  account, so a credit booked to intercompany receivables is drawn against
 *  regular receivables instead — the original account stays credited forever
 *  and the default one goes negative, with no error anywhere. */
export function onAccountCreditDescription(isAR: boolean): string {
  return `${isAR ? "Accounts Receivable" : "Accounts Payable"} (on-account credit)`;
}

/** The description a customer DEPOSIT's unapplied cash is booked with — a
 *  payment that references a sales order or rental agreement holds that cash
 *  as a liability on the prepayment account, not as on-account receivable
 *  credit. A Disbursement carrying the same reference refunds it under the
 *  same description (mirroring the on-account leg, which is one description in
 *  both cash directions).
 *
 *  Deliberately NOT `onAccountCreditDescription`: the prior-credit lookup reads
 *  the description back to learn which account a credit was booked to, and the
 *  AR subledger views count only the receivable descriptions — a deposit must
 *  never be mistaken for either. */
export const CUSTOMER_DEPOSIT_DESCRIPTION = "Customer Deposit";

/** The description a later payment releases a deposit with (a debit on the
 *  prepayment account against the invoice it settles). Distinct from
 *  CUSTOMER_DEPOSIT_DESCRIPTION for the same reason on-account credit is
 *  released as "(credit applied)" rather than "(on-account credit)": the
 *  lookup keys on the booked description and must never read a release line
 *  as a booked credit. */
export const CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION =
  "Customer Deposit (applied)";

/** The description the employee-payable control line of a posted reimbursement
 *  journal is written with, and the exact string a later payout reads back to
 *  find the carrying value that reimbursement was originally booked at.
 *
 *  Same writer/reader contract as `onAccountCreditDescription`: on a mismatch
 *  the lookup returns nothing and the payout falls back to the document total
 *  converted at the header rate, which differs from the booked figure by the
 *  per-line rounding dust — small, but it leaves a residual on the control
 *  account that nothing will ever clear.
 *
 *  The WRITER (`post-reimbursement/build-reimbursement-journal.ts`) and the
 *  READERS (`post-payment/post-payment-transaction.ts`, the ERP's
 *  `invoicing.service.ts`) all reference this constant, so the description can
 *  never drift on one side of the contract. */
export const REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION =
  "Employee reimbursement payable";

export type AccountingPostingRole =
  | "Receivables"
  | "Payables"
  | "ShippingRevenue"
  | "SalesRevenue";

/** Roles come from the original journal, never a mutable account name or default. */
export function classifyAccountingPostingRole(
  description: string | null
): AccountingPostingRole | null {
  switch (description) {
    case "Accounts Receivable":
    case "IC Receivables":
      return "Receivables";
    case "Accounts Payable":
    case "IC Payables":
      return "Payables";
    case "Shipping Revenue":
      return "ShippingRevenue";
    case "Sales Account":
      return "SalesRevenue";
    default:
      return null;
  }
}
