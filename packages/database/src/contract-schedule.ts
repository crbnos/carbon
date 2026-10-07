// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Customer contract invoice schedule — the pure planner shared by the ERP
// (live preview of an unedited Draft), the `post-customer-contract` server
// function (confirm, schedule edits, amend, cancel) and the
// `create-contract-invoices` job (horizon roll, renewal, drafting). Re-exported
// through `@carbon/utils`.
//
// Pure: `YYYY-MM-DD` strings and numbers in, plain objects out — no database,
// no JS `Date`. Calendar arithmetic is `@internationalized/date`; amounts round
// at internal scale through `./precision` (persist boundary — the caller writes
// what these functions return).
// Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III "The invoice schedule";
// plan: `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III decisions 8–10, Task 5.

import {
  type CalendarDate,
  parseDate,
  startOfWeek
} from "@internationalized/date";
import { equals, round } from "./precision.ts";
import type { Database } from "./types.ts";

type Enums = Database["public"]["Enums"];

export type ContractBillingFrequency = Enums["contractBillingFrequency"];
export type ContractBillingAlignment = Enums["contractBillingAlignment"];
export type ContractBillingTiming = Enums["contractBillingTiming"];
export type ContractRateUnit = Enums["contractRateUnit"];
export type ContractAmendmentEffect = Enums["contractAmendmentEffect"];
export type CustomerContractType = Enums["customerContractType"];

export type ContractTerms = {
  startDate: string;
  endDate: string | null;
  billingFrequency: ContractBillingFrequency;
  billingAlignment: ContractBillingAlignment;
  billingTiming: ContractBillingTiming;
  firstInvoiceDate: string | null;
  billedThrough: string | null;
};

export type ContractLineTerms = {
  id: string;
  revenueType: "One-time" | "Recurring";
  quantity: number;
  rate: number;
  rateUnit: ContractRateUnit | null;
  discountPercent: number;
  startDate: string;
  endDate: string | null;
};

export type PlannedRow = {
  lineId: string;
  periodStart: string;
  periodEnd: string;
  units: number;
  unitPrice: number;
  amount: number;
  isAdjustment: boolean;
  invoiceDate: string;
  status: "Planned" | "Billed Externally";
};

/** One planned invoice of a contract. Named with the `Contract` prefix because
 *  `@carbon/utils` already exports the rental `PlannedInvoice`. */
export type ContractPlannedInvoice = {
  invoiceDate: string;
  status: "Planned" | "Billed Externally";
  rows: PlannedRow[];
};

export type ExistingRow = {
  id: string;
  invoiceId: string | null;
  invoiceDate: string | null;
  invoiceStatus: "Planned" | "Invoiced" | "Billed Externally" | null;
  invoiceIsEdited: boolean;
  lineId: string;
  periodStart: string;
  periodEnd: string;
  units: number;
  unitPrice: number;
  amount: number;
  isAdjustment: boolean;
  memoId: string | null;
};

export type BillingPeriod = { start: string; end: string; dueDate: string };

// ---------------------------------------------------------------------------
// Calendar helpers (YYYY-MM-DD strings; lexicographic order is chronological)

const minDate = (a: string, b: string): string => (a <= b ? a : b);
const maxDate = (a: string, b: string): string => (a >= b ? a : b);
const addDays = (date: string, days: number): string =>
  parseDate(date).add({ days }).toString();
/** Days in `[start, end]`, both inclusive; 0 when `end` is before `start`. */
const daysInclusive = (start: string, end: string): number => {
  const days = parseDate(end).compare(parseDate(start)) + 1;
  return days > 0 ? days : 0;
};

const FREQUENCY_MONTHS: Record<
  Exclude<ContractBillingFrequency, "Week">,
  number
> = { Month: 1, Quarter: 3, Year: 12 };

const RATE_UNIT_MONTHS: Record<"Month" | "Quarter" | "Year", number> = {
  Month: 1,
  Quarter: 3,
  Year: 12
};

/** Periods per year, for converting a rate unit to a billing frequency. */
const PERIODS_PER_YEAR: Record<ContractRateUnit, number> = {
  Day: 365,
  Week: 52,
  Month: 12,
  Quarter: 4,
  Year: 1
};

function gridAnchor(terms: ContractTerms): CalendarDate {
  const start = parseDate(terms.startDate);
  if (terms.billingAlignment === "Anniversary") return start;
  switch (terms.billingFrequency) {
    case "Week":
      return startOfWeek(start, "en-GB"); // Monday
    case "Month":
      return start.set({ day: 1 });
    case "Quarter":
      return start.set({
        month: start.month - ((start.month - 1) % 3),
        day: 1
      });
    case "Year":
      return start.set({ month: 1, day: 1 });
  }
}

