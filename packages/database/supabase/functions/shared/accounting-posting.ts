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
