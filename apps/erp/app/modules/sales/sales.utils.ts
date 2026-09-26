import type { Json } from "@carbon/database";
import type { LeasePaymentTerms, RateLadder, Timing } from "@carbon/utils";
import {
  classifyLessorLease,
  classifyRentalLine,
  leasePaymentTerms,
  round,
  wholeMonthsInTerm
} from "@carbon/utils";

export type CategoryMarkups = Record<string, number>;

export type QuoteLinePriceSource = "system" | "manual";

/**
 * Company default markups are "enabled" only when at least one cost category
 * has a positive markup. An all-zero or empty default means the feature is
 * off, so it is treated as "no defaults" everywhere it is consumed.
 * (Markups are whole-percent, non-negative — e.g. `{ laborCost: 25 }`.)
 *
 * Mirrored in the Deno edge runtime (`functions/lib/methods.ts`), which cannot
 * import app code — keep both in sync.
 */
export function getEffectiveDefaultMarkups(
  defaultMarkups: CategoryMarkups
): CategoryMarkups {
  const enabled = Object.values(defaultMarkups).some((v) => v > 0);
  return enabled ? defaultMarkups : {};
}

/**
 * The user-entered fields on a `quoteLinePrice` row that must survive a
 * delete-and-reinsert rewrite. An explicitly provided value wins; an omitted one
 * preserves the value stored for that quantity; if neither exists it falls back
 * to the column default. This is what lets a cost recalc pass only the recomputed
 * `unitPrice` and leave the user's lead time / discount / shipping untouched.
 *
 * `priceSource` defaults to `manual` for a brand-new row: a hand-set price with
 * no declared source is a manual override, not a system (cost-plus) price that a
 * later rollup would reprice.
 */
export function resolvePreservedQuoteLinePriceFields(
  input: {
    leadTime?: number;
    discountPercent?: number;
    shippingCost?: number;
    categoryMarkups?: CategoryMarkups;
    priceSource?: QuoteLinePriceSource;
  },
  existing?: {
    leadTime?: number | null;
    discountPercent?: number | null;
    shippingCost?: number | null;
    categoryMarkups?: CategoryMarkups | null;
    priceSource?: QuoteLinePriceSource | null;
  } | null
): {
  leadTime: number;
  discountPercent: number;
  shippingCost: number;
  categoryMarkups: CategoryMarkups;
  priceSource: QuoteLinePriceSource;
} {
  return {
    discountPercent: input.discountPercent ?? existing?.discountPercent ?? 0,
    leadTime: input.leadTime ?? existing?.leadTime ?? 0,
    shippingCost: input.shippingCost ?? existing?.shippingCost ?? 0,
    categoryMarkups: input.categoryMarkups ?? existing?.categoryMarkups ?? {},
    priceSource: input.priceSource ?? existing?.priceSource ?? "manual"
  };
}

/**
 * Reconcile the quantity breaks a quote line currently offers against the
 * `quoteLinePrice` rows that exist for it, in BOTH directions.
 *
 * The save path historically computed only `added` and seeded rows for it, so
 * removing a break left its price row behind forever. Those orphans render as
 * selectable options on the customer share page and trip the finalize
 * validation, so removal must prune.
 */
export function reconcileQuantityBreaks(
  existing: number[],
  desired: number[]
): { added: number[]; removed: number[] } {
  const existingSet = new Set(existing);
  const desiredSet = new Set(desired);
  return {
    added: Array.from(desiredSet).filter((q) => !existingSet.has(q)),
    removed: Array.from(existingSet).filter((q) => !desiredSet.has(q))
  };
}

export type RecalcPricingDecision =
  | { mode: "reprice"; markups: CategoryMarkups }
  | { mode: "preserve" };

/**
 * Decide how a recalculation should treat one existing price row when a BOM
 * cost changes, based on the row's explicit provenance
 * (`quoteLinePrice.priceSource`):
 *   - `'manual'` (user-typed price, Paperless import) → preserve; no recalc
 *     may change the price
 *   - `'system'` with explicit `categoryMarkups` → cost-plus; reprice from
 *     those markups
 *   - `'system'` without markups → reprice from the effective defaults (which
 *     is `{}` — i.e. price at cost — when defaults are disabled)
 *
 * Mirrored in the Deno edge runtime (`functions/lib/methods.ts`) — keep both
 * in sync.
 */
