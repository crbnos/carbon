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
