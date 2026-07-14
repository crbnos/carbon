export type CategoryMarkups = Record<string, number>;

/**
 * Company default markups are "enabled" only when at least one cost category
 * has a positive markup. An all-zero or empty default means the feature is
 * off, so it is treated as "no defaults" everywhere it is consumed.
 * (Markups are whole-percent, non-negative — e.g. `{ laborCost: 25 }`.)
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
 * Decide how `recalculateQuoteLinePrices` should treat one existing price row
 * when a BOM cost changes:
 *   - cost-plus  (explicit `categoryMarkups`) → reprice from those markups
 *   - fixed price (no markups but a set `unitPrice`) → preserve; never apply
 *     the default markup (the core fix)
 *   - unpriced   (no markups, no price) → reprice from the effective defaults
 *     (which is `{}` — i.e. price at cost — when defaults are disabled)
 */
export function decideRecalcPricing(
  row: { categoryMarkups: CategoryMarkups | null; unitPrice: number | null },
  effectiveDefaults: CategoryMarkups
): RecalcPricingDecision {
  const rowMarkups = row.categoryMarkups ?? {};
  if (Object.keys(rowMarkups).length > 0) {
    return { mode: "reprice", markups: rowMarkups };
  }
  if ((row.unitPrice ?? 0) > 0) {
    return { mode: "preserve" };
  }
  return { mode: "reprice", markups: effectiveDefaults };
}
