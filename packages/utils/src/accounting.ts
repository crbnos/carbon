import { formatDate } from "./date";

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
type AccountClass = "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";

export const credit = (accountType: AccountType, amount: number) => {
  switch (accountType) {
    case "asset":
    case "expense":
      return -amount;
    case "liability":
    case "equity":
    case "revenue":
      return amount;
    default:
      throw new Error(`Invalid account type: ${accountType}`);
  }
};

export const debit = (accountType: AccountType, amount: number) => {
  switch (accountType) {
    case "asset":
    case "expense":
      return amount;
    case "liability":
    case "equity":
    case "revenue":
      return -amount;
    default:
      throw new Error(`Invalid account type: ${accountType}`);
  }
};

function isNaturalDebitAccount(cls: AccountClass): boolean {
  return cls === "Asset" || cls === "Expense";
}

export function toDisplayDebit(
  amount: number,
  accountClass: AccountClass
): number {
  const isDebit = isNaturalDebitAccount(accountClass) ? amount > 0 : amount < 0;
  return isDebit ? Math.abs(amount) : 0;
}

export function toDisplayCredit(
  amount: number,
  accountClass: AccountClass
): number {
  const isCredit = isNaturalDebitAccount(accountClass)
    ? amount < 0
    : amount > 0;
  return isCredit ? Math.abs(amount) : 0;
}

export function toStoredAmount(
  debitAmount: number,
  creditAmount: number,
  accountClass: AccountClass
): number {
  const type = accountClass.toLowerCase() as AccountType;
  if (debitAmount > 0) return debit(type, debitAmount);
  return credit(type, creditAmount);
}

// Posting source distinguishes operational documents (receipts, shipments,
// invoices) from accounting entries (manual JEs, depreciation, disposals).
// Locked periods reject operational posting but still accept accounting
// adjustments; Closed periods reject both. See period-closing spec §Enforcement.
export type PeriodPostingSource = "operational" | "accounting";

export const MONTH_NUMBER: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12
};

// Fiscal year is named by its ending calendar year (FY2026 = the year that
// ends in 2026). periodNumber is 1..12 counted from the fiscal start month.
export function fiscalYearAndPeriodFor(
  date: Date,
  startMonth: number
): { fiscalYear: number; periodNumber: number } {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const periodNumber = ((month - startMonth + 12) % 12) + 1;
  const fiscalYear =
    startMonth === 1 ? year : month >= startMonth ? year + 1 : year;
  return { fiscalYear, periodNumber };
}

// Display label for a monthly accounting period — its start date as a localized
// month + year (e.g. "July 2026"), no day.
export function formatPeriodLabel(startDate: string, locale?: string): string {
  return formatDate(startDate, { year: "numeric", month: "long" }, locale);
}
