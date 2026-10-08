// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import type { LeasePaymentTerms, RateUnit, Timing } from "@carbon/utils";
import {
  classifyLessorLease,
  classifyRentalLine,
  equals,
  leasePaymentTerms,
  round,
  wholeMonthsInTerm
} from "@carbon/utils";
import { z } from "zod";
import type {
  MatchedRule,
  PriceTraceStep,
  PricingRuleConfigurationPrice
} from "./types";

export type CategoryMarkups = Record<string, number>;

export type QuoteLinePriceSource = "system" | "manual";

/**
 * Company default markups are "enabled" only when at least one cost category
 * has a positive markup. An all-zero or empty default means the feature is
 * off, so it is treated as "no defaults" everywhere it is consumed.
 * (Markups are whole-percent, non-negative — e.g. `{ laborCost: 25 }`.)
 *
 * Mirrored in `packages/database/src/methods.ts`, which cannot import app code — keep
 * both in sync.
 */
export function getEffectiveDefaultMarkups(
  defaultMarkups: CategoryMarkups
): CategoryMarkups {
  const enabled = Object.values(defaultMarkups).some((v) => v > 0);
  return enabled ? defaultMarkups : {};
}

// What a quote line price starts from when it is not the item's sale price.
export const QUOTE_BASE_PRICE_SOURCES = {
  costPlus: "Cost + Markup",
  supplier: "Supplier Price"
} as const;

/**
 * resolvePrice names every base price "Item Unit Sale Price". A quote row that
 * starts from somewhere else — the cost-plus rollup, a supplier price break —
 * names its real base so the stored trace reads true. A null source keeps the
 * trace as resolved.
 */
export function withBasePriceSource(
  trace: PriceTraceStep[],
  source: string | null
): PriceTraceStep[] {
  if (!source) return trace;
  return trace.map((step) =>
    step.step === "Base Price" ? { ...step, source } : step
  );
}

/**
 * The unit price today's calculation gives, at the line's precision — null
 * when there is no calculation (a manual price) or it gives the stored price.
 * What the pricing trace's "repricing gives X" note and Reprice act on.
 */
