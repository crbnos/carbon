// Rental invoice line posting — which accounts a Rental line's revenue lands
// on, and which schedule rows it writes or consumes. Pure: post-sales-invoice
// loads the facts, builds the journal lines through buildSalesPostingLines
// with the legs planned here, and writes the rows.
// Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §3
// ("Posting a Rental line") and §4 (sales-type leases).

import { credit, debit } from "../lib/utils.ts";
import { EPSILON, round } from "../shared/precision.ts";
import {
  addDays,
  type ScheduleRow,
  spreadStraightLine,
} from "../shared/revenue-schedule.ts";
import type {
  SalesPostingAccount,
  SalesPostingJournalLine,
  SalesRevenueLeg,
} from "../shared/sales-posting-amounts.ts";

export type RentalLineKind = "Rent" | "Charge" | "Purchase Option";
export type RentalClassification = "Operating" | "Sales-Type" | "Direct Financing";

/** A revenueRecognitionSchedule row of the agreement line, dates `YYYY-MM-DD`. */
export type RentalScheduleFact = {
  id: string;
  periodStart: string;
  periodEnd: string;
  scheduledDate: string;
  amount: number;
};

export type RentalLinePlanInput = {
  kind: RentalLineKind;
  classification: RentalClassification | null;
  /** The line's revenue in base currency (quantity × unit price), signed. */
  revenueBase: number;
  /** The billing period the line bills; null for a charge. */
  period: { periodStart: string; periodEnd: string } | null;
  /** Accrual rows of the agreement line not yet billed by any line, Planned
   *  or Posted: a run's Accrual rows usually post AFTER the arrears invoice
   *  that bills them, and a Planned row posting later debits the contract
   *  asset this invoice credits, so it nets to zero either way. Each row is a
   *  slice inside exactly one billing period. */
  unbilledAccruals: RentalScheduleFact[];
  /** Planned Deferral rows of the agreement line. */
  plannedDeferrals: RentalScheduleFact[];
  accounts: {
    deferredRevenue: SalesPostingAccount;
    contractAsset: SalesPostingAccount;
    rentalIncome: SalesPostingAccount;
    /** Required for a Sales-Type line's rent and purchase option only. */
    netInvestmentInLeases?: SalesPostingAccount | null;
  };
  /** The rental agreement's row id — the revenue legs reference it. */
  rentalAgreementId: string;
};

/** How the deferred-revenue leg (always the LAST revenue leg) turns into
 *  Deferral rows once its posted base amount is known. */
export type RentalSchedulePlan =
  | { kind: "spread"; startDate: string; endDate: string }
  | { kind: "shrink"; buckets: RentalScheduleFact[] }
  | null;

export type RentalLinePlan = {
  revenueLegs: SalesRevenueLeg[];
  /** Accrual rows this line bills (stamp `billedBySalesInvoiceLineId`). */
  billedAccrualIds: string[];
  schedule: RentalSchedulePlan;
};

const overlaps = (
  row: { periodStart: string; periodEnd: string },
  period: { periodStart: string; periodEnd: string },
) => row.periodStart <= period.periodEnd && row.periodEnd >= period.periodStart;

const within = (
  row: { periodStart: string; periodEnd: string },
  period: { periodStart: string; periodEnd: string },
) => row.periodStart >= period.periodStart && row.periodEnd <= period.periodEnd;

