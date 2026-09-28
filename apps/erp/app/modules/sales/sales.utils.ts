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

/**
 * The quote columns Finalize writes after refreshing the share link. Only a
 * refresh that issued a NEW link (the quote had none, or the id changed) links
 * it and stamps `completedDate`; refreshing the quote's existing link writes
 * nothing, so `completedDate` keeps its value. Every quote created in the app
 * or converted from an RFQ already has a link, so for those Finalize leaves
 * `completedDate` as it was.
 */
export function finalizeShareLinkUpdate(
  currentLinkId: string | null,
  refreshedLinkId: string | null | undefined,
  now: string
): { externalLinkId: string; completedDate: string } | null {
  if (!refreshedLinkId || refreshedLinkId === currentLinkId) return null;
  return { externalLinkId: refreshedLinkId, completedDate: now };
}

export type ConvertedLinePricer =
  | "Make to Order"
  | "Pull from Inventory"
  | "Purchase to Order";

/**
 * Which pricer seeds each line of a quote just converted from an RFQ, and for
 * which quantities. A line with no quantity array is priced for one unit; an
 * empty array, or a method type with no pricer, is skipped.
 */
export function planConvertedLinePricing(
  lines: {
    id: string;
    methodType: string | null;
    quantity: number[] | null;
  }[]
): { lineId: string; pricer: ConvertedLinePricer; quantities: number[] }[] {
  const pricers: readonly string[] = [
    "Make to Order",
    "Pull from Inventory",
    "Purchase to Order"
  ];
  return lines.flatMap((line) => {
    const quantities = line.quantity ?? [1];
    if (quantities.length === 0) return [];
    if (!line.methodType || !pricers.includes(line.methodType)) return [];
    return [
      {
        lineId: line.id,
        pricer: line.methodType as ConvertedLinePricer,
        quantities
      }
    ];
  });
}