export function decideRecalcPricing(
  row: {
    priceSource: string | null;
    categoryMarkups: CategoryMarkups | null;
  },
  effectiveDefaults: CategoryMarkups
): RecalcPricingDecision {
  if (row.priceSource === "manual") {
    return { mode: "preserve" };
  }
  const rowMarkups = row.categoryMarkups ?? {};
  if (Object.keys(rowMarkups).length > 0) {
    return { mode: "reprice", markups: rowMarkups };
  }
  return { mode: "reprice", markups: effectiveDefaults };
}

// ── Lessor lease classification (spec §4) ──────────────────────────────────
// The shape activation stores on `rentalAgreementLine.classificationInputs`,
// and the same shape computed here from the agreement terms for a Draft line,
// so the line form and the Activate preview read one structure either way.

export type LeaseClassificationTests = {
  a: boolean;
  b: boolean;
  c: boolean;
  d: boolean;
  e: boolean;
};

export type LeaseClassificationRecord = {
  inputs: {
    ownershipTransfers: boolean;
    purchaseOptionReasonablyCertain: boolean;
    termMonths: number | null;
    economicLifeMonths: number | null;
    pvPayments: number;
    fairValue: number | null;
    specializedAsset: boolean;
  };
  thresholds: { majorPartPercent: number; substantiallyAllPercent: number };
  tests: LeaseClassificationTests;
  pvToFairValuePercent: number | null;
  termToLifePercent: number | null;
  pv: {
    pvRent: number;
    pvPayments: number;
    pvResidual: number;
    netInvestment: number;
  } | null;
  payment: number | null;
  periods: number | null;
  annualRate: number;
  timing: Timing;
  classification: "Operating" | "Sales-Type";
};

export type LeasePolicy = {
  majorPartPercent: number;
  substantiallyAllPercent: number;
};

/** Whole calendar months of the term; null when open-ended. */
export function leaseTermMonths(
  startDate: string,
  endDate: string | null | undefined
): number | null {
  return endDate ? wholeMonthsInTerm(startDate, endDate) : null;
}

/** `leasePaymentTerms` from @carbon/utils — the same function activation
 *  prices a line with — or null when the ladder cannot price it yet (a
 *  Draft line may still be missing its tier). */
export function draftLeasePaymentTerms(args: {
  cycle: "Calendar Month" | "28 Days";
  rateMode: "Best Rate" | "Fixed";
  rateUnit: "Day" | "Week" | "Month" | null;
  ladder: RateLadder | null | undefined;
  discountRate: number;
  startDate: string;
  endDate: string | null;
}): LeasePaymentTerms | null {
  const { ladder, ...terms } = args;
  if (!ladder) return null;
  try {
    return leasePaymentTerms({ ...terms, rates: ladder });
  } catch {
    return null;
  }
}

/** Classifies a Draft line the way activation will: PV of the fixed rent
 *  (+ a reasonably certain purchase option + the guaranteed residual), then
 *  the five ASC 842 tests. A preview — the record activation stores is the
 *  one of record. `pv` is null when the line cannot be priced yet. */
