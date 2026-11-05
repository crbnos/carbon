// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { applyRate, round } from "@carbon/utils";

// The pure contract financing engine: the SF 1443 progress payment request,
// the performance-based payment request and the liquidation of a delivery
// invoice. It reads nothing: `loaders.server.ts` builds its input and
// `service.server.ts` writes its output.
// Spec: .ai/specs/2026-10-12-wbs-interop-and-contract-financing.md (Phase B)
// Research: .ai/research/wbs-interop-and-contract-financing.md (SF 1443 lines)

/** Every SF 1443 amount is whole dollars. */
export const SF1443_WHOLE_DOLLAR_SCALE = 0;

/** The SF 1443 lines Carbon computes, in form order. */
export const SF1443_LINES = [
  "5",
  "11",
  "12a",
  "12b",
  "12c",
  "13",
  "14a",
  "14b",
  "14c",
  "14d",
  "14e",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20a",
  "20b",
  "20c",
  "20d",
  "20e",
  "21a",
  "21b",
  "21c",
  "21d",
  "21e",
  "22",
  "23",
  "24",
  "25",
  "26"
] as const;

export type Sf1443Line = (typeof SF1443_LINES)[number];

/** The lines a user may override, each with a reason. */
export const SF1443_OVERRIDABLE_LINES = [
  "12b",
  "14a",
  "14b",
  "14d",
  "20a",
  "21a",
  "21d",
  "23",
  "26"
] as const satisfies readonly Sf1443Line[];

export type Sf1443OverridableLine = (typeof SF1443_OVERRIDABLE_LINES)[number];

export type Sf1443Input = {
  /** Line 5: the contract price (FAR 32.501-3). */
  contractPrice: number;
  /** Line 6A, a fraction. */
  progressPaymentRate: number;
  /** Line 6B, a fraction. */
  liquidationRate: number;
  /** Line 11: allowable cost incurred through the costs-through date. */
  eligibleCost: number;
  /** Line 12a: every cost incurred, unallowable included. */
  incurredCost: number;
  /** Line 12b. */
  estimateToComplete: number;
  /** Line 18: the earlier requests of the contract that are not Withdrawn. */
  previousRequested: number;
  /** Line 21a: the price of the items delivered, invoiced and accepted. */
  deliveredPrice: number;
  /** Line 23: liquidations taken plus those expected on unpaid invoices. */
  liquidated: number;
  /** Line 20a. Without it, the suggestion `line 11 × 21a ÷ 5`. */
  deliveredCost?: number | null;
  /** Lines 14a, 14b and 14d: subcontract financing. Default 0. */
  subcontractPaid?: number;
  subcontractLiquidated?: number;
  subcontractApprovedUnpaid?: number;
  /** Line 21d: unliquidated advance payments. Default 0. */
  unliquidatedAdvance?: number;
  /** The user's value of a line, which replaces the computed one. */
  overrides?: Partial<Record<Sf1443OverridableLine, number>>;
};

export type Sf1443Result = {
  lines: Record<Sf1443Line, number>;
  /** 5 ÷ 12c when 12c exceeds 5 (FAR 32.503-6(g)), else 1. */
  lossRatio: number;
  /** Section III (lines 20–25) applies: an item has been delivered. */
  hasSection3: boolean;
};

const dollars = (value: number) => round(value, SF1443_WHOLE_DOLLAR_SCALE);

/**
 * The SF 1443 (REV. 10/2023) lines of a progress payment request. Each line
 * is whole dollars and later lines read the rounded earlier ones, as the form
 * does. An override replaces its line before any later line reads it.
 */
export function computeSf1443(input: Sf1443Input): Sf1443Result {
  const overrides = input.overrides ?? {};
  const value = (line: Sf1443OverridableLine, computed: number) =>
    dollars(overrides[line] ?? computed);
  const rate = input.progressPaymentRate;
  const liquidation = input.liquidationRate;

  const l5 = dollars(input.contractPrice);
  const l11 = dollars(input.eligibleCost);
  const l12a = dollars(input.incurredCost);
  const l12b = value("12b", input.estimateToComplete);
  const l12c = l12a + l12b;
  const ratio = lossRatio(l5, l12a, l12b);
  const l13 = dollars(l11 * ratio * rate);
  const l14a = value("14a", input.subcontractPaid ?? 0);
  const l14b = value("14b", input.subcontractLiquidated ?? 0);
  const l14c = l14a - l14b;
  const l14d = value("14d", input.subcontractApprovedUnpaid ?? 0);
  const l14e = l14c + l14d;
  const l15 = l13 + l14e;
  const l16 = dollars(l5 * liquidation);
  const l17 = Math.min(l15, l16);
  const l18 = dollars(input.previousRequested);
  const l19 = Math.max(0, l17 - l18);

  const l21a = value("21a", input.deliveredPrice);
  const hasSection3 = l21a > 0;
  const suggested20a = l5 > 0 ? (l11 * l21a) / l5 : 0;
  const l20a = value("20a", input.deliveredCost ?? suggested20a);
  const l20b = l11 - l20a;
  const l20c = dollars(l20b * rate);
  const l20d = l14e;
  const l20e = l20c + l20d;
  const l21b = l5 - l21a;
  const l21c = dollars(l21b * liquidation);
  const l21d = value("21d", input.unliquidatedAdvance ?? 0);
  const l21e = l21c - l21d;
  const l22 = Math.min(l20e, l21e);
  const l23 = value("23", input.liquidated);
  const l24 = l18 - l23;
  const l25 = Math.max(0, l22 - l24);
  const l26 = value("26", hasSection3 ? Math.max(0, Math.min(l25, l19)) : l19);

  return {
    lines: {
      "5": l5,
      "11": l11,
      "12a": l12a,
      "12b": l12b,
      "12c": l12c,
      "13": l13,
      "14a": l14a,
      "14b": l14b,
      "14c": l14c,
      "14d": l14d,
      "14e": l14e,
      "15": l15,
      "16": l16,
      "17": l17,
      "18": l18,
      "19": l19,
      "20a": l20a,
      "20b": l20b,
      "20c": l20c,
      "20d": l20d,
      "20e": l20e,
      "21a": l21a,
      "21b": l21b,
      "21c": l21c,
      "21d": l21d,
      "21e": l21e,
      "22": l22,
      "23": l23,
      "24": l24,
      "25": l25,
      "26": l26
    },
    lossRatio: ratio,
    hasSection3
  };
}

