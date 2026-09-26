import {
  earnsInterest,
  LessorClassification,
  LessorScheduleLine,
} from "../shared/lessor-lease.ts";
import {
  assertBalanced,
  EPSILON,
  round,
} from "../shared/precision.ts";
import {
  billingHorizon,
  PeriodSpec,
  RentalBillingCycle,
} from "../shared/rental-billing.ts";
import type { ResidualDestination } from "./validators.ts";

/**
 * The sales-type lease decisions of `post-rental-agreement` (spec §4), pure:
 * numbers and `YYYY-MM-DD` strings in, amounts and journal lines out. The
 * edge function only loads rows and writes what these return, so every
 * decision here is pinned by `lessor.test.ts` without a database.
 */

// The payment terms and the classification record are shared with the app's
// Draft preview (apps/erp sales.utils.ts) through @carbon/utils, so the
// preview and the record activation stores are computed by one function.
export {
  certainPurchaseOption,
  type ClassificationInputs,
  classifyRentalLine,
  type LeasePaymentTerms,
  leasePaymentTerms,
  salesTypeRequirementError,
  wholeMonthsInTerm,
} from "../shared/lessor-lease.ts";

/** The classification a line is booked under: an overridden line keeps the
 *  value the override stored; every other line takes the tests' answer. */
export function settledClassification(
  computed: LessorClassification,
  line: {
    classificationOverride: boolean;
    lessorClassification: LessorClassification | null;
  },
): LessorClassification {
  return line.classificationOverride && line.lessorClassification !== null
    ? line.lessorClassification
    : computed;
}

/** Days in one `28 Days` billing period. */
const DAYS_PER_28_DAY_PERIOD = 28;

/**
 * How far activation cuts a line's billing periods. An operating line goes
 * to the billing horizon (today plus one cycle) like the daily pass, which
 * rolls it on from there — past the end date as holdover. A sales-type line
 * bills exactly its term: capped at the end date, so no period past it is
 * ever cut (a holdover period would bill rent against a net investment the
 * schedule has already closed). The daily pass never rolls a sales-type line.
 */
export function activationBillingThrough(args: {
  classification: LessorClassification;
  cycle: RentalBillingCycle;
  today: string;
  endDate: string | null;
}): string {
  const horizon = billingHorizon(args.cycle, args.today);
  if (args.classification !== "Sales-Type") return horizon;
  if (args.endDate === null) {
    throw new Error("A sales-type lease needs an end date");
  }
  return args.endDate < horizon ? args.endDate : horizon;
}

/** The balance the schedule must close on: what the lessor still expects at
 *  the end of the term — a reasonably certain purchase option plus both
 *  residuals. */
export function leaseClosingTarget(args: {
  purchaseOption: number;
  guaranteedResidualValue: number;
  unguaranteedResidualValue: number;
}): number {
  return round(
    args.purchaseOption + args.guaranteedResidualValue +
      args.unguaranteedResidualValue,
  );
}

/** The billing periods the schedule's lines follow: the first `periods`
 *  regular (non-adjustment) periods of the term, in date order. A fixed term
 *  is generated in full at activation, so there are always enough. */
export function scheduleBillingPeriods(
  generated: Pick<PeriodSpec, "periodStart" | "periodEnd" | "isAdjustment">[],
  periods: number,
): Array<{ periodStart: string; periodEnd: string }> {
  const regular = generated
    .filter((period) => !period.isAdjustment)
    .map(({ periodStart, periodEnd }) => ({ periodStart, periodEnd }))
    .sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
  if (regular.length < periods) {
    throw new Error(
      `A ${periods}-period lease schedule needs ${periods} billing periods, got ${regular.length}`,
    );
  }
  return regular.slice(0, periods);
}

/** One Interest recognition row per schedule line that earns interest,
 *  spanning the billing period the line belongs to. */
export function interestRows(
  schedule: LessorScheduleLine[],
  spans: Array<{ periodStart: string; periodEnd: string }>,
): Array<{
  index: number;
  periodStart: string;
  periodEnd: string;
  scheduledDate: string;
  amount: number;
}> {
  if (schedule.length !== spans.length) {
    throw new Error("Every schedule line needs its billing period");
  }
  return schedule.flatMap((line, index) =>
    !earnsInterest(line.interestAmount)
      ? []
      : [{
      index,
      periodStart: spans[index].periodStart,
      periodEnd: spans[index].periodEnd,
      scheduledDate: line.periodDate,
      amount: round(line.interestAmount),
    }]
  );
}