export function previewLeaseClassification(args: {
  agreement: {
    startDate: string;
    endDate: string | null;
    billingCycle: "Calendar Month" | "28 Days";
    billingTiming: Timing;
    discountRate: number;
    ownershipTransfers: boolean;
    specializedAsset: boolean;
    purchaseOptionAmount: number | null;
    purchaseOptionReasonablyCertain: boolean;
  };
  line: {
    rateMode: "Best Rate" | "Fixed";
    rateUnit: "Day" | "Week" | "Month" | null;
    fairValue: number | null;
    economicLifeMonths: number | null;
    guaranteedResidualValue: number | null;
    unguaranteedResidualValue: number | null;
  };
  ladder: RateLadder | null | undefined;
  policy: LeasePolicy;
}): LeaseClassificationRecord {
  const { agreement, line, policy } = args;
  const terms = draftLeasePaymentTerms({
    cycle: agreement.billingCycle,
    rateMode: line.rateMode,
    rateUnit: line.rateUnit,
    ladder: args.ladder,
    discountRate: agreement.discountRate ?? 0,
    startDate: agreement.startDate,
    endDate: agreement.endDate
  });

  if (terms) {
    // Priced: exactly what activation stores (`classifyRentalLine`).
    const { classification, record } = classifyRentalLine({
      terms,
      timing: agreement.billingTiming,
      agreement,
      line: {
        fairValue: line.fairValue,
        economicLifeMonths: line.economicLifeMonths,
        guaranteedResidualValue: line.guaranteedResidualValue ?? 0,
        unguaranteedResidualValue: line.unguaranteedResidualValue ?? 0
      },
      thresholds: policy
    });
    return { ...record, classification };
  }

  // Not priced yet: the tests that need no present value still answer.
  const inputs = {
    ownershipTransfers: agreement.ownershipTransfers,
    purchaseOptionReasonablyCertain: agreement.purchaseOptionReasonablyCertain,
    termMonths: leaseTermMonths(agreement.startDate, agreement.endDate),
    economicLifeMonths: line.economicLifeMonths,
    pvPayments: 0,
    fairValue: line.fairValue,
    specializedAsset: agreement.specializedAsset
  };
  const result = classifyLessorLease(inputs, policy);
  return {
    inputs,
    thresholds: policy,
    tests: result.tests,
    pvToFairValuePercent: null,
    termToLifePercent: result.termToLifePercent,
    pv: null,
    payment: null,
    periods: null,
    annualRate: agreement.discountRate ?? 0,
    timing: agreement.billingTiming,
    classification: result.classification
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Reads the `classificationInputs` JSON activation stored. Null when it is
 *  absent or not the expected shape (a line activated before Phase D). The
 *  classification itself lives on the line, so the caller supplies it. */
export function readLeaseClassification(
  json: Json | null | undefined,
  classification: "Operating" | "Sales-Type"
): LeaseClassificationRecord | null {
  if (!isRecord(json) || !isRecord(json.tests) || !isRecord(json.inputs)) {
    return null;
  }
  const tests = json.tests;
  const inputs = json.inputs;
  const thresholds = isRecord(json.thresholds) ? json.thresholds : {};
  const pv = isRecord(json.pv) ? json.pv : null;
  return {
    inputs: {
      ownershipTransfers: inputs.ownershipTransfers === true,
      purchaseOptionReasonablyCertain:
        inputs.purchaseOptionReasonablyCertain === true,
      termMonths: numberOrNull(inputs.termMonths),
      economicLifeMonths: numberOrNull(inputs.economicLifeMonths),
      pvPayments: numberOrNull(inputs.pvPayments) ?? 0,
      fairValue: numberOrNull(inputs.fairValue),
      specializedAsset: inputs.specializedAsset === true
    },
    thresholds: {
      majorPartPercent: numberOrNull(thresholds.majorPartPercent) ?? 0,
      substantiallyAllPercent:
        numberOrNull(thresholds.substantiallyAllPercent) ?? 0
    },
    tests: {
      a: tests.a === true,
      b: tests.b === true,
      c: tests.c === true,
      d: tests.d === true,
      e: tests.e === true
    },
    pvToFairValuePercent: numberOrNull(json.pvToFairValuePercent),
    termToLifePercent: numberOrNull(json.termToLifePercent),
    pv: pv
      ? {
          pvRent: numberOrNull(pv.pvRent) ?? 0,
          pvPayments: numberOrNull(pv.pvPayments) ?? 0,
          pvResidual: numberOrNull(pv.pvResidual) ?? 0,
          netInvestment: numberOrNull(pv.netInvestment) ?? 0
        }
      : null,
    payment: numberOrNull(json.payment),
    periods: numberOrNull(json.periods),
    annualRate: numberOrNull(json.annualRate) ?? 0,
    timing: json.timing === "Arrears" ? "Arrears" : "Advance",
    classification
  };
}

export type LeaseCommencementPreview = {
  netInvestment: number;
  costOfGoodsSold: number;
  leaseRevenue: number;
  carryingAmount: number;
  sellingProfit: number;
};

/** The commencement journal of a Sales-Type line (spec §4): Dr Net
 *  Investment NI, Dr COGS C − PVres, Cr Lease Revenue PVpay, Cr the unit at
 *  its carrying amount C. Balanced by construction. */
export function leaseCommencementPreview(
  pv: NonNullable<LeaseClassificationRecord["pv"]>,
  carryingAmount: number
): LeaseCommencementPreview {
  const costOfGoodsSold = round(carryingAmount - pv.pvResidual);
  return {
    netInvestment: pv.netInvestment,
    costOfGoodsSold,
    leaseRevenue: pv.pvPayments,
    carryingAmount: round(carryingAmount),
    sellingProfit: round(pv.pvPayments - costOfGoodsSold)
  };
}
