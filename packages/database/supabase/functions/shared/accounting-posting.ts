export const RECEIVABLE_POSTING_DESCRIPTIONS = ["Accounts Receivable", "IC Receivables"] as const;
export const PAYABLE_POSTING_DESCRIPTIONS = ["Accounts Payable", "IC Payables"] as const;

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
