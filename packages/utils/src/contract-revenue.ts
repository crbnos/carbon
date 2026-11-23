// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// How a contract line's revenue would fall across calendar months, and the
// month-by-month position (invoiced, recognized, deferred) that follows. Pure,
// so the contract page and its tests agree.
// Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III

import {
  monthStart,
  type RevenueMonth
} from "@carbon/database/contract-revenue-schedule";
import { round } from "@carbon/database/precision";
import { addDays, monthEnd } from "./revenue-schedule";

// The planner lives in @carbon/database so the server functions and the demo
// dataset share it.
export * from "@carbon/database/contract-revenue-schedule";

export type ContractPositionMonth = {
  /** The first day of the month, `YYYY-MM-01`. */
  month: string;
  invoiced: number;
  recognized: number;
  /** Cumulative invoiced − cumulative recognized, through the end of the month. */
  deferred: number;
};

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
