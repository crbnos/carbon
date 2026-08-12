import type { ChartPeriodSeries, PeriodCell } from "../../types";
import { NET_INCOME_ACCOUNT_ID } from "../../types";

// The condensed lines an executive P&L rolls the income-statement account tree
// up into. Base categories are summed directly from leaf accounts; the three
// subtotals are derived from them.
export type ExecutivePnlRowKey =
  | "revenue"
  | "cogs"
  | "grossProfit"
  | "operatingExpenses"
  | "operatingIncome"
  | "otherIncome"
  | "otherExpense"
  | "tax"
  | "netIncome";

export type ExecutivePnlRow = {
  key: ExecutivePnlRowKey;
  /** Subtotals (Gross Profit / Operating Income / Net Income) render emphasized. */
  isSubtotal: boolean;
  /** Net Income is the bottom line — rendered with the strongest emphasis. */
  isBottomLine: boolean;
  /** Amount per bucket, keyed by ReportPeriodBucket.key. */
  values: Record<string, number>;
  /**
   * Margin as a fraction of revenue per bucket (subtotals only; `null` when
   * revenue is zero so the UI can hide it). Undefined for non-subtotal rows.
   */
  margins?: Record<string, number | null>;
};

type BaseCategory =
  | "revenue"
  | "cogs"
  | "operatingExpenses"
  | "otherIncome"
  | "otherExpense"
  | "tax";

// Map a leaf income-statement account to one of the executive P&L buckets.
// Primary split is by accountType; the class-based fallback guarantees every
// leaf lands somewhere so Net Income ties out to the income-statement root.
function categoryOf(account: ChartPeriodSeries): BaseCategory | null {
  if (account.isGroup) return null;
  if (account.id === NET_INCOME_ACCOUNT_ID) return null;

  switch (account.accountType) {
    case "Income":
      return "revenue";
    case "Other Income":
      return "otherIncome";
    case "Cost of Goods Sold":
      return "cogs";
    case "Expense":
      return "operatingExpenses";
    case "Other Expense":
      return "otherExpense";
    case "Tax":
      return "tax";
    default:
      // Uncategorized income-statement leaf — fold into the closest bucket by
      // class rather than drop it (keeps the bottom line correct).
      if (account.class === "Revenue") return "revenue";
      if (account.class === "Expense") return "operatingExpenses";
      return null;
  }
}

function cellValue(
  cell: PeriodCell | undefined,
  showTranslated: boolean
): number {
  if (!cell) return 0;
  // Income-statement lines are period activity, so the translated value must be
  // the translated netChange (period delta), NOT translatedBalance (the
  // translated cumulative balance). Fall back to the untranslated netChange.
  if (showTranslated && typeof cell.translatedNetChange === "number") {
    return cell.translatedNetChange;
  }
  return cell.netChange ?? 0;
}

/**
 * Roll an income-statement account series (already filtered to
 * `incomeBalance === "Income Statement"`) up into the executive P&L summary
 * lines, one value per period bucket.
 *
 * netChange for income-statement leaves is natural-positive (revenue positive
 * when earned, costs positive when incurred), so categories sum directly and
 * the subtotals are simple differences:
 *   Gross Profit     = Revenue − COGS
 *   Operating Income = Gross Profit − Operating Expenses
 *   Net Income       = Operating Income + Other Income − Other Expense − Tax
 */
export function computeExecutivePnl(
  accounts: ChartPeriodSeries[],
  bucketKeys: string[],
  options: { showTranslated?: boolean } = {}
): ExecutivePnlRow[] {
  const showTranslated = options.showTranslated ?? false;

  const zero = (): Record<string, number> =>
    Object.fromEntries(bucketKeys.map((key) => [key, 0]));

  const sums: Record<BaseCategory, Record<string, number>> = {
    revenue: zero(),
    cogs: zero(),
    operatingExpenses: zero(),
    otherIncome: zero(),
    otherExpense: zero(),
    tax: zero()
  };

  for (const account of accounts) {
    const category = categoryOf(account);
    if (!category) continue;
    for (const key of bucketKeys) {
      sums[category][key] += cellValue(account.periods?.[key], showTranslated);
    }
  }

  const derive = (fn: (key: string) => number): Record<string, number> =>
    Object.fromEntries(bucketKeys.map((key) => [key, fn(key)]));

  const grossProfit = derive((k) => sums.revenue[k]! - sums.cogs[k]!);
  const operatingIncome = derive(
    (k) => grossProfit[k]! - sums.operatingExpenses[k]!
  );
  const netIncome = derive(
    (k) =>
      operatingIncome[k]! +
      sums.otherIncome[k]! -
      sums.otherExpense[k]! -
      sums.tax[k]!
  );

  const marginsOf = (
    values: Record<string, number>
  ): Record<string, number | null> =>
    Object.fromEntries(
      bucketKeys.map((k) => {
        const revenue = sums.revenue[k]!;
        return [k, revenue === 0 ? null : values[k]! / revenue];
      })
    );

  return [
    {
      key: "revenue",
      isSubtotal: false,
      isBottomLine: false,
      values: sums.revenue
    },
    { key: "cogs", isSubtotal: false, isBottomLine: false, values: sums.cogs },
    {
      key: "grossProfit",
      isSubtotal: true,
      isBottomLine: false,
      values: grossProfit,
      margins: marginsOf(grossProfit)
    },
    {
      key: "operatingExpenses",
      isSubtotal: false,
      isBottomLine: false,
      values: sums.operatingExpenses
    },
    {
      key: "operatingIncome",
      isSubtotal: true,
      isBottomLine: false,
      values: operatingIncome,
      margins: marginsOf(operatingIncome)
    },
    {
      key: "otherIncome",
      isSubtotal: false,
      isBottomLine: false,
      values: sums.otherIncome
    },
    {
      key: "otherExpense",
      isSubtotal: false,
      isBottomLine: false,
      values: sums.otherExpense
    },
    { key: "tax", isSubtotal: false, isBottomLine: false, values: sums.tax },
    {
      key: "netIncome",
      isSubtotal: true,
      isBottomLine: true,
      values: netIncome,
      margins: marginsOf(netIncome)
    }
  ];
}