export function planRentalLine(input: RentalLinePlanInput): RentalLinePlan {
  const { kind, classification, revenueBase, period, accounts } = input;
  // A line activated before classification existed carries no value and is
  // operating by definition. Direct Financing has no input in v1.
  if (
    classification !== null && classification !== "Operating" &&
    classification !== "Sales-Type"
  ) {
    throw new Error(`${classification} rental lines cannot be invoiced yet`);
  }
  const document = {
    documentType: "Rental Agreement" as const,
    documentId: input.rentalAgreementId,
  };
  const deferredLeg: SalesRevenueLeg = {
    account: accounts.deferredRevenue,
    accountClass: "Liability",
    description: "Deferred Revenue",
    ...document,
  };

  if (kind === "Charge") {
    // Variable lease payments are recognized when billed — never deferred,
    // and never part of a sales-type lease's net investment.
    return {
      revenueLegs: [{
        account: accounts.rentalIncome,
        accountClass: "Revenue",
        description: "Rental Income",
        ...document,
      }],
      billedAccrualIds: [],
      schedule: null,
    };
  }

  if (classification === "Sales-Type") {
    // The lease revenue was recognized at commencement and the receivable
    // booked as the net investment; a rent payment or the exercised purchase
    // option collects part of it. Interest is posted by the recognition run
    // from the lease schedule, so nothing is deferred or accrued here.
    if (revenueBase < 0) {
      throw new Error("Early-return credits do not apply to a sales-type lease");
    }
    if (!accounts.netInvestmentInLeases) {
      throw new Error(
        "Sales-type rental invoices need the Net Investment in Leases account mapped in the accounting defaults",
      );
    }
    return {
      revenueLegs: [{
        account: accounts.netInvestmentInLeases,
        accountClass: "Asset",
        description: "Net Investment in Leases",
        ...document,
      }],
      billedAccrualIds: [],
      schedule: null,
    };
  }

  if (kind === "Purchase Option") {
    throw new Error("Purchase option billing requires a sales-type line");
  }

  if (!period) throw new Error("A rent line needs its billing period");
  if (period.periodEnd < period.periodStart) {
    throw new Error("A rent line's billing period ends before it starts");
  }

  if (revenueBase >= 0) {
    // Rent already earned and accrued (Dr contract asset / Cr rental income,
    // posted now or by a later run) is billed by moving it off the contract
    // asset; the rest is unearned and deferred from the day after the last
    // accrued day.
    const billed = input.unbilledAccruals
      .filter((row) => overlaps(row, period))
      .sort((a, b) => a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0);
    const accrued = round(billed.reduce((sum, row) => sum + row.amount, 0));
    const fromContractAsset = round(Math.min(Math.max(accrued, 0), revenueBase));
    const coveredThrough = billed.reduce<string | null>(
      (latest, row) => latest === null || row.periodEnd > latest ? row.periodEnd : latest,
      null,
    );
    const startDate = coveredThrough !== null && coveredThrough >= period.periodStart
      ? coveredThrough < period.periodEnd ? addDays(coveredThrough, 1) : period.periodEnd
      : period.periodStart;
    return {
      revenueLegs: [
        {
          account: accounts.contractAsset,
          accountClass: "Asset",
          description: "Contract Assets",
          amount: fromContractAsset,
          ...document,
        },
        deferredLeg,
      ],
      billedAccrualIds: billed.map((row) => row.id),
      schedule: { kind: "spread", startDate, endDate: period.periodEnd },
    };
  }

  // An early-return credit on rent billed in advance: the unearned part still
  // sits in deferred revenue as this period's Planned rows, so the credit
  // comes off deferred revenue and those rows shrink (by negative Deferral
  // rows of this line, so a VOID simply deletes them). Whatever the period
  // already recognized comes off rental income instead.
  const buckets = plannedBuckets(input.plannedDeferrals, period);
  const capacity = round(
    buckets.reduce((sum, bucket) => sum + Math.max(bucket.amount, 0), 0),
  );
  const fromDeferred = round(Math.min(-revenueBase, capacity));
  return {
    revenueLegs: [
      {
        account: accounts.rentalIncome,
        accountClass: "Revenue",
        description: "Rental Income",
        amount: round(revenueBase + fromDeferred),
        ...document,
      },
      deferredLeg,
    ],
    billedAccrualIds: [],
    schedule: { kind: "shrink", buckets },
  };
}

/** The period's Planned Deferral rows summed per recognition slice, latest
 *  slice first — the unused days of an early return are the last ones. */
function plannedBuckets(
  rows: RentalScheduleFact[],
  period: { periodStart: string; periodEnd: string },
): RentalScheduleFact[] {
  const bySlice = new Map<string, RentalScheduleFact>();
  for (const row of rows) {
    if (!within(row, period)) continue;
    const key = `${row.periodStart}|${row.periodEnd}|${row.scheduledDate}`;
    const bucket = bySlice.get(key);
    if (bucket) bucket.amount = round(bucket.amount + row.amount);
    else bySlice.set(key, { ...row, id: key, amount: row.amount });
  }
  return [...bySlice.values()].sort((a, b) =>
    a.periodEnd > b.periodEnd ? -1 : a.periodEnd < b.periodEnd ? 1 : 0
  );
}

/** The Deferral rows for the deferred-revenue leg's posted base amount. A
 *  spread straight-lines it; a shrink takes it (negative) out of the period's
 *  Planned slices, latest first, never below zero. */
export function rentalScheduleRows(
  schedule: RentalSchedulePlan,
  deferredAmount: number,
): ScheduleRow[] {
  if (schedule === null || deferredAmount === 0) return [];
  if (schedule.kind === "spread") {
    if (deferredAmount < 0) {
      throw new Error("A rent line cannot defer a negative amount");
    }
    return spreadStraightLine({
      amount: deferredAmount,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
    });
  }
  if (deferredAmount > 0) {
    throw new Error("An early-return credit cannot add deferred revenue");
  }
  let remaining = -deferredAmount;
  const rows: ScheduleRow[] = [];
  for (const bucket of schedule.buckets) {
    if (remaining <= EPSILON) break;
    const take = round(Math.min(remaining, Math.max(bucket.amount, 0)));
    if (take <= 0) continue;
    rows.push({
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      scheduledDate: bucket.scheduledDate,
      amount: -take,
    });
    remaining = round(remaining - take);
  }
  if (remaining > EPSILON) {
    throw new Error("The credit exceeds the period's unrecognized rent");
  }
  return rows;
}

