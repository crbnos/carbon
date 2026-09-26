export const RECEIVABLE_POSTING_DESCRIPTIONS = ["Accounts Receivable", "IC Receivables"] as const;
export const PAYABLE_POSTING_DESCRIPTIONS = ["Accounts Payable", "IC Payables"] as const;

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
export const CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION = "Customer Deposit (applied)";

export type AccountingPostingRole = "Receivables" | "Payables" | "ShippingRevenue" | "SalesRevenue";

/** Roles come from the original journal, never a mutable account name or default. */
export function classifyAccountingPostingRole(description: string | null): AccountingPostingRole | null {
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
