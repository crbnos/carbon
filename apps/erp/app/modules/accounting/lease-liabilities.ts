// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The lessee's Lease Liabilities report (ASC 842-20-50), pure: the balances
// and maturity analysis per leased asset, and the lease cost for a period.
// `getLeaseLiabilities` (accounting.service.ts) reads the rows and calls these.

import type { Database } from "@carbon/database";
import { fiscalYearAndPeriodFor, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";

type LesseeClassification = Database["public"]["Enums"]["lesseeClassification"];
type CapitalizedClassification = Exclude<LesseeClassification, "Short-Term">;

/** How many fiscal years the maturity analysis lists before "Thereafter". */
export const LEASE_MATURITY_YEARS = 5;

/** The current portion is the principal of this many schedule lines (one
 *  year of monthly lines) after `asOf`. */
const CURRENT_PORTION_LINES = 12;

/** One leased asset (a lease component), with its lease's terms. */
export type LeaseLiabilityLease = {
  /** `lease.id`. */
  id: string;
  /** `leaseLine.id`: the schedule lines and payments are the asset's. */
  leaseLineId: string;
  /** The readable lease number. */
  leaseId: string;
  name: string;
  /** The leased asset's description. */
  asset: string;
  supplierName: string | null;
  /** The lease's status. */
  status: Database["public"]["Enums"]["leaseStatus"];
  classification: LesseeClassification | null;
  commencementDate: string;
  /** The day the asset left the books — its Termination or Purchase event —
   *  or null while it has not. An asset of an Active lease can end on its
   *  own, so this is never the lease's end date. */
  endedOn: string | null;
  /** Annual percentage points (6 = 6 %). */
  discountRate: number;
  initialLiability: number | null;
  initialRouAsset: number | null;
};

/** The lease columns `leaseLiabilityAssets` reads. */
export type LeaseLiabilityLeaseRow = {
  id: string;
  leaseId: string;
  name: string;
  supplierName: string | null;
  status: Database["public"]["Enums"]["leaseStatus"];
  commencementDate: string;
  discountRate: number;
};

/** The leased-asset (`leaseLine`) columns `leaseLiabilityAssets` reads. */
export type LeaseLiabilityAssetRow = {
  id: string;
  leaseId: string;
  description: string;
  status: Database["public"]["Enums"]["leaseLineStatus"];
  lesseeClassification: LesseeClassification | null;
  initialLiability: number | null;
  initialRouAsset: number | null;
};

/** A `leaseEvent` row; only Termination and Purchase end an asset. */
export type LeaseLiabilityEvent = {
  leaseLineId: string;
  eventType: Database["public"]["Enums"]["leaseEventType"];
  effectiveDate: string;
};

/**
 * One entry per leased asset whose lease was read, with its lease's terms and
 * its own end: the date of its Termination or Purchase event when the asset
 * is Terminated or Purchased. An asset whose lease is not in `leases` (the
 * caller reads only leases past Draft and not Cancelled) is left out: those
 * assets never were on the books.
 */
export function leaseLiabilityAssets(
  leases: LeaseLiabilityLeaseRow[],
  assets: LeaseLiabilityAssetRow[],
  events: LeaseLiabilityEvent[]
): LeaseLiabilityLease[] {
  const leaseById = new Map(leases.map((lease) => [lease.id, lease]));
  const endedOn = new Map<string, string>();
  for (const event of events) {
    if (event.eventType !== "Termination" && event.eventType !== "Purchase") {
      continue;
    }
    const known = endedOn.get(event.leaseLineId);
    if (!known || event.effectiveDate > known) {
      endedOn.set(event.leaseLineId, event.effectiveDate);
    }
  }
  return assets.flatMap((asset) => {
    const lease = leaseById.get(asset.leaseId);
    if (!lease) return [];
    const ended = asset.status === "Terminated" || asset.status === "Purchased";
    return [
      {
        id: lease.id,
        leaseLineId: asset.id,
        leaseId: lease.leaseId,
        name: lease.name,
        asset: asset.description,
        supplierName: lease.supplierName,
        status: lease.status,
        classification: asset.lesseeClassification,
        commencementDate: lease.commencementDate,
        endedOn: ended ? (endedOn.get(asset.id) ?? null) : null,
        discountRate: lease.discountRate,
        initialLiability: asset.initialLiability,
        initialRouAsset: asset.initialRouAsset
      }
    ];
  });
}

export type LeaseLiabilityScheduleLine = {
  leaseLineId: string;
  periodDate: string;
  principalAmount: number;
  closingLiability: number;
  closingRouAsset: number;
};

export type LeaseLiabilityPayment = {
  leaseLineId: string;
  dueDate: string;
  amount: number;
};

export type LeaseLiabilityRow = {
  id: string;
  leaseLineId: string;
  leaseId: string;
  name: string;
  asset: string;
  supplierName: string | null;
  classification: CapitalizedClassification;
  /** Schedule months after `asOf`. */
  remainingMonths: number;
  discountRate: number;
  liability: number;
  /** Principal the next 12 schedule lines after `asOf` pay down; all of it
   *  when the asset ends within them. */
  currentPortion: number;
  nonCurrentPortion: number;
  netRou: number;
  /** Undiscounted payments still to come, by fiscal year. */
  maturityByFiscalYear: Record<number, number>;
  maturityThereafter: number;
  undiscountedPayments: number;
};

export type LeaseLiabilityTotals = {
  classification: CapitalizedClassification;
  liability: number;
  currentPortion: number;
  nonCurrentPortion: number;
  netRou: number;
  maturityByFiscalYear: Record<number, number>;
  maturityThereafter: number;
  undiscountedPayments: number;
  /** Undiscounted payments − liability. */
  imputedInterest: number;
  /** Years, weighted by liability. Null with no liability. */
  weightedAverageRemainingTermYears: number | null;
  /** Percentage points, weighted by the remaining undiscounted payments. */
  weightedAverageDiscountRate: number | null;
};

export type LeaseLiabilitySummary = {
  asOf: string;
  /** The fiscal years the maturity analysis lists, ascending. */
  fiscalYears: number[];
  rows: LeaseLiabilityRow[];
  totals: LeaseLiabilityTotals[];
};

const CAPITALIZED: CapitalizedClassification[] = ["Operating", "Finance"];

function groupByAsset<T extends { leaseLineId: string }>(rows: T[]) {
  const byAsset = new Map<string, T[]>();
  for (const row of rows) {
    const list = byAsset.get(row.leaseLineId) ?? [];
    list.push(row);
    byAsset.set(row.leaseLineId, list);
  }
  return byAsset;
}

/**
 * The lessee's lease balances as of `asOf` (spec §11). One row per leased
 * asset classified Operating or Finance whose lease has commenced by `asOf`
 * and that is still on the books: it has schedule months after `asOf`, or it
 * ends after `asOf` (`endedOn`). A Terminated or Purchased asset drops out on
 * its own end date. Its schedule stops at that date, so before it the asset
 * can have no month left and still carry a liability.
 *
 * The balance is the schedule's: the liability and the net ROU are the
 * closing figures of the last month dated on or before `asOf` (before the
 * first month, the amounts at commencement). The current portion is the
 * principal of the next 12 schedule lines — lines, not a 12-month date
 * window, which loses a line whenever the window ends a day short of a month
 * end (as of 28 February in the year before a leap year). An asset that
 * ends within those lines takes its whole liability as current: the end
 * settles what the lines do not pay down. The maturity analysis takes the
 * payment rows that month's closing liability still discounts — those due
 * after it — so the undiscounted total less the liability is the interest the
 * remaining months will charge. It reads due dates, not the rows' status,
 * which is today's and not the status on `asOf`.
 *
 * Years in the maturity analysis are fiscal years (`startMonth`, 1–12): the
 * one the day after `asOf` falls in and the four after it, then
 * "Thereafter".
 */
export function summarizeLeaseLiabilities(
  leases: LeaseLiabilityLease[],
  lines: LeaseLiabilityScheduleLine[],
  payments: LeaseLiabilityPayment[],
  { asOf, startMonth }: { asOf: string; startMonth: number }
): LeaseLiabilitySummary {
  const asOfDate = parseDate(asOf);
  const dayAfter = asOfDate.add({ days: 1 });
  const firstYear = fiscalYearAndPeriodFor(
    dayAfter.year,
    dayAfter.month,
    startMonth
  ).fiscalYear;
  const fiscalYears = Array.from(
    { length: LEASE_MATURITY_YEARS },
    (_, index) => firstYear + index
  );
  const lastYear = fiscalYears[fiscalYears.length - 1] ?? firstYear;

  const linesByAsset = groupByAsset(lines);
  const paymentsByAsset = groupByAsset(payments);

  const rows: LeaseLiabilityRow[] = [];
  for (const lease of leases) {
    const classification = lease.classification;
    if (classification !== "Operating" && classification !== "Finance") {
      continue;
    }
    if (lease.initialLiability === null) continue;
    if (lease.status === "Draft" || lease.status === "Cancelled") continue;
    if (lease.commencementDate > asOf) continue;
    if (lease.endedOn !== null && lease.endedOn <= asOf) continue;

    const schedule = [...(linesByAsset.get(lease.leaseLineId) ?? [])].sort(
      (a, b) =>
        a.periodDate < b.periodDate ? -1 : a.periodDate > b.periodDate ? 1 : 0
    );
    const remaining = schedule.filter((line) => line.periodDate > asOf);
    if (remaining.length === 0 && lease.endedOn === null) continue;
    const last = schedule.filter((line) => line.periodDate <= asOf).at(-1);

    const liability = last ? last.closingLiability : lease.initialLiability;
    const netRou = last
      ? last.closingRouAsset
      : (lease.initialRouAsset ?? lease.initialLiability);

    // Accumulate at full precision; round once per figure.
    const nextYear = remaining.slice(0, CURRENT_PORTION_LINES);
    const lastOfYear = nextYear.at(-1);
    const endsWithinYear =
      lease.endedOn !== null &&
      (nextYear.length < CURRENT_PORTION_LINES ||
        (lastOfYear !== undefined && lease.endedOn <= lastOfYear.periodDate));
    const principalNextYear = endsWithinYear
      ? liability
      : nextYear.reduce((sum, line) => sum + line.principalAmount, 0);
    const currentPortion = round(
      Math.min(Math.max(principalNextYear, 0), liability)
    );

    const maturity: Record<number, number> = {};
    let thereafter = 0;
    let undiscounted = 0;
    for (const payment of paymentsByAsset.get(lease.leaseLineId) ?? []) {
      if (last && payment.dueDate <= last.periodDate) continue;
      const { fiscalYear } = fiscalYearAndPeriodFor(
        Number(payment.dueDate.slice(0, 4)),
        Number(payment.dueDate.slice(5, 7)),
        startMonth
      );
      undiscounted += payment.amount;
      if (fiscalYear > lastYear) {
        thereafter += payment.amount;
        continue;
      }
      // A payment the closing liability still holds that fell due between
      // that month end and `asOf` belongs to the first year.
      const year = Math.max(fiscalYear, firstYear);
      maturity[year] = (maturity[year] ?? 0) + payment.amount;
    }
    for (const year of Object.keys(maturity)) {
      maturity[Number(year)] = round(maturity[Number(year)] ?? 0);
    }

    rows.push({
      id: lease.id,
      leaseLineId: lease.leaseLineId,
      leaseId: lease.leaseId,
      name: lease.name,
      asset: lease.asset,
      supplierName: lease.supplierName,
      classification,
      remainingMonths: remaining.length,
      discountRate: lease.discountRate,
      liability: round(liability),
      currentPortion,
      nonCurrentPortion: round(liability - currentPortion),
      netRou: round(netRou),
      maturityByFiscalYear: maturity,
      maturityThereafter: round(thereafter),
      undiscountedPayments: round(undiscounted)
    });
  }

  rows.sort((a, b) =>
    a.leaseId < b.leaseId
      ? -1
      : a.leaseId > b.leaseId
        ? 1
        : a.asset.localeCompare(b.asset)
  );

  const totals = CAPITALIZED.map((classification): LeaseLiabilityTotals => {
    const group = rows.filter((row) => row.classification === classification);
    const sum = (pick: (row: LeaseLiabilityRow) => number) =>
      group.reduce((total, row) => total + pick(row), 0);
    const liability = sum((row) => row.liability);
    const undiscounted = sum((row) => row.undiscountedPayments);
    const maturity: Record<number, number> = {};
    for (const year of fiscalYears) {
      maturity[year] = round(sum((row) => row.maturityByFiscalYear[year] ?? 0));
    }
    return {
      classification,
      liability: round(liability),
      currentPortion: round(sum((row) => row.currentPortion)),
      nonCurrentPortion: round(sum((row) => row.nonCurrentPortion)),
      netRou: round(sum((row) => row.netRou)),
      maturityByFiscalYear: maturity,
      maturityThereafter: round(sum((row) => row.maturityThereafter)),
      undiscountedPayments: round(undiscounted),
      imputedInterest: round(undiscounted - liability),
      weightedAverageRemainingTermYears:
        liability > 0
          ? round(
              sum((row) => row.liability * row.remainingMonths) / liability / 12
            )
          : null,
      weightedAverageDiscountRate:
        undiscounted > 0
          ? round(
              sum((row) => row.discountRate * row.undiscountedPayments) /
                undiscounted
            )
          : null
    };
  });

  return { asOf, fiscalYears, rows, totals };
}

export type LeaseCostScheduleRow = {
  /** The asset (`leaseLine.id`) the row's schedule line belongs to. */
  leaseLineId: string;
  type: Database["public"]["Enums"]["revenueScheduleType"];
  amount: number;
};

export type LeaseCostInvoiceLine = {
  /** The asset of the line's payment row; null for a variable charge. */
  leaseLineId: string | null;
  leasePaymentId: string | null;
  /** The line's amount in base currency, before tax. */
  amount: number;
};

export type LeaseCostSummary = {
  operatingLeaseCost: number;
  financeAmortization: number;
  financeInterest: number;
  shortTermLeaseCost: number;
  variableLeaseCost: number;
  /** Fixed payments of Operating leases: amounts in the liability. */
  cashPaidOperating: number;
  /** Fixed payments of Finance leases: amounts in the liability. */
  cashPaidFinance: number;
};

/**
 * Lease cost for a period (ASC 842-20-50-4), from the lease rows the lease
 * run posted (`scheduleRows`) and the posted purchase invoice Lease lines
 * (`invoiceLines`), both already limited to the period. An Operating lease's
 * Interest and Amortization rows are one straight-line cost; a Finance
 * lease's are its interest and its ROU amortization. A Lease line with no
 * payment row is a variable charge; one with a payment row is the cost of a
 * Short-Term lease, else cash paid for an amount in the liability.
 */
export function summarizeLeaseCosts(
  classificationByAsset: Map<string, LesseeClassification>,
  scheduleRows: LeaseCostScheduleRow[],
  invoiceLines: LeaseCostInvoiceLine[]
): LeaseCostSummary {
  const totals = {
    operatingLeaseCost: 0,
    financeAmortization: 0,
    financeInterest: 0,
    shortTermLeaseCost: 0,
    variableLeaseCost: 0,
    cashPaidOperating: 0,
    cashPaidFinance: 0
  };
  for (const row of scheduleRows) {
    const classification = classificationByAsset.get(row.leaseLineId);
    if (classification === "Operating") {
      totals.operatingLeaseCost += row.amount;
    } else if (classification === "Finance") {
      if (row.type === "Interest") totals.financeInterest += row.amount;
      if (row.type === "Amortization") totals.financeAmortization += row.amount;
    }
  }
  for (const line of invoiceLines) {
    if (!line.leasePaymentId || !line.leaseLineId) {
      totals.variableLeaseCost += line.amount;
      continue;
    }
    const classification = classificationByAsset.get(line.leaseLineId);
    if (classification === "Short-Term") {
      totals.shortTermLeaseCost += line.amount;
    } else if (classification === "Operating") {
      totals.cashPaidOperating += line.amount;
    } else if (classification === "Finance") {
      totals.cashPaidFinance += line.amount;
    }
  }
  return {
    operatingLeaseCost: round(totals.operatingLeaseCost),
    financeAmortization: round(totals.financeAmortization),
    financeInterest: round(totals.financeInterest),
    shortTermLeaseCost: round(totals.shortTermLeaseCost),
    variableLeaseCost: round(totals.variableLeaseCost),
    cashPaidOperating: round(totals.cashPaidOperating),
    cashPaidFinance: round(totals.cashPaidFinance)
  };
}