/** Start of grid period `k`, always added from the anchor (never chained), so
 *  a 31 Jan anchor clamps to 28 Feb and returns to 31 Mar. */
function gridPeriodStart(
  anchor: CalendarDate,
  frequency: ContractBillingFrequency,
  k: number
): CalendarDate {
  if (frequency === "Week") return anchor.add({ weeks: k });
  return anchor.add({ months: k * FREQUENCY_MONTHS[frequency] });
}

// ---------------------------------------------------------------------------
// Grid and units

/** The billing grid: the periods from `startDate` to `min(endDate, through)`
 *  (every period that starts on or before that date).
 *
 *  - Anniversary anchors on `startDate`; Calendar anchors on the Monday of its
 *    week, or the 1st of its month, of its quarter's first month, or 1 Jan.
 *  - Month / Quarter / Year period k is `[anchor + k·m months, anchor +
 *    (k+1)·m months − 1 day]`, always added from the anchor; Week is 7 days.
 *  - The first period is clipped to start at `startDate`, the last at
 *    `endDate`.
 *  - `dueDate` is the period's start (Advance) or end (Arrears). */
export function billingGrid(
  terms: ContractTerms,
  through: string
): BillingPeriod[] {
  return gridPeriods(terms, through).map(({ start, end, dueDate }) => ({
    start,
    end,
    dueDate
  }));
}

/** `billingGrid`, with `whole` set on a period neither the contract's start
 *  nor its end clips (it equals the raw grid period). */
function gridPeriods(
  terms: ContractTerms,
  through: string
): (BillingPeriod & { whole: boolean })[] {
  const limit = terms.endDate ? minDate(terms.endDate, through) : through;
  if (limit < terms.startDate) return [];

  const anchor = gridAnchor(terms);
  const periods: (BillingPeriod & { whole: boolean })[] = [];
  for (let k = 0; ; k++) {
    const rawStart = gridPeriodStart(anchor, terms.billingFrequency, k);
    const rawEnd = gridPeriodStart(anchor, terms.billingFrequency, k + 1)
      .subtract({ days: 1 })
      .toString();
    const start = maxDate(rawStart.toString(), terms.startDate);
    if (start > limit) break;
    if (rawEnd < terms.startDate) continue;
    const end = terms.endDate ? minDate(rawEnd, terms.endDate) : rawEnd;
    periods.push({
      start,
      end,
      dueDate: terms.billingTiming === "Advance" ? start : end,
      whole: start === rawStart.toString() && end === rawEnd
    });
  }
  return periods;
}

/** Units in one WHOLE grid period, when they are exact by construction:
 *  a month-based frequency (Month 1, Quarter 3, Year 12 months) with a
 *  month-based rate unit gives `frequencyMonths ÷ rateUnitMonths` (a monthly
 *  period at a per-Year rate is 1/12, a quarterly period at a per-Month rate
 *  is 3); a Week frequency with a Week rate gives 1. Anything else — a Day
 *  rate, or weeks mixed with months — returns null, and the caller counts with
 *  `periodUnits`. This is decision 9's intent, "Anniversary … no proration":
 *  a clamped period such as 28 Feb–30 Mar (from a 31 Jan anchor) is one
 *  month, although `periodUnits` counting from its own start would say
 *  1 + 3/31. */
export function wholePeriodUnits(
  frequency: ContractBillingFrequency,
  rateUnit: ContractRateUnit
): number | null {
  if (frequency === "Week") return rateUnit === "Week" ? 1 : null;
  if (rateUnit === "Day" || rateUnit === "Week") return null;
  return FREQUENCY_MONTHS[frequency] / RATE_UNIT_MONTHS[rateUnit];
}

/** How many rate units `[periodStart, periodEnd]` (inclusive) holds. Not
 *  rounded.
 *
 *  - Day: days. Week: days ÷ 7.
 *  - Month / Quarter / Year: whole months counted from `periodStart`, then the
 *    remaining days as a fraction of the month that follows (decision 9):
 *    `n` = the largest integer with `periodStart + n months − 1 day ≤
 *    periodEnd`; `rest` = days from `periodStart + n months` to `periodEnd`;
 *    `restBase` = days in `[periodStart + n months, periodStart + (n+1) months
 *    − 1 day]`; result `(n + rest ÷ restBase) ÷ (1 | 3 | 12)`. So an
 *    Anniversary period such as 15 Mar–14 Apr is exactly 1 month. */