export function repricedUnitPrice(
  currentTrace: PriceTraceStep[] | null,
  unitPrice: number,
  precision: number
): number | null {
  const finalPrice = currentTrace?.at(-1)?.amount;
  if (finalPrice === undefined) return null;
  const rounded = round(finalPrice, precision);
  return equals(rounded, unitPrice) ? null : rounded;
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
 * Mirrored in `packages/database/src/methods.ts` — keep both in sync.
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
  classification: "Rental" | "Sale";
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
 *  prices a line with — or null when the line cannot be priced (a rate that
 *  is not a finite number). */
export function draftLeasePaymentTerms(args: {
  cycle: "Calendar Month" | "28 Days";
  rateUnit: RateUnit;
  rate: number;
  discountRate: number;
  startDate: string;
  endDate: string | null;
  /** The agreement currency's `decimalPlaces`, as activation prices it. */
  decimals: number;
}): LeasePaymentTerms | null {
  if (!Number.isFinite(args.rate)) return null;
  try {
    return leasePaymentTerms(args);
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
    rateUnit: RateUnit;
    rate: number;
    fairValue: number | null;
    economicLifeMonths: number | null;
    guaranteedResidualValue: number | null;
    unguaranteedResidualValue: number | null;
  };
  policy: LeasePolicy;
  /** The agreement currency's `decimalPlaces`. */
  decimals: number;
}): LeaseClassificationRecord {
  const { agreement, line, policy } = args;
  const terms = draftLeasePaymentTerms({
    cycle: agreement.billingCycle,
    rateUnit: line.rateUnit,
    rate: line.rate,
    discountRate: agreement.discountRate ?? 0,
    startDate: agreement.startDate,
    endDate: agreement.endDate,
    decimals: args.decimals
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
  classification: "Rental" | "Sale"
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

/** The commencement journal of a Sale line (spec §4): Dr Net
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

export type RentalEquipmentStatus =
  | "To Deliver"
  | "Partially Delivered"
  | "On Rent"
  | "Partially Returned"
  | "Returned";

/** Where an agreement's units are, from their line statuses: the header badge
 *  next to the agreement's own status. Sold counts as back — the unit no
 *  longer rents. Null with no units. */
export function rentalEquipmentStatus(
  lines: {
    status: Database["public"]["Enums"]["rentalAgreementLineStatus"];
  }[]
): RentalEquipmentStatus | null {
  if (lines.length === 0) return null;
  const pending = lines.filter((line) => line.status === "Pending").length;
  const onRent = lines.filter((line) => line.status === "On Rent").length;
  const back = lines.length - pending - onRent;

  if (pending === lines.length) return "To Deliver";
  // A unit still in the yard while others have left.
  if (pending > 0) return "Partially Delivered";
  if (onRent === lines.length) return "On Rent";
  if (onRent > 0) return "Partially Returned";
  return back > 0 ? "Returned" : null;
}

/** The last Posted shipment that delivered the unit and the last Posted receipt that returned it. */
export function rentalLineDocuments(
  lineId: string,
  shipments: {
    id: string;
    shipmentId: string;
    status: string;
    shipmentFixedAssetLine: {
      rentalAgreementLineId: string | null;
      shipped: boolean;
    }[];
  }[],
  receipts: {
    id: string;
    receiptId: string;
    status: string;
    receiptFixedAssetLine: {
      rentalAgreementLineId: string | null;
      received: boolean;
    }[];
  }[]
): {
  shipment: { id: string; shipmentId: string } | null;
  receipt: { id: string; receiptId: string } | null;
} {
  let shipment: { id: string; shipmentId: string } | null = null;
  for (const s of shipments) {
    if (s.status !== "Posted") continue;
    if (
      s.shipmentFixedAssetLine.some(
        (l) => l.rentalAgreementLineId === lineId && l.shipped
      )
    ) {
      shipment = { id: s.id, shipmentId: s.shipmentId };
    }
  }
  let receipt: { id: string; receiptId: string } | null = null;
  for (const r of receipts) {
    if (r.status !== "Posted") continue;
    if (
      r.receiptFixedAssetLine.some(
        (l) => l.rentalAgreementLineId === lineId && l.received
      )
    ) {
      receipt = { id: r.id, receiptId: r.receiptId };
    }
  }
  return { shipment, receipt };
}

// The surcharge one configuration price adds for a line's configuration: the
// amount per unit of a numeric value (`value` null), else the amount when the
// chosen value equals `value` (a list option, or "true" for a boolean).
export function configurationSurcharge(
  price: PricingRuleConfigurationPrice,
  configuration: Record<string, unknown>
): number {
  const chosen = configuration[price.key];
  if (chosen === undefined || chosen === null || chosen === "") return 0;
  if (price.value === null) {
    const units = typeof chosen === "number" ? chosen : Number(chosen);
    return Number.isFinite(units) ? price.amount * units : 0;
  }
  return String(chosen) === price.value ? price.amount : 0;
}

// A signed per-unit surcharge for one configuration parameter value. `value`
// is the list option (or "true" for a boolean); null prices a numeric
// parameter per unit of its value. `label` is the parameter's label when the
// rule was saved, so the price trace can name it without a lookup. Defined
// here rather than in sales.models so the pricing engine (and its tests) stay
// out of the models import graph; pricingRuleValidator reuses it.
export const pricingRuleConfigurationPriceValidator = z.object({
  key: z.string().min(1),
  value: z.string().nullable(),
  amount: z.number(),
  label: z.string().optional()
});

// The stored JSONB, keeping only well-formed entries — one bad entry must not
// discard a rule's other prices.
function parseConfigurationPrices(
  value: unknown
): PricingRuleConfigurationPrice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = pricingRuleConfigurationPriceValidator.safeParse(entry);
    return parsed.success && Number.isFinite(parsed.data.amount)
      ? [parsed.data]
      : [];
  });
}

type PricingRuleRow = Omit<MatchedRule, "configurationPrices"> & {
  configurationPrices: unknown;
};

// A `pricingRule` row as the engine reads it. Only a Configuration rule
// carries configuration prices.
export function toMatchedRule(row: PricingRuleRow): MatchedRule {
  return {
    id: row.id,
    name: row.name,
    ruleType: row.ruleType,
    amountType: row.amountType,
    amount: row.amount,
    priority: row.priority,
    configurationPrices:
      row.ruleType === "Configuration"
        ? parseConfigurationPrices(row.configurationPrices)
        : []
  };
}

type ApplyPriceRulesOptions = {
  // The line's configurator values, keyed by configurationParameter key.
  configuration?: Record<string, unknown> | null;
  // A price override with `applyRulesOnTop = false` pins the part's price:
  // discounts and markups are skipped, but the configuration prices still
  // apply — they price the chosen options, not the part.
  configurationOnly?: boolean;
};

