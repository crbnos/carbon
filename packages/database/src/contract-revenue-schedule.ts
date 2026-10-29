// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A contract line's revenue plan: one amount per calendar month, in contract
// currency. Pure, so the contract page, the lifecycle server function, the
// recognition run and the demo dataset all plan it the same way.
// Plan: `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part IV (D1, D2, D9, D11)

import {
  distributeRoundingResidual,
  EPSILON,
  equals,
  round
} from "./precision.ts";
import {
  addDays,
  daysBetweenInclusive,
  daysInMonth,
  monthEnd,
  parseIsoDate,
  spreadStraightLine
} from "./revenue-schedule.ts";
import type { Database } from "./types.ts";

type RevenueMethod = Database["public"]["Enums"]["contractRevenueMethod"];
type RevenueType = Database["public"]["Enums"]["contractRevenueType"];
export type ContractRevenueStatus =
  Database["public"]["Enums"]["contractRevenueStatus"];

export type RevenueLine = {
  id: string;
  revenueType: RevenueType;
  method: RevenueMethod;
  revenueStart: string;
  revenueEnd: string | null;
  /** What the invoice schedule bills for the line, at internal scale. */
  netAmount: number;
};

export type RevenueMonth = {
  lineId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
};

/** One row of a revenue plan: a calendar month, `YYYY-MM-01` to its last day. */
export type ContractRevenueRow = {
  lineId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: ContractRevenueStatus;
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
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The first day of the month after the one `date` falls in. */
export function nextMonth(date: string): string {
  return addDays(monthEnd(date), 1);
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

  // A line ended before it started — an amendment that replaces it from its
  // own first day ends it the day before — covers no days. What it billed
  // (normally nothing: its rows were adjusted away) is earned on its start
  // date, as for a line with no end, so the total still holds.
  if (revenueEnd !== null && revenueEnd < revenueStart) {
    parseIsoDate(revenueEnd);
    if (equals(netAmount, 0)) return [];
  }

  if (revenueEnd === null || revenueEnd < revenueStart) {
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

export type RevenuePlanLine = {
  id: string;
  revenueType: RevenueType;
  revenueMethod: RevenueMethod;
  startDate: string;
  endDate: string | null;
  goLiveDate: string | null;
  revenueStartDate: string | null;
  revenueEndDate: string | null;
};

/**
 * The revenue plan of every line, one row per (line, calendar month).
 * - `totals`: what the invoice schedule bills each line (adjustments and memo
 *   credits included) — the revenue a line recognizes over its life.
 * - `fallbackEnds`: the revenue end of a line with no end of its own (an
 *   open-ended Recurring line runs to its last scheduled period). A One-time
 *   line with no end is recognized in its start month.
 * - Months before `recognizeRevenueFrom`'s month are `Recognized Externally`
 *   (a migrated contract); the rest are `Planned`.
 * A line with no total, or none billed, plans nothing.
 */
export function planRevenueSchedule(args: {
  lines: RevenuePlanLine[];
  totals: Map<string, number>;
  fallbackEnds?: Map<string, string | null>;
  recognizeRevenueFrom?: string | null;
}): ContractRevenueRow[] {
  const cutoff = args.recognizeRevenueFrom
    ? monthStart(args.recognizeRevenueFrom)
    : null;
  const rows: ContractRevenueRow[] = [];
  for (const line of args.lines) {
    const total = args.totals.get(line.id);
    if (total === undefined || equalsZero(total)) continue;
    const dates = lineRevenueDates(line);
    const end =
      dates.end ??
      (line.revenueType === "Recurring"
        ? (args.fallbackEnds?.get(line.id) ?? null)
        : null);
    if (end !== null && end < dates.start) continue;
    for (const month of revenuePreview({
      id: line.id,
      revenueType: line.revenueType,
      method: line.revenueMethod,
      revenueStart: dates.start,
      revenueEnd: end,
      netAmount: total
    })) {
      const periodStart = monthStart(month.periodStart);
      rows.push({
        lineId: line.id,
        periodStart,
        periodEnd: monthEnd(periodStart),
        amount: month.amount,
        status:
          cutoff !== null && periodStart < cutoff
            ? "Recognized Externally"
            : "Planned"
      });
    }
  }
  return rows;
}

/** Σ amount per line, accumulated at full precision and rounded once. */
export function revenueTotals(
  rows: { lineId: string; amount: number }[]
): Map<string, number> {
  const sums = new Map<string, number>();
  for (const { lineId, amount } of rows) {
    sums.set(lineId, (sums.get(lineId) ?? 0) + amount);
  }
  for (const [lineId, sum] of sums) sums.set(lineId, round(sum));
  return sums;
}

/**
 * The conservation rule (Brad, 2026-10-04): each line's revenue total equals
 * what the invoice schedule bills it. Residual = billed − Σ revenue rows; a
 * line with rows but nothing billed is a residual of −Σ rows.
 */
export function validateRevenueEdit(
  totals: Map<string, number>,
  rows: { lineId: string; amount: number }[]
): { ok: boolean; residuals: Map<string, number> } {
  const sums = revenueTotals(rows);
  const residuals = new Map<string, number>();
  for (const lineId of new Set([...totals.keys(), ...sums.keys()])) {
    const residual = round((totals.get(lineId) ?? 0) - (sums.get(lineId) ?? 0));
    if (!equalsZero(residual)) residuals.set(lineId, residual);
  }
  return { ok: residuals.size === 0, residuals };
}

/**
 * Reconcile, never rewrite (D9). For ONE line whose terms changed from `from`:
 * - `Recognized` / `Recognized Externally` rows, and `Planned` rows in months
 *   before `from`'s month, are kept as they are;
 * - every other month takes the new plan;
 * - whatever keeps the line's total from equalling the new plan's total (a
 *   recognized month that is now worth less, an edit before the change date)
 *   is added to the first month on or after `from` that is not kept — a
 *   catch-up row is created there when the new plan has none.
 * Returns the month the writer replaces from and the rows it inserts: delete
 * the line's `Planned` rows from `replaceFrom` on, then insert `rows`.
 */
export function reconcileRevenueSchedule(args: {
  lineId: string;
  existing: {
    periodStart: string;
    amount: number;
    status: ContractRevenueStatus;
  }[];
  planned: ContractRevenueRow[];
  from: string;
}): { replaceFrom: string; rows: ContractRevenueRow[] } {
  const replaceFrom = monthStart(args.from);
  const kept = args.existing.filter(
    (row) => row.status !== "Planned" || row.periodStart < replaceFrom
  );
  const keptMonths = new Set(kept.map((row) => row.periodStart));
  const rows = args.planned
    .filter(
      (row) =>
        row.lineId === args.lineId &&
        row.periodStart >= replaceFrom &&
        !keptMonths.has(row.periodStart)
    )
    .map((row) => ({ ...row, status: "Planned" as const }));

  const plannedTotal = sum(
    args.planned.filter((row) => row.lineId === args.lineId)
  );
  const delta = round(plannedTotal - sum(kept) - sum(rows));
  if (!equalsZero(delta)) {
    let month = replaceFrom;
    while (keptMonths.has(month)) month = nextMonth(month);
    const target = rows.find((row) => row.periodStart === month);
    if (target) {
      target.amount = round(target.amount + delta);
    } else {
      rows.push({
        lineId: args.lineId,
        periodStart: month,
        periodEnd: monthEnd(month),
        amount: delta,
        status: "Planned"
      });
      rows.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    }
  }
  return { replaceFrom, rows: rows.filter((row) => !equalsZero(row.amount)) };
}

function sum(rows: { amount: number }[]): number {
  return rows.reduce((total, row) => total + row.amount, 0);
}

function equalsZero(value: number): boolean {
  return Math.abs(value) < EPSILON;
}