export function periodUnits(
  periodStart: string,
  periodEnd: string,
  rateUnit: ContractRateUnit
): number {
  const days = daysInclusive(periodStart, periodEnd);
  if (rateUnit === "Day") return days;
  if (rateUnit === "Week") return days / 7;

  const start = parseDate(periodStart);
  const end = parseDate(periodEnd);
  let n = 0;
  while (
    start
      .add({ months: n + 1 })
      .subtract({ days: 1 })
      .compare(end) <= 0
  ) {
    n++;
  }
  const restStart = start.add({ months: n });
  const restEnd = start.add({ months: n + 1 }).subtract({ days: 1 });
  const rest = Math.max(0, end.compare(restStart) + 1);
  const restBase = restEnd.compare(restStart) + 1;
  return (n + rest / restBase) / RATE_UNIT_MONTHS[rateUnit];
}

/** Units in `[periodStart, periodEnd]` (inclusive) of a WEEKLY grid at a
 *  Month / Quarter / Year rate: the days at the yearly average day (a Month
 *  rate is rate × 12 ÷ 365 a day). `periodUnits` would count each week against
 *  the month it starts in, so a week is 7/28, 7/30 or 7/31 of a month and the
 *  amount changes every month. On the average every whole week is the same
 *  amount, and a 365-day year is exactly 12 months. Not rounded. */
export function averageDayUnits(
  periodStart: string,
  periodEnd: string,
  rateUnit: "Month" | "Quarter" | "Year"
): number {
  return (
    (daysInclusive(periodStart, periodEnd) * PERIODS_PER_YEAR[rateUnit]) /
    PERIODS_PER_YEAR.Day
  );
}

/** Prices a schedule row: two roundings at internal scale (decision 10).
 *  `unitPrice = round(rate × units)` is the list price per contract-line unit
 *  for the period; `amount = round(quantity × unitPrice × (1 −
 *  discountPercent))` is the net merchandise. */
export function rowPricing(
  line: Pick<ContractLineTerms, "quantity" | "rate" | "discountPercent">,
  units: number
): { unitPrice: number; amount: number } {
  const unitPrice = round(line.rate * units);
  const amount = round(line.quantity * unitPrice * (1 - line.discountPercent));
  return { unitPrice, amount };
}

/** The first grid due date on or after `date`, else `date` itself. A row that
 *  falls between due dates (a mid-period start, a reconciliation row) lands on
 *  the next regular invoice date, never on a day of its own (decision 8). */
export function nextInvoiceDate(gridDueDates: string[], date: string): string {
  let best: string | null = null;
  for (const due of gridDueDates) {
    if (due >= date && (best === null || due < best)) best = due;
  }
  return best ?? date;
}

// ---------------------------------------------------------------------------
// Planning

function groupIntoInvoices(
  rows: PlannedRow[],
  lineOrder: Map<string, number>
): ContractPlannedInvoice[] {
  const byKey = new Map<string, ContractPlannedInvoice>();
  for (const row of rows) {
    const key = `${row.invoiceDate}|${row.status}`;
    let invoice = byKey.get(key);
    if (!invoice) {
      invoice = { invoiceDate: row.invoiceDate, status: row.status, rows: [] };
      byKey.set(key, invoice);
    }
    invoice.rows.push(row);
  }
  const order = (lineId: string) =>
    lineOrder.get(lineId) ?? Number.MAX_SAFE_INTEGER;
  const invoices = [...byKey.values()];
  for (const invoice of invoices) {
    invoice.rows.sort(
      (a, b) =>
        order(a.lineId) - order(b.lineId) ||
        a.periodStart.localeCompare(b.periodStart)
    );
  }
  return invoices.sort(
    (a, b) =>
      a.invoiceDate.localeCompare(b.invoiceDate) ||
      a.status.localeCompare(b.status)
  );
}

/** Plans a contract's invoices up to `through`.
 *
 *  - Recurring: one row per grid period intersecting `[line.startDate,
 *    line.endDate ?? terms.endDate ?? through]`, clipped to that span, priced
 *    with `rowPricing`; invoiced on `nextInvoiceDate` of the clipped start
 *    (Advance) or clipped end (Arrears). Units: a row covering a WHOLE,
 *    unclipped grid period uses `wholePeriodUnits` when it is exact (so an
 *    Anniversary period is never prorated, even when a 29th–31st anchor
 *    clamps it); a clipped or partial row, a Day rate, or weeks mixed with
 *    months use `periodUnits` — except a Weekly grid at a Month / Quarter /
 *    Year rate, whose rows all use `averageDayUnits` (so every whole week is
 *    the same amount). `reconcileContractSchedule` prices through
 *    this function, so it follows the same rule.
 *  - One-time: one row over `[startDate, endDate ?? startDate]`, units 1,
 *    invoiced on the first grid due date on or after its start. A line ended
 *    before it starts (`endDate < startDate`, a cancellation) plans nothing.
 *  - An invoice date before `firstInvoiceDate` moves to it.
 *  - A row ending on or before `billedThrough` is `Billed Externally`.
 *  - Rows are grouped by (invoice date, status), invoices sorted by date, rows
 *    by line input order then period start. */
