import type {
  CarbonAccountClass,
  CarbonAccountType,
  CarbonIncomeBalance
} from "../plan.ts";

/**
 * NetSuite `accttype` → Carbon's account class, statement and type.
 *
 * The values on the left are verbatim from a live account's REST enum for
 * `account.acctType.id`. `NonPosting` and `Stat` (statistical) have no Carbon
 * counterpart and map to null, which the mapper treats as "skip this account"
 * rather than "guess".
 */
export type AccountClassification = {
  class: CarbonAccountClass;
  incomeBalance: CarbonIncomeBalance;
  accountType: CarbonAccountType;
};

const BALANCE_SHEET: CarbonIncomeBalance = "Balance Sheet";
const INCOME_STATEMENT: CarbonIncomeBalance = "Income Statement";

const MAPPING: Record<string, AccountClassification> = {
  Bank: { class: "Asset", incomeBalance: BALANCE_SHEET, accountType: "Bank" },
  AcctRec: {
    class: "Asset",
    incomeBalance: BALANCE_SHEET,
    accountType: "Accounts Receivable"
  },
  OthCurrAsset: {
    class: "Asset",
    incomeBalance: BALANCE_SHEET,
    accountType: "Other Current Asset"
  },
  FixedAsset: {
    class: "Asset",
    incomeBalance: BALANCE_SHEET,
    accountType: "Fixed Asset"
  },
  OthAsset: {
    class: "Asset",
    incomeBalance: BALANCE_SHEET,
    accountType: "Other Asset"
  },
  // NetSuite has no dedicated inventory account type; an inventory asset account
  // is an OthCurrAsset flagged `inventory`. The mapper checks that flag and
  // overrides this entry, so the default stays the conservative one.
  AcctPay: {
    class: "Liability",
    incomeBalance: BALANCE_SHEET,
    accountType: "Accounts Payable"
  },
  CredCard: {
    class: "Liability",
    incomeBalance: BALANCE_SHEET,
    accountType: "Other Current Liability"
  },
  OthCurrLiab: {
    class: "Liability",
    incomeBalance: BALANCE_SHEET,
    accountType: "Other Current Liability"
  },
  LongTermLiab: {
    class: "Liability",
    incomeBalance: BALANCE_SHEET,
    accountType: "Long Term Liability"
  },
  Equity: {
    class: "Equity",
    incomeBalance: BALANCE_SHEET,
    accountType: "Equity - No Close"
  },
  Income: {
    class: "Revenue",
    incomeBalance: INCOME_STATEMENT,
    accountType: "Income"
  },
  COGS: {
    class: "Expense",
    incomeBalance: INCOME_STATEMENT,
    accountType: "Cost of Goods Sold"
  },
  Expense: {
    class: "Expense",
    incomeBalance: INCOME_STATEMENT,
    accountType: "Expense"
  },
  OthIncome: {
    class: "Revenue",
    incomeBalance: INCOME_STATEMENT,
    accountType: "Other Income"
  },
  OthExpense: {
    class: "Expense",
    incomeBalance: INCOME_STATEMENT,
    accountType: "Other Expense"
  },
  // Deferrals are balance-sheet accounts in both systems; Carbon has no deferral
  // type, so they land on the nearest current asset / liability.
  DeferExpense: {
    class: "Asset",
    incomeBalance: BALANCE_SHEET,
    accountType: "Other Current Asset"
  },
  DeferRevenue: {
    class: "Liability",
    incomeBalance: BALANCE_SHEET,
    accountType: "Other Current Liability"
  },
  UnbilledRec: {
    class: "Asset",
    incomeBalance: BALANCE_SHEET,
    accountType: "Other Current Asset"
  }
};

export function mapAccountType(
  acctType: string | null
): AccountClassification | null {
  if (!acctType) return null;
  return MAPPING[acctType.trim()] ?? null;
}