/** The amounts a fleet unit's commencement books (spec §4). C is the unit's
 *  carrying amount (net book value); the gain the disposal records is the
 *  selling profit. */
export function commencementAmounts(args: {
  pvPayments: number;
  pvResidual: number;
  acquisitionCost: number;
  accumulatedDepreciation: number;
}): {
  netInvestment: number;
  carryingAmount: number;
  costOfGoodsSold: number;
  sellingProfit: number;
} {
  const values = [
    args.pvPayments,
    args.pvResidual,
    args.acquisitionCost,
    args.accumulatedDepreciation,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Lease commencement amounts must be finite");
  }
  const cost = round(args.acquisitionCost);
  const accumulated = round(args.accumulatedDepreciation);
  if (cost < 0 || accumulated < 0 || accumulated > cost) {
    throw new Error(
      "The unit's accumulated depreciation must be between zero and its cost",
    );
  }
  const pvPayments = round(args.pvPayments);
  const pvResidual = round(args.pvResidual);
  const carryingAmount = round(cost - accumulated);
  const costOfGoodsSold = round(carryingAmount - pvResidual);
  return {
    netInvestment: round(pvPayments + pvResidual),
    carryingAmount,
    costOfGoodsSold,
    sellingProfit: round(pvPayments - costOfGoodsSold),
  };
}

/** A journal line as the posting functions store it: `amount` is signed by
 *  the account's NATURAL balance (`journalLine.amount` convention). Same
 *  shape as `PostingLine` in shared/asset-transfer.ts. */
export type PostingLine = {
  accountId: string;
  description: string;
  amount: number;
};

type AccountType = "asset" | "expense" | "revenue";

/** `lib/utils.ts` `debit()` / `credit()` for the three account classes a
 *  lease journal touches: a debit is + on an asset or expense account, − on
 *  revenue. Restated here because importing lib/utils.ts pulls the Deno
 *  driver types into `deno test`'s type check, which fails on the shared
 *  lib baseline. */
function naturalAmount(
  side: "debit" | "credit",
  accountType: AccountType,
  amount: number,
): number {
  const debitPositive = accountType === "asset" || accountType === "expense";
  return side === "debit" === debitPositive ? amount : -amount;
}

type Leg = {
  side: "debit" | "credit";
  accountType: AccountType;
  accountId: string;
  description: string;
  amount: number;
};

/** Legs → natural-balance-signed journal lines, dropping zero legs and
 *  refusing an unbalanced set. A negative leg amount flips its side. */
function toPostingLines(legs: Leg[], label: string): PostingLine[] {
  let debits = 0;
  let credits = 0;
  const lines: PostingLine[] = [];
  for (const leg of legs) {
    const amount = round(leg.amount);
    if (amount === 0) continue;
    const side = amount > 0 ? leg.side : leg.side === "debit" ? "credit" : "debit";
    const value = Math.abs(amount);
    if (side === "debit") debits += value;
    else credits += value;
    lines.push({
      accountId: leg.accountId,
      description: leg.description,
      amount: naturalAmount(side, leg.accountType, value),
    });
  }
  assertBalanced(round(debits), round(credits), EPSILON, label);
  return lines;
}

/**
 * The commencement journal of a sales-type line whose unit comes off the
 * fleet (spec §4):
 *
 *   Dr Net Investment in Leases        NI
 *   Dr Cost of Goods Sold              C − PVres
 *   Dr Accumulated Depreciation        accumulated depreciation
 *       Cr Lease Revenue                       PVpay
 *       Cr fleet class asset account           cost
 *
 * Balanced by construction: NI + (C − PVres) + AD = PVpay + PVres + C − PVres
 * + AD = PVpay + cost. Zero legs are omitted; a residual worth more than the
 * carrying amount turns the COGS leg into a credit.
 */