export function planInvoiceSchedule(
  terms: ContractTerms,
  lines: ContractLineTerms[],
  through: string
): ContractPlannedInvoice[] {
  const grid = gridPeriods(terms, through);
  const dues = grid.map((p) => p.dueDate);
  const rows: PlannedRow[] = [];

  const push = (
    line: ContractLineTerms,
    periodStart: string,
    periodEnd: string,
    units: number,
    dueDate: string
  ) => {
    let invoiceDate = nextInvoiceDate(dues, dueDate);
    if (terms.firstInvoiceDate && invoiceDate < terms.firstInvoiceDate) {
      invoiceDate = terms.firstInvoiceDate;
    }
    rows.push({
      lineId: line.id,
      periodStart,
      periodEnd,
      units,
      ...rowPricing(line, units),
      isAdjustment: false,
      invoiceDate,
      status:
        terms.billedThrough && periodEnd <= terms.billedThrough
          ? "Billed Externally"
          : "Planned"
    });
  };

  for (const line of lines) {
    if (line.revenueType === "One-time") {
      const periodEnd = line.endDate ?? line.startDate;
      if (periodEnd < line.startDate) continue;
      push(line, line.startDate, periodEnd, 1, line.startDate);
      continue;
    }

    if (!line.rateUnit) {
      throw new Error(`Recurring contract line ${line.id} has no rate unit`);
    }
    const spanStart = line.startDate;
    const spanEnd = line.endDate ?? terms.endDate ?? through;
    if (spanEnd < spanStart) continue;
    const exact = wholePeriodUnits(terms.billingFrequency, line.rateUnit);
    const rateUnit = line.rateUnit;
    const weeklyAtMonthRate =
      terms.billingFrequency === "Week" &&
      (rateUnit === "Month" || rateUnit === "Quarter" || rateUnit === "Year")
        ? rateUnit
        : null;
    for (const period of grid) {
      if (period.start > spanEnd || period.end < spanStart) continue;
      const start = maxDate(period.start, spanStart);
      const end = minDate(period.end, spanEnd);
      const whole =
        period.whole && start === period.start && end === period.end;
      const units =
        weeklyAtMonthRate !== null
          ? averageDayUnits(start, end, weeklyAtMonthRate)
          : whole && exact !== null
            ? exact
            : periodUnits(start, end, line.rateUnit);
      push(
        line,
        start,
        end,
        units,
        terms.billingTiming === "Advance" ? start : end
      );
    }
  }

  return groupIntoInvoices(
    rows,
    new Map(lines.map((line, index) => [line.id, index]))
  );
}

/** Each contract line's total across every planned row. */
export function lineTotals(
  invoices: ContractPlannedInvoice[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    for (const row of invoice.rows) {
      totals.set(row.lineId, (totals.get(row.lineId) ?? 0) + row.amount);
    }
  }
  for (const [lineId, total] of totals) totals.set(lineId, round(total));
  return totals;
}

/** A schedule edit only redistributes: every line's billed total must still
 *  equal its computed total. Residual per line = computed − Σ its
 *  non-adjustment row amounts. `ok` when every residual is 0 (within
 *  `EPSILON`) and no row names a line that is not in `computed`. */
export function validateScheduleEdit(
  computed: Map<string, number>,
  rows: { lineId: string; amount: number; isAdjustment: boolean }[]
): { ok: boolean; residuals: Map<string, number> } {
  const billed = new Map<string, number>();
  let unknownLine = false;
  for (const row of rows) {
    if (!computed.has(row.lineId)) unknownLine = true;
    if (row.isAdjustment) continue;
    billed.set(row.lineId, (billed.get(row.lineId) ?? 0) + row.amount);
  }
  const residuals = new Map<string, number>();
  for (const [lineId, total] of computed) {
    residuals.set(lineId, round(total - (billed.get(lineId) ?? 0)));
  }
  const ok = !unknownLine && [...residuals.values()].every((r) => equals(r, 0));
  return { ok, residuals };
}

/** How a schedule row is drafted as a sales-invoice line. When the row still
 *  equals `round(quantity × unitPrice × (1 − discountPercent))` the line
 *  carries the contract line's quantity, the row's list unit price and the
 *  discount, so the invoice shows price + discount. Otherwise (a split
 *  installment, an adjustment) it is quantity 1 at the row's amount with no
 *  discount — the caller states the discount in the description. */
