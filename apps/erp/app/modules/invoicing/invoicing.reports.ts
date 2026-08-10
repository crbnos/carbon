import { parseDate } from "@internationalized/date";

// Pure aggregation for the spend-by-party reports (Revenue by Customer /
// Expenses by Supplier). Kept dependency-light (only calendar math) so it can be
// unit-tested without pulling in the whole service graph — mirrors the
// accounting module's `executivePnl.ts`.

export type SpendByPartyRow = {
  /** Customer or supplier id (null-party invoices are dropped upstream). */
  partyId: string;
  /** Total for the selected period, in the invoice document currency. */
  total: number;
  /** Total for the immediately-preceding equal-length period. */
  previousTotal: number;
  /**
   * Percentage change vs. the previous period, or null when there is no prior
   * basis (the party had no invoices last period).
   */
  variance: number | null;
};

/**
 * The equal-length period immediately preceding [startDate, endDate]. Both are
 * inclusive `YYYY-MM-DD` calendar dates, so the previous window is the same span
 * of days ending the day before startDate.
 */
export function previousPeriod(startDate: string, endDate: string) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  // Inclusive day span between the two ends (CalendarDate.compare = day diff).
  const spanDays = end.compare(start);
  const previousEnd = start.subtract({ days: 1 });
  const previousStart = previousEnd.subtract({ days: spanDays });
  return {
    previousStart: previousStart.toString(),
    previousEnd: previousEnd.toString()
  };
}

/**
 * Fold invoice rows into one row per party, splitting amounts between the
 * selected window and the previous window, and deriving a period-over-period
 * variance. Rows are `YYYY-MM-DD`-keyed, so plain string comparison bounds the
 * windows. Sorted by current-period total, descending.
 */
export function aggregateSpend(
  rows: { partyId: string | null; totalAmount: number | null; date: string }[],
  startDate: string,
  endDate: string,
  previousStart: string,
  previousEnd: string
): SpendByPartyRow[] {
  const byParty = new Map<string, { total: number; previousTotal: number }>();
  for (const row of rows) {
    if (!row.partyId) continue;
    const amount = Number(row.totalAmount ?? 0);
    if (!amount) continue;
    const entry = byParty.get(row.partyId) ?? { total: 0, previousTotal: 0 };
    if (row.date >= startDate && row.date <= endDate) {
      entry.total += amount;
    } else if (row.date >= previousStart && row.date <= previousEnd) {
      entry.previousTotal += amount;
    }
    byParty.set(row.partyId, entry);
  }

  return [...byParty.entries()]
    .map(([partyId, { total, previousTotal }]) => ({
      partyId,
      total,
      previousTotal,
      variance:
        previousTotal === 0
          ? null
          : ((total - previousTotal) / Math.abs(previousTotal)) * 100
    }))
    .filter((row) => row.total !== 0 || row.previousTotal !== 0)
    .sort((a, b) => b.total - a.total);
}
