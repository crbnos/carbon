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

// The stored JSONB, keeping only well-formed entries. A plain guard rather
// than the zod validator: this file stays free of the models import graph.
function parseConfigurationPrices(
  value: unknown
): PricingRuleConfigurationPrice[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (price): price is PricingRuleConfigurationPrice =>
      typeof price === "object" &&
      price !== null &&
      typeof price.key === "string" &&
      (price.value === null || typeof price.value === "string") &&
      typeof price.amount === "number" &&
      Number.isFinite(price.amount)
  );
}

const configurationRules = (rules: MatchedRule[]) =>
  rules.filter((rule) => rule.ruleType === "Configuration");

// Whether any matched rule prices a parameter of this configuration — the
// caller only needs parameter labels for the trace when one does.
export function hasConfigurationSurcharge(
  matchedRules: MatchedRule[],
  configuration: Record<string, unknown> | null | undefined
) {
  if (!configuration) return false;
  return configurationRules(matchedRules).some((rule) =>
    parseConfigurationPrices(rule.configurationPrices).some(
      (price) => configurationSurcharge(price, configuration) !== 0
    )
  );
}

export function applyPriceRules(
  startingPrice: number,
  matchedRules: MatchedRule[],
  configuration?: Record<string, unknown> | null,
  // configurationParameter key → label, for a readable trace
  parameterLabels?: Record<string, string>
): { finalPrice: number; appendedTrace: PriceTraceStep[] } {
  const appendedTrace: PriceTraceStep[] = [];
  let finalPrice = startingPrice;

  // Configuration surcharges: signed amounts added to the starting price
  // before any discount or markup, stacking across every matched
  // Configuration rule.
  if (configuration) {
    const byPriority = configurationRules(matchedRules).sort(
      (a, b) => b.priority - a.priority
    );
    for (const rule of byPriority) {
      for (const price of parseConfigurationPrices(rule.configurationPrices)) {
        const adjustment = configurationSurcharge(price, configuration);
        if (adjustment === 0) continue;
        finalPrice = finalPrice + adjustment;
        const label = parameterLabels?.[price.key] ?? price.key;
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

  const markupRules = matchedRules.filter((r) => r.ruleType === "Markup");
  const discountRules = matchedRules.filter((r) => r.ruleType === "Discount");

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
    // A rule that only carries configuration prices has a zero markup.
    if (adjustment === 0) continue;
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
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
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

function asConfiguration(value: unknown): Configuration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.keys(value).length > 0 ? (value as Configuration) : null;
}
