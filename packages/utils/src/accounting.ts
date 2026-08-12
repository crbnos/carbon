import type { CalendarDate } from "@internationalized/date";
import { endOfMonth, parseDate } from "@internationalized/date";
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
  year: number,
  month: number, // 1-12
  startMonth: number
): { fiscalYear: number; periodNumber: number } {
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

/**
 * The default reporting window every range report opens on: the trailing six
 * months — the current partial month plus the five preceding whole months.
 * `endDate` is a `YYYY-MM-DD` date in the caller's business timezone (server
 * loaders pass the company-tz today; the client PeriodSelector passes the local
 * today). Single source of truth so the selector's label and the loader's query
 * can never drift ("All Time" in the picker while the data was really 6 months).
 */
export function defaultReportRange(endDate: string): {
  startDate: string;
  endDate: string;
} {
  return {
    startDate: parseDate(endDate)
      .subtract({ months: 5 })
      .set({ day: 1 })
      .toString(),
    endDate
  };
}

export type ReportColumnGranularity = "month" | "quarter" | "year";

export type ReportPeriodBucket = {
  key: string; // "2026-02" | "FY2026-Q1" | "FY2026" — stable Record key
  start: string; // ISO date (bucket start; the first bucket starts at the range start)
  end: string; // ISO date, clamped to the range end
  fiscalYear: number;
  quarter?: number; // 1-4, fiscal quarters (only for "quarter")
  isPartial: boolean; // end was clamped before the bucket's natural end
};

// Guards a monthly bucketing of a very wide range; when exceeded the MOST
// RECENT buckets are kept (the trailing periods are what reports compare).
export const MAX_REPORT_PERIOD_BUCKETS = 60;

function fiscalYearStartFor(
  date: CalendarDate,
  startMonth: number
): CalendarDate {
  const year = date.month >= startMonth ? date.year : date.year - 1;
  return date.set({ year, month: startMonth, day: 1 });
}

// Natural (unclamped) end of the bucket containing `date`.
function bucketNaturalEnd(
  date: CalendarDate,
  granularity: ReportColumnGranularity,
  startMonth: number
): CalendarDate {
  switch (granularity) {
    case "month":
      return endOfMonth(date);
    case "quarter": {
      const { periodNumber } = fiscalYearAndPeriodFor(
        date.year,
        date.month,
        startMonth
      );
      const monthsIntoQuarter = (periodNumber - 1) % 3;
      const quarterStart = date
        .subtract({ months: monthsIntoQuarter })
        .set({ day: 1 });
      return endOfMonth(quarterStart.add({ months: 2 }));
    }
    case "year":
      return endOfMonth(
        fiscalYearStartFor(date, startMonth).add({ months: 11 })
      );
  }
}

// Splits [startDate, endDate] into contiguous fiscal-aware buckets. Bucket ends
// after the first fall on natural boundaries (month/fiscal-quarter/fiscal-year
// ends); the trailing bucket is clamped to endDate and flagged isPartial when
// clamped early. The result is the ONLY valid producer of the p_period_ends
// argument to the accountTreeBalancePeriodSeries RPC (sorted ascending,
// distinct, all >= startDate).
export function computeReportPeriodBuckets(
  startDate: string,
  endDate: string,
  granularity: ReportColumnGranularity,
  fiscalStartMonth: number // 1-12
): ReportPeriodBucket[] {
  const rangeStart = parseDate(startDate);
  const rangeEnd = parseDate(endDate);
  if (rangeEnd.compare(rangeStart) < 0) return [];

  const buckets: ReportPeriodBucket[] = [];
  let cursor = rangeStart;
  while (cursor.compare(rangeEnd) <= 0) {
    const naturalEnd = bucketNaturalEnd(cursor, granularity, fiscalStartMonth);
    const isPartial = naturalEnd.compare(rangeEnd) > 0;
    const end = isPartial ? rangeEnd : naturalEnd;
    const { fiscalYear, periodNumber } = fiscalYearAndPeriodFor(
      cursor.year,
      cursor.month,
      fiscalStartMonth
    );
    const quarter = Math.ceil(periodNumber / 3);
    const key =
      granularity === "month"
        ? `${cursor.year}-${String(cursor.month).padStart(2, "0")}`
        : granularity === "quarter"
          ? `FY${fiscalYear}-Q${quarter}`
          : `FY${fiscalYear}`;

    buckets.push({
      key,
      start: cursor.toString(),
      end: end.toString(),
      fiscalYear,
      ...(granularity === "quarter" ? { quarter } : {}),
      isPartial
    });

    cursor = naturalEnd.add({ days: 1 });
  }

  return buckets.length > MAX_REPORT_PERIOD_BUCKETS
    ? buckets.slice(-MAX_REPORT_PERIOD_BUCKETS)
    : buckets;
}
