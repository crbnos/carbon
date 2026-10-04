// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// How a contract line's revenue would fall across calendar months, and the
// month-by-month position (invoiced, recognized, deferred) that follows. A
// PREVIEW computed from the lines — nothing here is persisted or posted; the
// posted revenue in Phase A comes from each invoice line's Service deferral.
// Pure, so the contract page and its tests agree.
// Spec: .ai/specs/2026-10-02-contracts.md (plan decision 1)

import { distributeRoundingResidual, round } from "@carbon/database/precision";
import {
  addDays,
  daysBetweenInclusive,
  daysInMonth,
  monthEnd,
  parseIsoDate,
  spreadStraightLine
} from "./revenue-schedule";

export type RevenueLine = {
  id: string;
  kind: "One-time" | "Recurring";
  method: "Daily" | "Even Period";
  revenueStart: string;
  revenueEnd: string | null;
  /** What the invoice schedule bills for the span, at internal scale. */
  netAmount: number;
};

export type RevenueMonth = {
  lineId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
};

export type ContractPositionMonth = {
  /** The first day of the month, `YYYY-MM-01`. */
  month: string;
  invoiced: number;
  recognized: number;
  /** Cumulative invoiced − cumulative recognized, through the end of the month. */
  deferred: number;
};

/** Revenue dates default: start = goLiveDate ?? revenueStartDate ?? startDate;
 *  end = revenueEndDate ?? endDate. */
export function lineRevenueDates(line: {
  startDate: string;
  endDate: string | null;
  goLiveDate: string | null;
  revenueStartDate: string | null;
  revenueEndDate: string | null;
}): { start: string; end: string | null } {
  return {
    start: line.goLiveDate ?? line.revenueStartDate ?? line.startDate,
    end: line.revenueEndDate ?? line.endDate
  };
}

/** The first day of the month `date` falls in. */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** `[start, end]` cut at calendar-month boundaries. */
function monthCuts(
  start: string,
  end: string
): { periodStart: string; periodEnd: string; days: number }[] {
  // Validates both dates and refuses a range that ends before it starts.
  daysBetweenInclusive(start, end);
  const cuts: { periodStart: string; periodEnd: string; days: number }[] = [];
  let cursor = start;
  while (cursor <= end) {
    const lastOfMonth = monthEnd(cursor);
    const periodEnd = lastOfMonth < end ? lastOfMonth : end;
    cuts.push({
      periodStart: cursor,
      periodEnd,
      days: daysBetweenInclusive(cursor, periodEnd)
    });
    cursor = addDays(periodEnd, 1);
  }
  return cuts;
}

/**
 * One line's revenue, one row per calendar month it touches.
 * - No end → one row on the start date (recognized in the start month).
 * - Daily → `spreadStraightLine`: each month weighted by its days.
 * - Even Period → equal per full calendar month; a partial first or last
 *   month is prorated by its days ÷ that month's days.
 * Rows carry internal scale and sum to `netAmount` EXACTLY — the residual is
 * placed by `distributeRoundingResidual`, never concentrated on one row.
 */
export function revenuePreview(line: RevenueLine): RevenueMonth[] {
  const { id: lineId, revenueStart, revenueEnd, netAmount } = line;
  if (!Number.isFinite(netAmount)) {
    throw new Error(`Revenue amount must be finite, got ${netAmount}`);
  }

  if (revenueEnd === null) {
    parseIsoDate(revenueStart);
    return [
      {
        lineId,
        periodStart: revenueStart,
        periodEnd: revenueStart,
        amount: netAmount
      }
    ];
  }

  if (line.method === "Daily") {
    return spreadStraightLine({
      amount: netAmount,
      startDate: revenueStart,
      endDate: revenueEnd
    }).map(({ periodStart, periodEnd, amount }) => ({
      lineId,
      periodStart,
      periodEnd,
      amount
    }));
  }

  const cuts = monthCuts(revenueStart, revenueEnd);
  const weights = cuts.map(({ periodStart, days }) => {
    const { year, month } = parseIsoDate(periodStart);
    return days / daysInMonth(year, month);
  });
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const amounts = distributeRoundingResidual(
    weights.map((weight) => (netAmount * weight) / totalWeight),
    netAmount
  );
  return cuts.map(({ periodStart, periodEnd }, index) => ({
    lineId,
    periodStart,
    periodEnd,
    amount: amounts[index]!
  }));
}

/**
 * The contract's position per calendar month, from the first month anything
 * is invoiced or recognized to the last, with no gaps:
 * - invoiced: Σ schedule amounts whose `invoiceDate` falls in the month;
 * - recognized: Σ revenue rows whose `periodStart` falls in the month;
 * - deferred: cumulative invoiced − cumulative recognized.
 * Sums accumulate at full precision and round once, at output.
 */
export function contractPositionPreview(
  invoices: { invoiceDate: string; amount: number }[],
  revenue: RevenueMonth[]
): ContractPositionMonth[] {
  const invoicedByMonth = new Map<string, number>();
  const recognizedByMonth = new Map<string, number>();
  for (const { invoiceDate, amount } of invoices) {
    const month = monthStart(invoiceDate);
    invoicedByMonth.set(month, (invoicedByMonth.get(month) ?? 0) + amount);
  }
  for (const { periodStart, amount } of revenue) {
    const month = monthStart(periodStart);
    recognizedByMonth.set(month, (recognizedByMonth.get(month) ?? 0) + amount);
  }

  const months = [
    ...invoicedByMonth.keys(),
    ...recognizedByMonth.keys()
  ].sort();
  if (months.length === 0) return [];
  const last = months[months.length - 1]!;

  const position: ContractPositionMonth[] = [];
  let cumulativeInvoiced = 0;
  let cumulativeRecognized = 0;
  for (let month = months[0]!; month <= last; ) {
    const invoiced = invoicedByMonth.get(month) ?? 0;
    const recognized = recognizedByMonth.get(month) ?? 0;
    cumulativeInvoiced += invoiced;
    cumulativeRecognized += recognized;
    position.push({
      month,
      invoiced: round(invoiced),
      recognized: round(recognized),
      deferred: round(cumulativeInvoiced - cumulativeRecognized)
    });
    month = addDays(monthEnd(month), 1);
  }
  return position;
}