export function invoiceLinePricing(
  row: { amount: number; unitPrice: number },
  line: { quantity: number; discountPercent: number }
): { quantity: number; unitPrice: number; discountPercent: number } {
  const net = round(line.quantity * row.unitPrice * (1 - line.discountPercent));
  if (equals(net, row.amount)) {
    return {
      quantity: line.quantity,
      unitPrice: row.unitPrice,
      discountPercent: line.discountPercent
    };
  }
  return { quantity: 1, unitPrice: row.amount, discountPercent: 0 };
}

// ---------------------------------------------------------------------------
// Reconciliation

export type ContractScheduleRecut = {
  id: string;
  periodEnd: string;
  units: number;
  unitPrice: number;
  amount: number;
};

export type ContractScheduleReconciliation = {
  deleteInvoiceIds: string[];
  deleteRowIds: string[];
  recut: ContractScheduleRecut[];
  create: ContractPlannedInvoice[];
  adjustments: PlannedRow[];
};

/** Reconciles the persisted schedule with the lines after a change
 *  (amendment, cancellation, renewal, horizon roll). Reconcile, never
 *  rewrite — billed rows are never touched. `lines` are ALL lines after the
 *  change; `existing` is every persisted schedule row.
 *
 *  Rows are keyed `lineId|periodStart`. A key can hold several rows: a split
 *  leaves one installment per invoice, and some installments may be billed
 *  (`Invoiced` / `Billed Externally`) while others are still Planned. A key
 *  is always reconciled as a whole: its rows together must equal its ideal
 *  row (0 when the line no longer covers the period).
 *
 *  1. `ideal = planInvoiceSchedule(terms, lines, through)`.
 *  2. Adjustments. For a key with `Invoiced` rows whose Recurring line now
 *     ends before the period's end, the credit the key needs is
 *     `ideal − Σ billed` (never more than what was invoiced). Adjustments
 *     already on that period (same `lineId` and `periodEnd`) that survive
 *     this reconciliation — on a memo, a billed invoice or a kept Planned
 *     invoice — count towards it; ONE new adjustment takes the difference,
 *     over `[max(lineEnd + 1, periodStart), periodEnd]`, priced at the billed
 *     unit price. So a second, earlier end credits only the extra days, and a
 *     split period is credited for every installment. Its `invoiceDate` is
 *     the first planned invoice date ≥ `from` in `create`, or `from` when
 *     there is none (the caller attaches it to that invoice, or to a memo).
 *  3. Existing `Planned` invoices dated ≥ `from` → `deleteInvoiceIds`.
 *  4. Existing `Planned` non-adjustment rows on invoices dated < `from`,
 *     grouped by key, must total `ideal − Σ billed`: when the group's
 *     `periodEnd` or total differs → `recut` (one row takes it all;
 *     installments keep their shares, the last taking the remainder so the
 *     total is exact); no ideal row, or nothing left to bill →
 *     `deleteRowIds`. A kept invoice left with no rows → `deleteInvoiceIds`.
 *  5. `create` = the ideal rows whose key has no billed and no kept row,
 *     plus, for a key whose billed rows fall short of its ideal row and that
 *     has no kept row, the shortfall (a split installment whose invoice step
 *     3 replaced). Invoiced on `nextInvoiceDate(max(row.invoiceDate, from))`,
 *     grouped into invoices. */
