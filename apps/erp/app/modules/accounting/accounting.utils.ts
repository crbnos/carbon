// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { credit, debit, equals, round, toStoredAmount } from "@carbon/utils";
import {
  type CalendarDate,
  endOfMonth,
  parseDate,
  startOfMonth,
  today
} from "@internationalized/date";

/**
 * Gain/(loss) on disposal of a fixed asset = sale proceeds − net book value
 * (NBV = acquisition cost − accumulated depreciation). GAAP requires this net
 * gain/loss to land on a distinct non-operating P&L line rather than being
 * comingled with the NBV write-off.
 *
 * A gain is credited to the class's `gainOnDisposalAccountId` (a Revenue account)
 * and a loss is debited to `lossOnDisposalAccountId` (an Expense account); the
 * posting sites pick the account by sign. A zero gain/loss needs no line.
 *
 * Returns the raw `gainLoss` and, for the loss (expense) convention, the signed
 * `disposalStoredAmount` ready for a `journalLine.amount`.
 */
export function computeDisposalGainLoss(
  saleProceeds: number,
  netBookValue: number
): { gainLoss: number; disposalStoredAmount: number } {
  const gainLoss = saleProceeds - netBookValue;
  const disposalStoredAmount =
    gainLoss > 0
      ? credit("expense", gainLoss)
      : gainLoss < 0
        ? debit("expense", -gainLoss)
        : 0;
  return { gainLoss, disposalStoredAmount };
}

/**
 * Display figures for one depreciation-run line: the accumulated depreciation
 * *before* this line's month and the net book value *after* it.
 *
 * `accumulatedDepreciation` is the asset's live value. On a Draft run that is
 * the pre-run balance; once the run is Posted, `postDepreciationRun` has already
 * folded every line of the asset in this run (`runAmount`) into it. A run holds
 * one line per asset per month, so a later month starts from the earlier
 * months' amounts (`earlierAmount`). Either way the row arithmetic holds:
 * `cost − accumulatedBefore − amount = nbvAfter`.
 */
export function depreciationRunLineDisplay(args: {
  acquisitionCost: number;
  accumulatedDepreciation: number;
  amount: number;
  isPosted: boolean;
  /** This asset's amounts in this run for months before this line's. */
  earlierAmount?: number;
  /** This asset's amounts in this run across all its months. */
  runAmount?: number;
}): { accumulatedDepreciationBefore: number; netBookValueAfter: number } {
  const {
    acquisitionCost,
    accumulatedDepreciation,
    amount,
    isPosted,
    earlierAmount = 0,
    runAmount = amount
  } = args;
  const accumulatedDepreciationBefore =
    accumulatedDepreciation - (isPosted ? runAmount : 0) + earlierAmount;
  const netBookValueAfter =
    acquisitionCost - accumulatedDepreciationBefore - amount;
  return { accumulatedDepreciationBefore, netBookValueAfter };
}

export type AcquisitionLineRole =
  | "asset"
  | "accumulatedDepreciation"
  | "offset";

export type AcquisitionLine = {
  role: AcquisitionLineRole;
  description: string;
  /** Signed stored amount (debit > 0, credit < 0), ready for `journalLine.amount`. */
  amount: number;
};

/**
 * GL lines for bringing a fixed asset onto the books at registration.
 *
 * Normal case (no prior depreciation) — two lines:
 *   Dr  assetAccountId    acquisitionCost   (capitalize at gross cost)
 *       Cr  offsetAccountId   acquisitionCost   (owner equity)
 *
 * Mid-life capitalization (`accumulatedDepreciation > 0`) — three lines, so the
 * GL asset/contra balances match the subledger's net book value instead of
 * overstating the asset at gross with the subledger starting at NBV:
 *   Dr  assetAccountId                     acquisitionCost           (gross cost)
 *       Cr  accumulatedDepreciationAccountId   accumulatedDepreciation   (opening contra)
 *       Cr  offsetAccountId                    nbv (= cost − accum dep)  (owner equity)
 *
 * Debits (cost) always equal credits (accum dep + nbv), so the entry balances.
 */
export function acquisitionLines(
  acquisitionCost: number,
  accumulatedDepreciation = 0
): AcquisitionLine[] {
  // Accumulated depreciation can never exceed gross cost — that would imply a
  // negative net book value and produce an unbalanced/absurd entry. Reject it
  // before building any lines.
  if (accumulatedDepreciation > acquisitionCost) {
    throw new Error(
      "Accumulated depreciation cannot exceed the acquisition cost"
    );
  }

  const nbv = acquisitionCost - accumulatedDepreciation;
  const lines: AcquisitionLine[] = [
    {
      role: "asset",
      description: "Capitalize fixed asset at cost",
      amount: toStoredAmount(acquisitionCost, 0, "Asset")
    }
  ];
  if (accumulatedDepreciation > 0) {
    lines.push({
      role: "accumulatedDepreciation",
      description: "Opening accumulated depreciation",
      amount: toStoredAmount(0, accumulatedDepreciation, "Asset")
    });
  }
  lines.push({
    role: "offset",
    description: "Direct asset registration (owner equity)",
    amount: toStoredAmount(0, nbv, "Equity")
  });
  return lines;
}

