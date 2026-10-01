// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { equals, round } from "@carbon/utils";
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
 * Mirrored in the Deno edge runtime (`functions/lib/methods.ts`), which cannot
 * import app code — keep both in sync.
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