/**
 * The loss ratio of FAR 32.503-6(g): when the cost to date plus the estimate
 * to complete exceeds the price, eligible cost counts only in the proportion
 * price ÷ (incurred + estimate to complete).
 */
export function lossRatio(
  contractPrice: number,
  incurredCost: number,
  estimateToComplete: number
): number {
  const total = incurredCost + estimateToComplete;
  return total > contractPrice && total > 0 ? contractPrice / total : 1;
}

export type FinancingRate = {
  effectiveDate: string;
  progressPaymentRate: number | null;
  liquidationRate: number;
};

/** The rate in effect on a date (`YYYY-MM-DD`): the latest row on or before it. */
export function rateOn<T extends FinancingRate>(
  rates: readonly T[],
  date: string
): T | null {
  let current: T | null = null;
  for (const rate of rates) {
    if (rate.effectiveDate > date) continue;
    if (!current || rate.effectiveDate > current.effectiveDate) current = rate;
  }
  return current;
}

/**
 * The liquidation the government takes from a delivery invoice
 * (52.232-16(b)): the liquidation rate × the invoice, but never more than the
 * financing still unliquidated after the invoices before it.
 */
export function expectedLiquidation(input: {
  liquidationRate: number;
  invoiceAmount: number;
  unliquidated: number;
  /** The expected liquidation of the contract's earlier unpaid invoices. */
  earlierExpected: number;
  /** Financing already applied to this invoice (a Partially Paid one). */
  alreadyLiquidated?: number;
  currencyDecimals: number;
}): number {
  const byRate = round(
    applyRate(
      input.invoiceAmount,
      input.liquidationRate,
      input.currencyDecimals
    ) - (input.alreadyLiquidated ?? 0),
    input.currencyDecimals
  );
  const available = round(
    input.unliquidated - input.earlierExpected,
    input.currencyDecimals
  );
  return Math.max(0, Math.min(byRate, available));
}

/** Financing received less what delivery invoices have liquidated. */
export function unliquidatedBalance(
  deposits: readonly number[],
  applications: readonly number[]
): number {
  const sum = (values: readonly number[]) =>
    values.reduce((total, value) => total + value, 0);
  return round(sum(deposits) - sum(applications));
}

export type PbpEvent = {
  id: string;
  sequence: number;
  eventType: "Severable" | "Cumulative";
  amount: number;
  completedDate: string | null;
};

export const PBP_CAP_EXCEEDED = "PBP_CAP_EXCEEDED";
export const PBP_NOTHING_TO_BILL = "PBP_NOTHING_TO_BILL";

export type PbpRequest =
  | {
      eventIds: string[];
      /** The DoD values: 1a earlier events, 1b this request, 1c cumulative,
       *  2 total cost incurred (information only). */
      values: { "1a": number; "1b": number; "1c": number; "2": number };
    }
  | { error: typeof PBP_CAP_EXCEEDED | typeof PBP_NOTHING_TO_BILL };

/**
 * The events a performance-based payment request bills: every complete event
 * that no earlier live request billed. A Cumulative event waits until every
 * event before it in sequence is complete (FAR 32.1007(d)). The amount never
 * reads cost: incurred cost is reported for information only (DFARS
 * 232.1001(a)).
 */
export function buildPbpRequest(input: {
  events: readonly PbpEvent[];
  billedEventIds: ReadonlySet<string>;
  contractPrice: number;
  maximumShare: number;
  /** What earlier live requests billed. */
  previousBilled: number;
  incurredCost: number;
}): PbpRequest {
  const ordered = [...input.events].sort((a, b) => a.sequence - b.sequence);
  const eventIds: string[] = [];
  let thisRequest = 0;
  let allEarlierComplete = true;
  for (const event of ordered) {
    const complete = event.completedDate !== null;
    const billable =
      complete &&
      !input.billedEventIds.has(event.id) &&
      (event.eventType === "Severable" || allEarlierComplete);
    if (billable) {
      eventIds.push(event.id);
      thisRequest += event.amount;
    }
    if (!complete) allEarlierComplete = false;
  }
  if (eventIds.length === 0) return { error: PBP_NOTHING_TO_BILL };

  const previous = round(input.previousBilled);
  const current = round(thisRequest);
  const cumulative = round(previous + current);
  if (cumulative > round(input.maximumShare * input.contractPrice)) {
    return { error: PBP_CAP_EXCEEDED };
  }
  return {
    eventIds,
    values: {
      "1a": previous,
      "1b": current,
      "1c": cumulative,
      "2": round(input.incurredCost)
    }
  };
}