export const macrsPropertyClasses = [
  "3",
  "5",
  "7",
  "10",
  "15",
  "20",
  "27.5",
  "39"
] as const;

export const macrsConventions = ["Half-Year", "Mid-Quarter"] as const;

export type MacrsPropertyClass = (typeof macrsPropertyClasses)[number];
export type MacrsConvention = (typeof macrsConventions)[number];

// IRS Revenue Procedure 87-57, Table 1 (GDS, Half-Year Convention)
const MACRS_HALF_YEAR: Record<string, number[]> = {
  "3": [33.33, 44.45, 14.81, 7.41],
  "5": [20.0, 32.0, 19.2, 11.52, 11.52, 5.76],
  "7": [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  "10": [10.0, 18.0, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
  "15": [
    5.0, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9,
    5.91, 2.95
  ],
  "20": [
    3.75, 7.219, 6.677, 6.177, 5.713, 5.285, 4.888, 4.522, 4.462, 4.461, 4.462,
    4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 2.231
  ]
};

// IRS Tables 2-5 (GDS, Mid-Quarter Convention)
const MACRS_MID_QUARTER: Record<string, Record<number, number[]>> = {
  "3": {
    1: [58.33, 27.78, 12.35, 1.54],
    2: [41.67, 38.89, 14.14, 5.3],
    3: [25.0, 50.0, 16.67, 8.33],
    4: [8.33, 61.11, 20.37, 10.19]
  },
  "5": {
    1: [35.0, 26.0, 15.6, 11.01, 11.01, 1.38],
    2: [25.0, 30.0, 18.0, 11.37, 11.37, 4.26],
    3: [15.0, 34.0, 20.4, 12.24, 11.3, 7.06],
    4: [5.0, 38.0, 22.8, 13.68, 10.94, 9.58]
  },
  "7": {
    1: [25.0, 21.43, 15.31, 10.93, 8.75, 8.74, 8.75, 1.09],
    2: [17.85, 23.47, 16.76, 11.97, 8.87, 8.87, 8.87, 3.34],
    3: [10.71, 25.51, 18.22, 13.02, 9.3, 8.85, 8.86, 5.53],
    4: [3.57, 27.55, 19.68, 14.06, 10.04, 8.73, 8.73, 7.64]
  },
  "10": {
    1: [17.5, 16.5, 13.2, 10.56, 8.45, 6.76, 6.55, 6.55, 6.56, 6.55, 0.82],
    2: [12.5, 17.5, 14.0, 11.2, 8.96, 7.17, 6.55, 6.55, 6.56, 6.55, 2.46],
    3: [7.5, 18.5, 14.8, 11.84, 9.47, 7.58, 6.55, 6.55, 6.56, 6.55, 4.1],
    4: [2.5, 19.5, 15.6, 12.48, 9.98, 7.99, 6.55, 6.55, 6.56, 6.55, 5.74]
  },
  "15": {
    1: [
      8.75, 9.13, 8.21, 7.39, 6.65, 5.99, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 0.74
    ],
    2: [
      6.25, 9.38, 8.44, 7.59, 6.83, 6.15, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 2.21
    ],
    3: [
      3.75, 9.63, 8.66, 7.8, 7.02, 6.31, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 3.69
    ],
    4: [
      1.25, 9.88, 8.89, 8.0, 7.2, 6.48, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91,
      5.9, 5.91, 5.17
    ]
  },
  "20": {
    1: [
      6.563, 7.0, 6.482, 5.996, 5.546, 5.13, 4.746, 4.459, 4.459, 4.459, 4.459,
      4.46, 4.459, 4.46, 4.459, 4.46, 4.459, 4.46, 4.459, 4.46, 0.557
    ],
    2: [
      4.688, 7.148, 6.612, 6.116, 5.658, 5.233, 4.841, 4.478, 4.463, 4.463,
      4.463, 4.463, 4.463, 4.463, 4.463, 4.462, 4.463, 4.462, 4.463, 4.462,
      1.673
    ],
    3: [
      2.813, 7.289, 6.742, 6.237, 5.769, 5.336, 4.936, 4.566, 4.46, 4.46, 4.46,
      4.461, 4.46, 4.461, 4.46, 4.461, 4.46, 4.461, 4.46, 4.461, 2.788
    ],
    4: [
      0.938, 7.43, 6.872, 6.357, 5.88, 5.439, 5.031, 4.654, 4.458, 4.458, 4.458,
      4.458, 4.458, 4.458, 4.458, 4.458, 4.458, 4.458, 4.459, 4.458, 3.901
    ]
  }
};

export function getMacrsPercentage(
  propertyClass: MacrsPropertyClass,
  yearInService: number,
  convention: MacrsConvention,
  quarterPlacedInService?: number
): number | null {
  if (propertyClass === "27.5" || propertyClass === "39") {
    return null;
  }

  const yearIndex = yearInService - 1;

  if (convention === "Half-Year") {
    const table = MACRS_HALF_YEAR[propertyClass];
    if (!table || yearIndex >= table.length) return 0;
    return table[yearIndex];
  }

  const quarter = quarterPlacedInService ?? 1;
  const classTable = MACRS_MID_QUARTER[propertyClass];
  if (!classTable) return 0;
  const table = classTable[quarter];
  if (!table || yearIndex >= table.length) return 0;
  return table[yearIndex];
}

const QUARTER_OF_MONTH = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4];

export function calculateMacrsDepreciation(args: {
  adjustedBasis: number;
  propertyClass: MacrsPropertyClass;
  convention: MacrsConvention;
  depreciationStartDate: string;
  periodEnd: string;
  lastPostedPeriodEnd: string | null;
  accumulatedTaxDepreciation: number;
  bonusAmount: number;
  /** Settlement decimals from currency.decimalPlaces — data, never a literal. */
  decimalPlaces: number;
}): number {
  const {
    adjustedBasis,
    propertyClass,
    convention,
    depreciationStartDate,
    periodEnd,
    lastPostedPeriodEnd,
    decimalPlaces,
    accumulatedTaxDepreciation,
    bonusAmount
  } = args;

  if (adjustedBasis <= 0) return 0;

  const startDate = toCalendarDate(depreciationStartDate);
  const periodEndDate = toCalendarDate(periodEnd);
  const fromDate = lastPostedPeriodEnd
    ? toCalendarDate(lastPostedPeriodEnd)
    : startDate;

  // 27.5 and 39-year property: straight-line with mid-month convention
  if (propertyClass === "27.5" || propertyClass === "39") {
    const lifeMonths = propertyClass === "27.5" ? 27.5 * 12 : 39 * 12;
    const monthlyAmount = adjustedBasis / lifeMonths;
    const monthsElapsed =
      (periodEndDate.year - fromDate.year) * 12 +
      (periodEndDate.month - fromDate.month);
    const months = lastPostedPeriodEnd ? monthsElapsed : monthsElapsed + 0.5;
    const amount = monthlyAmount * Math.max(0, months);
    const remaining =
      adjustedBasis - (accumulatedTaxDepreciation - bonusAmount);
    return Math.min(round(amount, decimalPlaces), Math.max(0, remaining));
  }

  // Table-based MACRS: compute cumulative depreciation through periodEnd,
  // then subtract what has already been taken (accumulatedTaxDepreciation - bonusAmount).
  // MACRS years are calendar years. The IRS percentages already incorporate the
  // convention (half-year or mid-quarter), so year 1 = the full first calendar year amount.
  // Year 1 is spread across months from placed-in-service through Dec 31.
  // Subsequent years are spread evenly across 12 calendar months.
  // Calendar quarter of the month placed in service (1–4).
  const quarterPlaced = QUARTER_OF_MONTH[startDate.month - 1];
  const startYear = startDate.year;
  const periodEndYear = periodEndDate.year;
  const lastYearToCalc = periodEndYear - startYear + 1;
  const startMonth = startDate.month - 1; // 0-based

  let cumulativeThrough = 0;

  for (let year = 1; year <= lastYearToCalc; year++) {
    const pct = getMacrsPercentage(
      propertyClass,
      year,
      convention,
      quarterPlaced
    );
    if (pct === null || pct === 0) continue;

    const annualAmount = adjustedBasis * (pct / 100);
    const totalMonthsInYear = year === 1 ? 12 - startMonth : 12;
    const monthlyAmount = annualAmount / totalMonthsInYear;

    if (year < lastYearToCalc) {
      cumulativeThrough += annualAmount;
    } else {
      // Count months from the start of this MACRS year through periodEnd
      const yearStartMonth = year === 1 ? startMonth : 0;
      const calendarYear = startYear + year - 1;
      const periodEndMonth =
        periodEndDate.year === calendarYear ? periodEndDate.month - 1 : 11;

      const monthsElapsed = periodEndMonth - yearStartMonth + 1;
      cumulativeThrough +=
        monthlyAmount * Math.min(monthsElapsed, totalMonthsInYear);
    }
  }

  const alreadyTaken = accumulatedTaxDepreciation - bonusAmount;
  const periodAmount = cumulativeThrough - Math.max(0, alreadyTaken);
  const remaining = adjustedBasis - Math.max(0, alreadyTaken);
  return Math.min(
    round(Math.max(0, periodAmount), decimalPlaces),
    Math.max(0, remaining)
  );
}

export type DepreciationLine = {
  fixedAssetId: string;
  /** The month end this line depreciates; it posts in that month's period. */
  periodEnd: string;
  amount: number;
  taxAmount: number | null;
};

/** The usage map key for one asset in one month. */
export function usageKey(fixedAssetId: string, monthEnd: string): string {
  return `${fixedAssetId}|${monthEnd}`;
}

/**
 * Whether a Draft depreciation run's stored lines are exactly what the period
 * should post now — same assets, same book and tax amounts. A Draft is
 * computed once; an asset disposed, added or re-valued since makes it stale.
 */
export function depreciationRunLinesMatch(
  stored: Array<{
    fixedAssetId: string;
    periodEnd: string;
    amount: number | string;
    taxAmount: number | string | null;
  }>,
  computed: DepreciationLine[]
): boolean {
  if (stored.length !== computed.length) return false;
  const byMonth = new Map(
    stored.map((line) => [usageKey(line.fixedAssetId, line.periodEnd), line])
  );
  if (byMonth.size !== stored.length) return false;
  return computed.every((line) => {
    const match = byMonth.get(usageKey(line.fixedAssetId, line.periodEnd));
    if (!match || !equals(Number(match.amount), line.amount)) return false;
    if (match.taxAmount === null || line.taxAmount === null) {
      return match.taxAmount === null && line.taxAmount === null;
    }
    return equals(Number(match.taxAmount), line.taxAmount);
  });
}

/** A `YYYY-MM-DD` (or ISO timestamp) as a calendar day — no timezone, so
 *  Jan 1 is Jan 1 on every server. */
function toCalendarDate(date: string): CalendarDate {
  return parseDate(date.slice(0, 10));
}

export function getMonthsBetween(
  start: CalendarDate,
  end: CalendarDate
): number {
  const years = end.year - start.year;
  const months = end.month - start.month;
  let total = years * 12 + months;
  if (end.day >= start.day) total += 1;
  return Math.max(0, total);
}

export function getMonthsElapsed(
  start: CalendarDate,
  end: CalendarDate
): number {
  const years = end.year - start.year;
  const months = end.month - start.month;
  return Math.max(0, years * 12 + months);
}

/** The first day of the month after `dateStr`. Taking the month start first
 *  keeps Aug 31 from overflowing a 30-day September into October. */
export function addOneMonth(dateStr: string): CalendarDate {
  return startOfMonth(toCalendarDate(dateStr)).add({ months: 1 });
}

export function getLastDayOfMonth(year: number, month: number): string {
  // Construct in UTC — a local-time Date serialized via toISOString() rolls
  // back a day in east-of-UTC (positive-offset) timezones (e.g. Feb 28 → Feb 27).
  const d = new Date(Date.UTC(year, month + 1, 0));
  return d.toISOString().split("T")[0];
}

/**
 * The month end after `lastPeriodEnd`; with no prior run, the end of the
 * current month of `todayIso` (a `YYYY-MM-DD` business date, default UTC
 * today). Depreciation runs for the month in progress, so its first run is
 * this month.
 */
export function getNextPeriodEnd(
  lastPeriodEnd: string | null,
  todayIso?: string
): string {
  const base = lastPeriodEnd
    ? parseDate(lastPeriodEnd).add({ months: 1 })
    : todayIso
      ? parseDate(todayIso)
      : today("UTC");
  return endOfMonth(base).toString();
}

/**
 * The month end after `lastPeriodEnd`; with no prior run, the end of the
 * month BEFORE `todayIso`. Revenue is recognized for a month once it has
 * closed (the monthly proposal job runs on the 1st for the prior month), so a
 * first run proposed in November is for October. Defaulting to the current
 * month would sweep the current month's rows into the same run a month early.
 */
export function getNextRevenueRecognitionPeriodEnd(
  lastPeriodEnd: string | null,
  todayIso: string
): string {
  const base = lastPeriodEnd
    ? parseDate(lastPeriodEnd).add({ months: 1 })
    : parseDate(todayIso).subtract({ months: 1 });
  const next = endOfMonth(base).toString();
  // A month that has not started cannot run (isFutureRunPeriod). After a run
  // for the current month, stay on it: a period can take more than one run.
  const currentMonthEnd = endOfMonth(parseDate(todayIso)).toString();
  return next > currentMonthEnd ? currentMonthEnd : next;
}

/**
 * Whether a period run ends after the company's current month. A run may
 * cover the current month (a close can start before the month ends) or an
 * earlier one, never a month that has not started — that recognizes revenue
 * or depreciation early.
 */
export function isFutureRunPeriod(
  periodEnd: string,
  companyToday: string
): boolean {
  return periodEnd > endOfMonth(parseDate(companyToday)).toString();
}

/** The last day of the month a `YYYY-MM-DD` (or ISO timestamp) falls in. */
export function monthEndOf(date: string): string {
  return endOfMonth(parseDate(date.slice(0, 10))).toString();
}

/**
 * The posting date for each month a run covers: the month's own end, so a
 * catch-up run puts each month in its own period — or the run's `periodEnd`
 * when the month's period is Closed and can no longer take a posting.
 */
export function runPostingTargets(args: {
  months: string[];
  runPeriodEnd: string;
  closedMonths: Set<string>;
}): Map<string, string> {
  return new Map(
    args.months.map((month) => [
      month,
      args.closedMonths.has(month) ? args.runPeriodEnd : month
    ])
  );
}

export function calculateDepreciation(
  asset: {
    acquisitionCost: number;
    accumulatedDepreciation: number;
    residualValuePercent: number;
    depreciationMethod: string;
    usefulLifeMonths: number;
    depreciationStartDate: string | null;
    acquisitionDate: string | null;
    assetLifetimeUsage: number | null;
  },
  periodEnd: string,
  lastPostedPeriodEnd: string | null,
  /** Settlement decimals from currency.decimalPlaces — data, never a literal. */
  decimalPlaces: number,
  usageLog?: { unitsProduced: number }
): number {
  const cost = Number(asset.acquisitionCost);
  const residualValue = cost * (Number(asset.residualValuePercent) / 100);
  const depreciableBase = cost - residualValue;
  const accumulated = Number(asset.accumulatedDepreciation);
  const remainingDepreciable = depreciableBase - accumulated;

  if (remainingDepreciable <= 0) return 0;

  const periodEndDate = toCalendarDate(periodEnd);
  const startDate = toCalendarDate(
    asset.depreciationStartDate ?? asset.acquisitionDate!
  );

  if (startDate.compare(periodEndDate) > 0) return 0;

  switch (asset.depreciationMethod) {
    case "Straight Line": {
      const monthlyAmount = depreciableBase / asset.usefulLifeMonths;
      const from = lastPostedPeriodEnd
        ? addOneMonth(lastPostedPeriodEnd)
        : startDate;
      const monthsToDepreciate = getMonthsBetween(from, periodEndDate);
      const amount = monthlyAmount * monthsToDepreciate;
      return Math.min(round(amount, decimalPlaces), remainingDepreciable);
    }
    case "Declining Balance": {
      const annualRate = (1 / (asset.usefulLifeMonths / 12)) * 2;
      const monthlyRate = annualRate / 12;
      const from = lastPostedPeriodEnd
        ? addOneMonth(lastPostedPeriodEnd)
        : startDate;
      const monthsToDepreciate = getMonthsBetween(from, periodEndDate);
      let totalDepr = 0;
      let nbv = cost - accumulated;
      for (let i = 0; i < monthsToDepreciate; i++) {
        const dbAmount = nbv * monthlyRate;
        const remainingMonths = Math.max(
          1,
          asset.usefulLifeMonths -
            getMonthsElapsed(startDate, periodEndDate) +
            monthsToDepreciate -
            i
        );
        const slAmount = (nbv - residualValue) / remainingMonths;
        const amount = Math.max(dbAmount, slAmount);
        const capped = Math.min(amount, nbv - residualValue);
        if (capped <= 0) break;
        totalDepr += capped;
        nbv -= capped;
      }
      return Math.min(round(totalDepr, decimalPlaces), remainingDepreciable);
    }
    case "Units of Production": {
      if (
        !usageLog ||
        !asset.assetLifetimeUsage ||
        Number(asset.assetLifetimeUsage) <= 0
      )
        return 0;
      const ratePerUnit = depreciableBase / Number(asset.assetLifetimeUsage);
      const amount = ratePerUnit * usageLog.unitsProduced;
      return Math.min(round(amount, decimalPlaces), remainingDepreciable);
    }
    default:
      return 0;
  }
}

export function calculateTaxDepreciation(
  asset: {
    acquisitionCost: number;
    accumulatedTaxDepreciation: number;
    depreciationStartDate: string | null;
    acquisitionDate: string | null;
    taxDepreciationMethod: string | null;
    taxUsefulLifeMonths: number | null;
    taxResidualValuePercent: number | null;
    macrsPropertyClass: string | null;
    macrsConvention: string | null;
    bonusDepreciationPercent: number | null;
  },
  periodEnd: string,
  lastPostedPeriodEnd: string | null,
  /** Settlement decimals from currency.decimalPlaces — data, never a literal. */
  decimalPlaces: number
): number | null {
  const taxMethod = asset.taxDepreciationMethod;
  if (!taxMethod) return null;

  const cost = Number(asset.acquisitionCost);
  const accumulatedTax = Number(asset.accumulatedTaxDepreciation);
  const startDate = asset.depreciationStartDate ?? asset.acquisitionDate!;

  if (taxMethod === "MACRS") {
    const propertyClass = asset.macrsPropertyClass! as MacrsPropertyClass;
    const convention = (asset.macrsConvention ??
      "Half-Year") as MacrsConvention;
    const bonusPct = Number(asset.bonusDepreciationPercent ?? 0);
    const bonusAmount = cost * (bonusPct / 100);
    const adjustedBasis = cost - bonusAmount;

    let bonus = 0;
    if (accumulatedTax === 0 && bonusAmount > 0) {
      bonus = bonusAmount;
    }

    const macrsAmount = calculateMacrsDepreciation({
      adjustedBasis,
      propertyClass,
      convention,
      depreciationStartDate: startDate,
      periodEnd,
      lastPostedPeriodEnd,
      accumulatedTaxDepreciation: accumulatedTax,
      bonusAmount,
      decimalPlaces
    });

    return round(bonus + macrsAmount, decimalPlaces);
  }

  const taxLife = asset.taxUsefulLifeMonths!;
  const taxResidualPct = Number(asset.taxResidualValuePercent ?? 0);
  const residualValue = cost * (taxResidualPct / 100);
  const depreciableBase = cost - residualValue;
  const remainingDepreciable = depreciableBase - accumulatedTax;

  if (remainingDepreciable <= 0) return 0;

  const periodEndDate = toCalendarDate(periodEnd);
  const depStartDate = toCalendarDate(startDate);

  if (depStartDate.compare(periodEndDate) > 0) return 0;

  const from = lastPostedPeriodEnd
    ? addOneMonth(lastPostedPeriodEnd)
    : depStartDate;
  const monthsToDepreciate = getMonthsBetween(from, periodEndDate);

  if (taxMethod === "Straight Line") {
    const monthlyAmount = depreciableBase / taxLife;
    const amount = monthlyAmount * monthsToDepreciate;
    return Math.min(round(amount, decimalPlaces), remainingDepreciable);
  }

  if (taxMethod === "Declining Balance") {
    const annualRate = (1 / (taxLife / 12)) * 2;
    const monthlyRate = annualRate / 12;
    let totalDepr = 0;
    let nbv = cost - accumulatedTax;
    for (let i = 0; i < monthsToDepreciate; i++) {
      const dbAmount = nbv * monthlyRate;
      const remainingMonths = Math.max(
        1,
        taxLife -
          getMonthsElapsed(depStartDate, periodEndDate) +
          monthsToDepreciate -
          i
      );
      const slAmount = (nbv - residualValue) / remainingMonths;
      const amount = Math.max(dbAmount, slAmount);
      const capped = Math.min(amount, nbv - residualValue);
      if (capped <= 0) break;
      totalDepr += capped;
      nbv -= capped;
    }
    return Math.min(round(totalDepr, decimalPlaces), remainingDepreciable);
  }

  return null;
}

/** Cost less residual less what is already accumulated, never negative. */
function depreciableRemaining(
  asset: { acquisitionCost: number; residualValuePercent: number },
  accumulated: number,
  decimalPlaces: number
): number {
  const cost = Number(asset.acquisitionCost);
  const base = cost - cost * (Number(asset.residualValuePercent) / 100);
  return Math.max(0, round(base - accumulated, decimalPlaces));
}

/**
 * What a Straight Line asset is behind by after its cost was raised: the
 * depreciation its CURRENT cost would have accumulated from its start through
 * `through` (the last month already depreciated), less what it accumulated at
 * the old cost. Never negative — an asset ahead of schedule (an opening
 * balance at registration) is left alone.
 */
export function straightLineShortfall(args: {
  acquisitionCost: number;
  residualValuePercent: number;
  usefulLifeMonths: number;
  startDate: string;
  through: string | null;
  accumulated: number;
  /** Settlement decimals from currency.decimalPlaces — data, never a literal. */
  decimalPlaces: number;
}): number {
  if (!args.through || args.usefulLifeMonths <= 0) return 0;
  const start = toCalendarDate(args.startDate);
  const through = toCalendarDate(args.through);
  if (start.compare(through) > 0) return 0;
  const cost = Number(args.acquisitionCost);
  const depreciableBase =
    cost - cost * (Number(args.residualValuePercent) / 100);
  const expected = Math.min(
    round(
      (depreciableBase / args.usefulLifeMonths) *
        getMonthsBetween(start, through),
      args.decimalPlaces
    ),
    depreciableBase
  );
  return Math.max(0, round(expected - args.accumulated, args.decimalPlaces));
}

/**
 * One line per asset per month, from the month after `lastPostedPeriodEnd` (or
 * the asset's start month) through `periodEnd` — FAM's depreciation history
 * record. Each month is calculated on its own, with the accumulated book and
 * tax depreciation of the months before it, so a catch-up run posts each
 * month in its own period at the amount a monthly run would have posted.
 * `usageMap` holds Units of Production usage by `usageKey(asset, month)`.
 *
 * An asset whose cost was adjusted after capitalization (`costAdjusted`, a
 * posted Cost Adjustment transfer) took its earlier months at the old cost.
 * Straight Line — book, and tax when its method is Straight Line — adds that
 * shortfall to the run's first month, so the asset still ends on its original
 * schedule. Declining Balance and MACRS need nothing: both depreciate what is
 * left over the life that is left. Units of Production does not catch up.
 */
export function buildDepreciationLines(
  assets: Array<{
    id: string;
    acquisitionCost: number;
    accumulatedDepreciation: number;
    residualValuePercent: number;
    depreciationMethod: string;
    usefulLifeMonths: number;
    depreciationStartDate: string | null;
    acquisitionDate: string | null;
    assetLifetimeUsage: number | null;
    accumulatedTaxDepreciation?: number;
    taxDepreciationMethod: string | null;
    taxUsefulLifeMonths: number | null;
    taxResidualValuePercent: number | null;
    macrsPropertyClass: string | null;
    macrsConvention: string | null;
    bonusDepreciationPercent: number | null;
    costAdjusted?: boolean;
  }>,
  periodEnd: string,
  lastPostedPeriodEnd: string | null,
  taxEnabled: boolean,
  usageMap: Map<string, number>,
  /** Settlement decimals from currency.decimalPlaces — data, never a literal. */
  decimalPlaces: number
): DepreciationLine[] {
  const lines: DepreciationLine[] = [];

  for (const asset of assets) {
    const start = asset.depreciationStartDate ?? asset.acquisitionDate;
    const afterLastPosted = lastPostedPeriodEnd
      ? endOfMonth(parseDate(lastPostedPeriodEnd).add({ months: 1 }))
      : null;
    const startMonth = start ? endOfMonth(parseDate(start.slice(0, 10))) : null;
    // The later of the month after the last posted run and the asset's
    // in-service month: an asset placed in service after that run gets no
    // line (and no bonus depreciation) for the months before it.
    const firstMonth =
      afterLastPosted && startMonth
        ? afterLastPosted.compare(startMonth) >= 0
          ? afterLastPosted
          : startMonth
        : (afterLastPosted ?? startMonth ?? endOfMonth(parseDate(periodEnd)));

    let accumulated = Number(asset.accumulatedDepreciation);
    let accumulatedTax = Number(asset.accumulatedTaxDepreciation ?? 0);
    // The month before the first one, as the calculators expect it.
    let previous =
      afterLastPosted && firstMonth !== afterLastPosted
        ? endOfMonth(firstMonth.subtract({ months: 1 })).toString()
        : lastPostedPeriodEnd;

    let catchUp = 0;
    let taxCatchUp = 0;
    if (asset.costAdjusted && start) {
      if (asset.depreciationMethod === "Straight Line") {
        catchUp = straightLineShortfall({
          acquisitionCost: Number(asset.acquisitionCost),
          residualValuePercent: Number(asset.residualValuePercent),
          usefulLifeMonths: asset.usefulLifeMonths,
          startDate: start,
          through: previous,
          accumulated,
          decimalPlaces
        });
      }
      if (
        taxEnabled &&
        asset.taxDepreciationMethod === "Straight Line" &&
        asset.taxUsefulLifeMonths
      ) {
        taxCatchUp = straightLineShortfall({
          acquisitionCost: Number(asset.acquisitionCost),
          residualValuePercent: Number(asset.taxResidualValuePercent ?? 0),
          usefulLifeMonths: asset.taxUsefulLifeMonths,
          startDate: start,
          through: previous,
          accumulated: accumulatedTax,
          decimalPlaces
        });
      }
    }

    for (
      let month = firstMonth;
      month.toString() <= periodEnd;
      month = endOfMonth(month.add({ months: 1 }))
    ) {
      const monthEnd = month.toString();
      const units = usageMap.get(usageKey(asset.id, monthEnd)) ?? 0;
      const scheduled = calculateDepreciation(
        {
          acquisitionCost: Number(asset.acquisitionCost),
          accumulatedDepreciation: accumulated,
          residualValuePercent: Number(asset.residualValuePercent),
          depreciationMethod: asset.depreciationMethod,
          usefulLifeMonths: asset.usefulLifeMonths,
          depreciationStartDate: asset.depreciationStartDate,
          acquisitionDate: asset.acquisitionDate,
          assetLifetimeUsage: asset.assetLifetimeUsage
            ? Number(asset.assetLifetimeUsage)
            : null
        },
        monthEnd,
        previous,
        decimalPlaces,
        { unitsProduced: units }
      );
      // The catch-up lands on the first month only, within what is left.
      const amount =
        catchUp > 0
          ? Math.min(
              round(scheduled + catchUp, decimalPlaces),
              depreciableRemaining(asset, accumulated, decimalPlaces)
            )
          : scheduled;
      catchUp = 0;

      let taxAmount: number | null = null;
      if (taxEnabled) {
        taxAmount = calculateTaxDepreciation(
          {
            acquisitionCost: Number(asset.acquisitionCost),
            accumulatedTaxDepreciation: accumulatedTax,
            depreciationStartDate: asset.depreciationStartDate,
            acquisitionDate: asset.acquisitionDate,
            taxDepreciationMethod: asset.taxDepreciationMethod,
            taxUsefulLifeMonths: asset.taxUsefulLifeMonths,
            taxResidualValuePercent: asset.taxResidualValuePercent,
            macrsPropertyClass: asset.macrsPropertyClass,
            macrsConvention: asset.macrsConvention,
            bonusDepreciationPercent: asset.bonusDepreciationPercent
          },
          monthEnd,
          previous,
          decimalPlaces
        );
        if (taxAmount === null) {
          taxAmount = amount;
        } else if (taxCatchUp > 0) {
          taxAmount = Math.min(
            round(taxAmount + taxCatchUp, decimalPlaces),
            depreciableRemaining(
              {
                acquisitionCost: asset.acquisitionCost,
                residualValuePercent: asset.taxResidualValuePercent ?? 0
              },
              accumulatedTax,
              decimalPlaces
            )
          );
        }
        taxCatchUp = 0;
      }

      if (amount > 0 || (taxAmount !== null && taxAmount > 0)) {
        lines.push({
          fixedAssetId: asset.id,
          periodEnd: monthEnd,
          amount,
          taxAmount
        });
      }
      accumulated += amount;
      accumulatedTax += taxAmount ?? 0;
      previous = monthEnd;
    }
  }

  return lines;
}

type JournalLineDimension = { dimensionId: string; valueId: string };

/** A journal line as stored. */
export type StoredJournalLine = {
  id: string;
  accountId: string | null;
  description: string | null;
  amount: number;
  dimensions: JournalLineDimension[];
};

/** A journal line as submitted, its amount already class-signed. */
export type SubmittedJournalLine = {
  /** The stored line it edits; absent (or unmatched) for a new line. */
  id?: string;
  accountId: string;
  description?: string;
  amount: number;
  dimensions: JournalLineDimension[];
};

export type JournalLineChange = {
  op: "keep" | "update" | "insert";
  /** Set for `keep` and `update`. */
  id?: string;
  accountId: string;
  description: string | null;
  amount: number;
  dimensions: JournalLineDimension[];
  /** Whether the line's dimension set must be rewritten. */
  dimensionsChanged: boolean;
};

const dimensionKey = (dimensions: JournalLineDimension[]) =>
  dimensions
    .map((d) => `${d.dimensionId}:${d.valueId}`)
    .sort()
    .join("|");

/**
 * Turns a submitted set of journal lines into the changes against the stored
 * ones, in submitted order: a line whose id matches a stored line is kept or
 * updated in place (updated only when its account, description or amount
 * changed), anything else is inserted, and stored lines no longer submitted
 * are deleted. A stored id is matched once — a repeat is inserted as a new
 * line rather than updating the same row twice — so the audit log records
 * what was actually edited instead of a delete and re-insert of every line.
 */
export function diffJournalLines(
  stored: StoredJournalLine[],
  submitted: SubmittedJournalLine[]
): { changes: JournalLineChange[]; deleteIds: string[] } {
  const storedById = new Map(stored.map((line) => [line.id, line]));
  const claimed = new Set<string>();

  const changes = submitted.map((line): JournalLineChange => {
    const description = line.description ?? null;
    const match =
      line.id && !claimed.has(line.id) ? storedById.get(line.id) : undefined;

    if (!match) {
      return {
        op: "insert",
        accountId: line.accountId,
        description,
        amount: line.amount,
        dimensions: line.dimensions,
        dimensionsChanged: line.dimensions.length > 0
      };
    }

    claimed.add(match.id);
    const changed =
      match.accountId !== line.accountId ||
      (match.description ?? "") !== (description ?? "") ||
      !equals(Number(match.amount), line.amount);

    return {
      op: changed ? "update" : "keep",
      id: match.id,
      accountId: line.accountId,
      description,
      amount: line.amount,
      dimensions: line.dimensions,
      dimensionsChanged:
        dimensionKey(match.dimensions) !== dimensionKey(line.dimensions)
    };
  });

  return {
    changes,
    deleteIds: stored.map((l) => l.id).filter((id) => !claimed.has(id))
  };
}