export function reconcileContractSchedule({
  terms,
  lines,
  existing,
  from,
  through
}: {
  terms: ContractTerms;
  lines: ContractLineTerms[];
  existing: ExistingRow[];
  from: string;
  through: string;
}): ContractScheduleReconciliation {
  const dues = billingGrid(terms, through).map((p) => p.dueDate);
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const key = (row: { lineId: string; periodStart: string }) =>
    `${row.lineId}|${row.periodStart}`;
  const periodKey = (row: { lineId: string; periodEnd: string }) =>
    `${row.lineId}|${row.periodEnd}`;

  // 1. The ideal schedule.
  const idealRows = planInvoiceSchedule(terms, lines, through).flatMap(
    (invoice) => invoice.rows
  );
  const idealByKey = new Map(idealRows.map((row) => [key(row), row]));

  // 3. Planned invoices from `from` on are replaced wholesale.
  const isReplaced = (row: ExistingRow) =>
    row.invoiceId !== null &&
    row.invoiceStatus === "Planned" &&
    row.invoiceDate !== null &&
    row.invoiceDate >= from;
  const deleteInvoiceIds = new Set<string>();
  for (const row of existing) {
    if (isReplaced(row)) deleteInvoiceIds.add(row.invoiceId!);
  }

  // What each key has already billed: its non-adjustment rows on Invoiced
  // and Billed Externally invoices.
  type Billed = { amount: number; units: number; invoiced: ExistingRow[] };
  const billedByKey = new Map<string, Billed>();
  for (const row of existing) {
    if (row.isAdjustment) continue;
    if (
      row.invoiceStatus !== "Invoiced" &&
      row.invoiceStatus !== "Billed Externally"
    ) {
      continue;
    }
    let billed = billedByKey.get(key(row));
    if (!billed) {
      billed = { amount: 0, units: 0, invoiced: [] };
      billedByKey.set(key(row), billed);
    }
    billed.amount += row.amount;
    billed.units += row.units;
    if (row.invoiceStatus === "Invoiced") billed.invoiced.push(row);
  }
  /** What the Planned rows of a key must still bill: its ideal row less what
   *  is billed. Null when nothing is left. */
  const outstanding = (rowKey: string) => {
    const ideal = idealByKey.get(rowKey);
    if (!ideal) return null;
    const billed = billedByKey.get(rowKey);
    if (!billed) return ideal;
    const amount = round(ideal.amount - billed.amount);
    if (amount <= 0 || equals(amount, 0)) return null;
    return { ...ideal, units: ideal.units - billed.units, amount };
  };

  // 4. Planned rows on invoices before `from` are re-cut or removed. A split
  //    (several installments sharing one key) is compared and re-cut as a
  //    group.
  const recut: ContractScheduleRecut[] = [];
  const deleteRowIds = new Set<string>();
  const keptInvoiceIds = new Set<string>();
  const keptByKey = new Map<string, ExistingRow[]>();
  for (const row of existing) {
    if (row.invoiceStatus !== "Planned" || !row.invoiceId || isReplaced(row)) {
      continue;
    }
    keptInvoiceIds.add(row.invoiceId);
    if (row.isAdjustment) continue;
    const group = keptByKey.get(key(row));
    if (group) group.push(row);
    else keptByKey.set(key(row), [row]);
  }
  for (const [rowKey, group] of keptByKey) {
    const target = outstanding(rowKey);
    if (!target) {
      for (const row of group) deleteRowIds.add(row.id);
      continue;
    }
    const total = group.reduce((sum, row) => sum + row.amount, 0);
    const unchanged =
      group.every((row) => row.periodEnd === target.periodEnd) &&
      equals(total, target.amount);
    if (unchanged) continue;
    if (group.length === 1 || equals(total, 0)) {
      // One row (or a group with nothing to scale by): the target, once.
      group.forEach((row, index) => {
        recut.push({
          id: row.id,
          periodEnd: target.periodEnd,
          units: index === 0 ? target.units : 0,
          unitPrice: target.unitPrice,
          amount: index === 0 ? target.amount : 0
        });
      });
      continue;
    }
    // Installments keep their shares of the target; the last takes the
    // remainder so the line total is conserved exactly.
    let placed = 0;
    group.forEach((row, index) => {
      const share = row.amount / total;
      const amount =
        index === group.length - 1
          ? round(target.amount - placed)
          : round(target.amount * share);
      placed += amount;
      recut.push({
        id: row.id,
        periodEnd: target.periodEnd,
        units: target.units * share,
        unitPrice: target.unitPrice,
        amount
      });
    });
  }
  for (const invoiceId of keptInvoiceIds) {
    const remaining = existing.some(
      (row) =>
        row.invoiceId === invoiceId &&
        row.invoiceStatus === "Planned" &&
        !deleteRowIds.has(row.id)
    );
    if (!remaining) deleteInvoiceIds.add(invoiceId);
  }

  // 5. What the ideal schedule still needs: whole rows for keys nothing
  //    holds, the shortfall for a billed key with no kept row.
  const created = idealRows
    .filter((row) => !keptByKey.has(key(row)))
    .flatMap((row) => {
      const target = outstanding(key(row));
      return target ? [target] : [];
    })
    .map((row) => ({
      ...row,
      invoiceDate: nextInvoiceDate(dues, maxDate(row.invoiceDate, from))
    }));
  const create = groupIntoInvoices(
    created,
    new Map(lines.map((line, index) => [line.id, index]))
  );

  // 2. Credits for billed periods that now run past their line's end.
  const adjustmentInvoiceDate =
    create.find((i) => i.status === "Planned" && i.invoiceDate >= from)
      ?.invoiceDate ?? from;
  const adjustedByPeriod = new Map<string, { amount: number; units: number }>();
  // The spans a credit memo already credits. A memo's rows are apportioned
  // to its currency's decimals, so they can differ from the exact credit by
  // less than one minor unit: the same span again is that rounding, never a
  // new credit (a later, earlier end credits a different span).
  const spanKey = (row: {
    lineId: string;
    periodStart: string;
    periodEnd: string;
  }) => `${row.lineId}|${row.periodStart}|${row.periodEnd}`;
  const memoCredited = new Set(
    existing
      .filter((row) => row.isAdjustment && row.memoId !== null)
      .map(spanKey)
  );
  for (const row of existing) {
    if (!row.isAdjustment || isReplaced(row)) continue;
    const adjusted = adjustedByPeriod.get(periodKey(row)) ?? {
      amount: 0,
      units: 0
    };
    adjusted.amount += row.amount;
    adjusted.units += row.units;
    adjustedByPeriod.set(periodKey(row), adjusted);
  }
  const adjustments: PlannedRow[] = [];
  for (const [rowKey, billed] of billedByKey) {
    const first = billed.invoiced[0];
    if (!first) continue;
    // A remainder billed after the period grew (a renewal un-clipping it)
    // reaches further than the first installment.
    const periodEnd = billed.invoiced.reduce(
      (latest, row) => maxDate(latest, row.periodEnd),
      first.periodEnd
    );
    const line = lineById.get(first.lineId);
    if (!line || line.revenueType !== "Recurring" || !line.endDate) continue;
    if (line.endDate >= periodEnd) continue;

    const ideal = idealByKey.get(rowKey);
    const invoicedAmount = billed.invoiced.reduce((s, r) => s + r.amount, 0);
    const invoicedUnits = billed.invoiced.reduce((s, r) => s + r.units, 0);
    const excess = (ideal?.amount ?? 0) - billed.amount;
    if (excess >= 0 || equals(excess, 0)) continue;
    // Never credit more than was invoiced (a Billed Externally share is not
    // Carbon's to credit).
    const capped = excess < -invoicedAmount;
    const required = capped ? -invoicedAmount : excess;
    const requiredUnits = capped
      ? -invoicedUnits
      : (ideal?.units ?? 0) - billed.units;

    const already = adjustedByPeriod.get(
      periodKey({ lineId: first.lineId, periodEnd })
    ) ?? { amount: 0, units: 0 };
    const amount = round(required - already.amount);
    if (amount >= 0 || equals(amount, 0)) continue;
    const periodStart = maxDate(addDays(line.endDate, 1), first.periodStart);
    if (
      memoCredited.has(
        spanKey({ lineId: first.lineId, periodStart, periodEnd })
      )
    )
      continue;
    adjustments.push({
      lineId: first.lineId,
      periodStart,
      periodEnd,
      units: requiredUnits - already.units,
      unitPrice: first.unitPrice,
      amount,
      isAdjustment: true,
      invoiceDate: adjustmentInvoiceDate,
      status: "Planned"
    });
  }

  return {
    deleteInvoiceIds: [...deleteInvoiceIds],
    deleteRowIds: [...deleteRowIds],
    recut,
    create,
    adjustments
  };
}