export function buildCommencementLines(args: {
  pvPayments: number;
  pvResidual: number;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  accounts: {
    netInvestmentInLeasesAccountId: string;
    costOfGoodsSoldAccountId: string;
    leaseRevenueAccountId: string;
    assetAccountId: string;
    accumulatedDepreciationAccountId: string;
  };
}): PostingLine[] {
  const amounts = commencementAmounts(args);
  const { accounts } = args;
  return toPostingLines(
    [
      {
        side: "debit",
        accountType: "asset",
        accountId: accounts.netInvestmentInLeasesAccountId,
        description: "Net Investment in Leases",
        amount: amounts.netInvestment,
      },
      {
        side: "debit",
        accountType: "expense",
        accountId: accounts.costOfGoodsSoldAccountId,
        description: "Cost of Goods Sold",
        amount: amounts.costOfGoodsSold,
      },
      {
        side: "credit",
        accountType: "revenue",
        accountId: accounts.leaseRevenueAccountId,
        description: "Lease Revenue",
        amount: args.pvPayments,
      },
      {
        side: "debit",
        accountType: "asset",
        accountId: accounts.accumulatedDepreciationAccountId,
        description: "Accumulated Depreciation",
        amount: args.accumulatedDepreciation,
      },
      {
        side: "credit",
        accountType: "asset",
        accountId: accounts.assetAccountId,
        description: "Fixed Asset Cost",
        amount: args.acquisitionCost,
      },
    ],
    "Lease commencement journal",
  );
}

/**
 * The net investment the SCHEDULE carries on `asOf`: the closing balance of
 * the last schedule line dated on or before it, or the initial NI when none
 * is (a lease with no schedule lines keeps its initial NI).
 *
 * Read off the schedule, not off what has posted. A sales-type unit comes
 * back only on or after its end date, when the final month's interest
 * usually has not been through a recognition run yet — netting only posted
 * principal overstated the residual by that month and dropped its interest,
 * and with accounting off (no Interest rows ever post) it left the residual
 * at the initial NI. The schedule's lines dated on or before the return keep
 * posting through recognition runs after the return, and complete the Net
 * Investment in Leases account: initial NI + Σ interest − Σ rent − closing = 0.
 */
export function netInvestmentAt(args: {
  initialNetInvestment: number;
  schedule: Array<{ periodDate: string; closingNetInvestment: number }>;
  asOf: string;
}): number {
  let last: { periodDate: string; closingNetInvestment: number } | null = null;
  for (const line of args.schedule) {
    // `YYYY-MM-DD` compares chronologically as text.
    if (line.periodDate > args.asOf) continue;
    if (last === null || line.periodDate > last.periodDate) last = line;
  }
  return round(
    Number(last === null ? args.initialNetInvestment : last.closingNetInvestment),
  );
}

/** Dr the account the returned unit now sits in (the fleet class asset
 *  account, or inventory) / Cr Net Investment in Leases, for the closing net
 *  investment. Nothing to post when it is zero. */
export function buildResidualReturnLines(args: {
  closing: number;
  debitAccountId: string;
  debitDescription: string;
  netInvestmentInLeasesAccountId: string;
}): PostingLine[] {
  if (!Number.isFinite(args.closing)) {
    throw new Error("The closing net investment must be finite");
  }
  if (round(args.closing) < 0) {
    throw new Error("The closing net investment is negative");
  }
  return toPostingLines(
    [
      {
        side: "debit",
        accountType: "asset",
        accountId: args.debitAccountId,
        description: args.debitDescription,
        amount: args.closing,
      },
      {
        side: "credit",
        accountType: "asset",
        accountId: args.netInvestmentInLeasesAccountId,
        description: "Net Investment in Leases",
        amount: args.closing,
      },
    ],
    "Lease residual return journal",
  );
}

/**
 * Why a unit cannot be returned the way the payload asks, or null. Only a
 * sales-type line is checked; an operating return ignores the destination.
 * A sales-type unit comes back at the END of the term — before it, the net
 * investment still carries unpaid rent, and booking that into the fleet or
 * stock would overstate the unit, so early termination stays a manual
 * journal (spec §4).
 */
export function salesTypeReturnError(args: {
  classification: string | null;
  residualDestination: ResidualDestination | null | undefined;
  returnedAt: string;
  endDate: string | null;
  takeOutOfService: boolean;
}): string | null {
  if (args.classification !== "Sales-Type") return null;
  if (!args.residualDestination) {
    return "Choose where the returned unit goes: back to the fleet or into inventory";
  }
  if (args.endDate !== null && args.returnedAt < args.endDate) {
    return "Early termination of a sales-type lease is a manual journal";
  }
  if (args.takeOutOfService && args.residualDestination === "Inventory") {
    return "A unit returned to inventory cannot be taken out of service; return it to the fleet instead";
  }
  return null;
}