/** One leg of the purchase option settlement: a positive base amount on the
 *  given side of `account`. */
export type LeaseSettlementLeg = {
  account: SalesPostingAccount;
  accountClass: "Asset" | "Revenue" | "Expense";
  side: "debit" | "credit";
  amount: number;
  description: string;
  documentType: "Rental Agreement";
  documentId: string;
};

export type PurchaseOptionSettlementInput = {
  /** The line's lease schedule closing balance — the `closingNetInvestment`
   *  of its last `rentalLeaseScheduleLine`: the purchase option when it was
   *  reasonably certain, plus the guaranteed and unguaranteed residuals. */
  closingTarget: number;
  /** The option billed, in base currency — the Net Investment credit the
   *  purchase option line posts. */
  optionAmount: number;
  accounts: {
    netInvestmentInLeases: SalesPostingAccount;
    costOfGoodsSold?: SalesPostingAccount | null;
    leaseRevenue?: SalesPostingAccount | null;
  };
  rentalAgreementId: string;
};

const requireAccount = (
  account: SalesPostingAccount | null | undefined,
  accountClass: "Revenue" | "Expense",
  label: string,
): SalesPostingAccount => {
  if (
    !account || account.class !== accountClass || !account.active ||
    account.isGroup
  ) {
    throw new Error(
      `Exercising a purchase option needs the ${label} account mapped in the accounting defaults as an active ${accountClass} leaf`,
    );
  }
  return account;
};

/** An exercised purchase option derecognizes the whole net investment of the
 *  line, not only the option billed. Whatever the schedule's closing balance
 *  holds beyond the option is a unit let go below its carrying residual
 *  (Dr Cost of Goods Sold / Cr Net Investment); an option above it is a gain
 *  (Dr Net Investment / Cr Lease Revenue). Balanced by construction. */
export function purchaseOptionSettlement(
  input: PurchaseOptionSettlementInput,
): LeaseSettlementLeg[] {
  const { closingTarget, optionAmount, accounts } = input;
  if (!Number.isFinite(closingTarget) || !Number.isFinite(optionAmount)) {
    throw new Error("A purchase option settlement needs finite amounts");
  }
  const remainder = round(closingTarget - optionAmount);
  if (Math.abs(remainder) <= EPSILON) return [];
  const document = {
    documentType: "Rental Agreement" as const,
    documentId: input.rentalAgreementId,
  };
  const netInvestment = {
    account: accounts.netInvestmentInLeases,
    accountClass: "Asset" as const,
    description: "Net Investment in Leases",
    ...document,
  };
  if (remainder > 0) {
    const amount = remainder;
    return [
      {
        account: requireAccount(accounts.costOfGoodsSold, "Expense", "Cost of Goods Sold"),
        accountClass: "Expense",
        side: "debit",
        amount,
        description: "Cost of Goods Sold - Lease Residual",
        ...document,
      },
      { ...netInvestment, side: "credit", amount },
    ];
  }
  const amount = -remainder;
  return [
    { ...netInvestment, side: "debit", amount },
    {
      account: requireAccount(accounts.leaseRevenue, "Revenue", "Lease Revenue"),
      accountClass: "Revenue",
      side: "credit",
      amount,
      description: "Lease Revenue",
      ...document,
    },
  ];
}

/** Settlement legs as journal lines, natural-balance signed, sharing the
 *  purchase option line's journal line reference so a VOID finds and
 *  reverses them with the line's other rental legs. */
export function leaseSettlementJournalLines(
  legs: LeaseSettlementLeg[],
  context: {
    companyId: string;
    quantity: number;
    journalLineReference: string;
    externalDocumentId?: string | null;
    documentLineReference?: string | null;
  },
): SalesPostingJournalLine[] {
  return legs.map((leg) => {
    const naturalClass = leg.accountClass.toLowerCase() as
      | "asset"
      | "revenue"
      | "expense";
    return {
      accountId: leg.account.id,
      description: leg.description,
      amount: leg.side === "debit"
        ? debit(naturalClass, leg.amount)
        : credit(naturalClass, leg.amount),
      quantity: round(context.quantity),
      documentType: leg.documentType,
      documentId: leg.documentId,
      externalDocumentId: context.externalDocumentId,
      documentLineReference: context.documentLineReference,
      journalLineReference: context.journalLineReference,
      companyId: context.companyId,
    };
  });
}
