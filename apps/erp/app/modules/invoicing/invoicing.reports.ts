// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

// AR / AP aging CSV. The download is the whole aging tree — every counterparty
// and every open document under it — not the rows the grid happens to show,
// so it is built here from the loader data and not from the Table's own export.

export type AgingCsvCounterparty = {
  partyId: string;
  paymentTerm?: string | null;
  current: number;
  bucket1: number;
  bucket2: number;
  bucket3: number;
  bucket4: number;
  unapplied: number;
  total: number;
};

export type AgingCsvDocument = {
  partyId: string;
  documentNumber: string;
  /** 'Invoice' | 'Credit Memo' | 'Debit Memo' */
  documentType: string;
  dateDue: string | null;
  openInBase: number;
  /** The supplier's own invoice number (AP only; null on memos). */
  supplierReference?: string | null;
};

export type AgingCsvInput = {
  /** "Customer" or "Supplier": the first column's heading. */
  partyHeader: string;
  partyNameById: Map<string, string>;
  aging: AgingCsvCounterparty[];
  open: AgingCsvDocument[];
  bucketDays: [number, number, number];
  /** AP carries the supplier's invoice number; AR has no such column. */
  withSupplierReference: boolean;
};

/**
 * One row per counterparty carrying its aging buckets, followed by one row per
 * open document carrying its type, due date and open amount. Every row repeats
 * the counterparty's name so the sheet still filters and sorts by it.
 */
export function agingCsvTable({
  partyHeader,
  partyNameById,
  aging,
  open,
  bucketDays,
  withSupplierReference
}: AgingCsvInput): { fields: string[]; rows: unknown[][] } {
  const [b1, b2, b3] = bucketDays;
  const fields = [
    partyHeader,
    "Document",
    "Document Type",
    ...(withSupplierReference ? ["Supplier Invoice Number"] : []),
    "Due Date",
    "Payment Term",
    "Current",
    `1-${b1}`,
    `${b1 + 1}-${b2}`,
    `${b2 + 1}-${b3}`,
    `${b3}+`,
    "Unapplied",
    "Total"
  ];

  const openByParty = new Map<string, AgingCsvDocument[]>();
  for (const doc of open) {
    const list = openByParty.get(doc.partyId) ?? [];
    list.push(doc);
    openByParty.set(doc.partyId, list);
  }

  const rows = aging.flatMap((a) => {
    const name = partyNameById.get(a.partyId) ?? a.partyId;
    return [
      [
        name,
        "",
        "",
        ...(withSupplierReference ? [""] : []),
        "",
        a.paymentTerm ?? "",
        a.current,
        a.bucket1,
        a.bucket2,
        a.bucket3,
        a.bucket4,
        a.unapplied,
        a.total
      ],
      ...(openByParty.get(a.partyId) ?? []).map((doc) => [
        name,
        doc.documentNumber,
        doc.documentType,
        ...(withSupplierReference ? [doc.supplierReference ?? ""] : []),
        doc.dateDue ?? "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        doc.openInBase
      ])
    ];
  });

  return { fields, rows };
}