/** The last period end of a Recurring line's persisted (non-adjustment) row —
 *  how far an open-ended schedule has been planned. A One-time line's row
 *  spans its service window, which can run far past the planned periods, so
 *  it never counts. Null when no Recurring line has a row. */
export function lastRecurringPeriodEnd(
  existing: Pick<ExistingRow, "lineId" | "periodEnd" | "isAdjustment">[],
  lines: Pick<ContractLineTerms, "id" | "revenueType">[]
): string | null {
  const recurring = new Set(
    lines
      .filter((line) => line.revenueType === "Recurring")
      .map((line) => line.id)
  );
  let last: string | null = null;
  for (const row of existing) {
    if (row.isAdjustment || !recurring.has(row.lineId)) continue;
    if (last === null || row.periodEnd > last) last = row.periodEnd;
  }
  return last;
}

/** The end of the billing period `date` falls in (clipped at the contract's
 *  end), or null when it is before the contract starts. "Billed through" must
 *  equal it. */
export function periodEndContaining(
  terms: ContractTerms,
  date: string
): string | null {
  const periods = billingGrid(terms, date);
  return periods[periods.length - 1]?.end ?? null;
}

export type ContractDiscountEndSplit = {
  lineId: string;
  /** The last discounted day: the line ends here. */
  discountEndsOn: string;
  /** The full-price copy starts here. */
  resumesOn: string;
};

/** The Recurring lines whose "discount ends" date falls inside the line, so
 *  the line must end that day and a full-price copy start the next. A line
 *  already split ends on its `discountEndsOn` (and its copy has none), so
 *  this is idempotent: it can run after any change to the lines (confirm, an
 *  amendment, a renewal) and only picks up what is new. A line runs to
 *  `contractEndDate` when it has no end of its own; an open-ended contract
 *  never ends. */