export function applyPriceRules(
  startingPrice: number,
  matchedRules: MatchedRule[],
  { configuration, configurationOnly = false }: ApplyPriceRulesOptions = {}
): { finalPrice: number; appendedTrace: PriceTraceStep[] } {
  const appendedTrace: PriceTraceStep[] = [];
  let finalPrice = startingPrice;

  // Configuration surcharges: signed amounts added to the starting price
  // before any discount or markup, stacking across every matched
  // Configuration rule.
  if (configuration) {
    const byPriority = matchedRules
      .filter((rule) => rule.ruleType === "Configuration")
      .sort((a, b) => b.priority - a.priority);
    for (const rule of byPriority) {
      for (const price of rule.configurationPrices) {
        const adjustment = configurationSurcharge(price, configuration);
        if (adjustment === 0) continue;
        finalPrice = finalPrice + adjustment;
        const label = price.label ?? price.key;
        appendedTrace.push({
          step: "Configuration",
          label,
          source: `Rule: ${rule.name} (${label} = ${String(
            configuration[price.key]
          )})`,
          amount: finalPrice,
          adjustment,
          ruleId: rule.id
        });
      }
    }
  }

  const adjustmentRules = configurationOnly ? [] : matchedRules;
  const markupRules = adjustmentRules.filter((r) => r.ruleType === "Markup");
  const discountRules = adjustmentRules.filter(
    (r) => r.ruleType === "Discount"
  );

  // Discounts: highest priority wins (non-stacking); ties broken by best
  // effective amount against the current running price.
  if (discountRules.length > 0) {
    const ranked = discountRules
      .map((rule) => ({
        rule,
        effective:
          rule.amountType === "Percentage"
            ? finalPrice * rule.amount
            : rule.amount
      }))
      .sort((a, b) => {
        if (b.rule.priority !== a.rule.priority) {
          return b.rule.priority - a.rule.priority;
        }
        return b.effective - a.effective;
      });

    const winner = ranked[0];
    if (winner && winner.effective > 0) {
      finalPrice = finalPrice - winner.effective;
      appendedTrace.push({
        step: "Discount",
        source: `Rule: ${winner.rule.name}`,
        amount: finalPrice,
        adjustment: -winner.effective,
        ruleId: winner.rule.id
      });
    }
  }

  // Markups: stack in priority order (highest first), compounding on the
  // running price so ordering + basis are both deterministic.
  const sortedMarkups = [...markupRules].sort(
    (a, b) => b.priority - a.priority
  );
  for (const rule of sortedMarkups) {
    const adjustment =
      rule.amountType === "Percentage" ? finalPrice * rule.amount : rule.amount;
    finalPrice = finalPrice + adjustment;
    appendedTrace.push({
      step: "Markup",
      source: `Rule: ${rule.name}`,
      amount: finalPrice,
      adjustment,
      ruleId: rule.id
    });
  }

  if (finalPrice < 0) {
    appendedTrace.push({
      step: "Floor",
      source: "Clamped to 0 (rules drove price negative)",
      amount: 0,
      adjustment: -finalPrice
    });
    finalPrice = 0;
  }

  return { finalPrice, appendedTrace };
}

type Configuration = Record<string, unknown>;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  // An unset parameter reads the same whether it is absent, null or blank.
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}

/**
 * The configuration a job made for a sales order line is built with: the
 * line's own, falling back to its quote line's. `reconfigured` is true when
 * the order line was configured differently from the quote — the quote's
 * method was built for another configuration, so the job must be built from
 * the item with the order line's values instead of copied from the quote.
 */
export function resolveJobConfiguration(
  salesOrderLineConfiguration: unknown,
  quoteLineConfiguration: unknown
): { configuration: Configuration | null; reconfigured: boolean } {
  const orderLine = asConfiguration(salesOrderLineConfiguration);
  const quoteLine = asConfiguration(quoteLineConfiguration);
  if (!orderLine) return { configuration: quoteLine, reconfigured: false };
  return {
    configuration: orderLine,
    reconfigured: stableStringify(orderLine) !== stableStringify(quoteLine)
  };
}

// A stored line configuration (JSONB), or null when it is empty or not an
// object.
export function asConfiguration(value: unknown): Configuration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.keys(value).length > 0 ? (value as Configuration) : null;
}

function sameMarkups(a: CategoryMarkups, b: CategoryMarkups): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

/**
 * The price a configured quote line starts from: the part's sale price, the
 * same base its sales order line starts from, so the configuration prices land
 * on one base on the quote and the order. Null prices the row cost-plus — the
 * line is not configured, the part has no sale price, or the row carries
 * markups someone chose. Markups equal to the company defaults are the ones
 * the row was seeded with, not a choice.
 */
export function configuredQuoteBasePrice({
  configuration,
  unitSalePrice,
  categoryMarkups,
  defaultMarkups
}: {
  configuration: unknown;
  unitSalePrice: number | null | undefined;
  categoryMarkups: CategoryMarkups | null | undefined;
  defaultMarkups: CategoryMarkups;
}): number | null {
  if (!asConfiguration(configuration)) return null;
  if (!unitSalePrice || unitSalePrice <= 0) return null;
  const markups = categoryMarkups ?? {};
  if (
    Object.keys(markups).length > 0 &&
    !sameMarkups(markups, defaultMarkups)
  ) {
    return null;
  }
  return unitSalePrice;
}