export function discountEndSplits(
  lines: (Pick<
    ContractLineTerms,
    "id" | "revenueType" | "startDate" | "endDate"
  > & {
    discountEndsOn: string | null;
  })[],
  contractEndDate: string | null
): ContractDiscountEndSplit[] {
  const splits: ContractDiscountEndSplit[] = [];
  for (const line of lines) {
    if (line.revenueType !== "Recurring" || line.discountEndsOn === null)
      continue;
    if (line.discountEndsOn < line.startDate) continue;
    const resumesOn = addDays(line.discountEndsOn, 1);
    const lineEnd = line.endDate ?? contractEndDate;
    if (lineEnd !== null && resumesOn > lineEnd) continue;
    splits.push({
      lineId: line.id,
      discountEndsOn: line.discountEndsOn,
      resumesOn
    });
  }
  return splits;
}

// ---------------------------------------------------------------------------
// Amendments, renewal, horizon

/** When an amendment takes effect. `Change Date` takes the requested date as
 *  is (prorated). `Next Period` snaps to the start of the first grid period
 *  that starts after `requested` — or `requested` itself when it already
 *  starts a period, or when no later period exists before the contract ends. */
export function amendmentEffectiveDate(
  terms: ContractTerms,
  effect: ContractAmendmentEffect,
  requested: string,
  through: string
): string {
  if (effect === "Change Date") return requested;
  // Plan at least one whole year past the request so the next period exists.
  const reach = maxDate(
    through,
    parseDate(requested).add({ years: 1 }).toString()
  );
  for (const period of billingGrid(terms, reach)) {
    if (period.start === requested) return requested;
    if (period.start > requested) return period.start;
  }
  return requested;
}

/** Recurring value per billing period on `on`: Σ over Recurring lines active
 *  that day of `quantity × rate × (1 − discountPercent) × perFrequency`, where
 *  `perFrequency` = the rate unit's periods per year ÷ the frequency's
 *  (Day 365, Week 52, Month 12, Quarter 4, Year 1). */
export function recurringValuePerPeriod(
  lines: ContractLineTerms[],
  frequency: ContractBillingFrequency,
  on: string
): number {
  let total = 0;
  for (const line of lines) {
    if (line.revenueType !== "Recurring" || !line.rateUnit) continue;
    if (line.startDate > on) continue;
    if (line.endDate && line.endDate < on) continue;
    const perFrequency =
      PERIODS_PER_YEAR[line.rateUnit] / PERIODS_PER_YEAR[frequency];
    total +=
      line.quantity * line.rate * (1 - line.discountPercent) * perFrequency;
  }
  return round(total);
}

/** Amendment type from the change in recurring value per period: up →
 *  Expansion, down → Contraction, unchanged → Existing. */
export function suggestAmendmentType(
  before: number,
  after: number
): CustomerContractType {
  if (equals(before, after)) return "Existing";
  return after > before ? "Expansion" : "Contraction";
}

/** Contract type from the customer's previous contracts: none beyond Drafts →
 *  New Sales; every non-Draft one Ended → Reactivation; otherwise New Sales. */
export function suggestContractType(
  previous: { status: "Draft" | "Active" | "Ended" }[]
): CustomerContractType {
  const signed = previous.filter((c) => c.status !== "Draft");
  if (signed.length === 0) return "New Sales";
  if (signed.every((c) => c.status === "Ended")) return "Reactivation";
  return "New Sales";
}

/** End of the grid period containing `today` (the first period's end before
 *  the contract starts; `endDate` after it ends) — the cancellation default,
 *  so nothing already billed in advance is credited. */
export function currentPeriodEnd(terms: ContractTerms, today: string): string {
  const periods = billingGrid(terms, today);
  const current = periods[periods.length - 1];
  if (current) return current.end;
  return billingGrid(terms, terms.startDate)[0]?.end ?? terms.startDate;
}

/** End date after one renewal term: `(endDate + 1 day) + termMonths − 1 day`. */
export function renewedEndDate(endDate: string, termMonths: number): string {
  return parseDate(endDate)
    .add({ days: 1 })
    .add({ months: termMonths })
    .subtract({ days: 1 })
    .toString();
}

/** How far the schedule is planned: a fixed-term contract to its end date; an
 *  open-ended one through the period containing `today` plus the next. */
export function horizon(terms: ContractTerms, today: string): string {
  if (terms.endDate) return terms.endDate;
  const nextStart = addDays(currentPeriodEnd(terms, today), 1);
  const periods = billingGrid(terms, nextStart);
  return periods[periods.length - 1]?.end ?? nextStart;
}
