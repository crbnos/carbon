// Picking-side supersession resolution: given a job material's item and its
// supersession config, decide which item a pick should actually target.
//
// This is intentionally SEPARATE from the MRP / job-creation redirect map
// (packages/database/supabase/functions/lib/supersession-pick.ts), which only
// redirects `Consume First` / `Prefer New`. Picking has different rules: a
// `Stock Only` predecessor is reserved for service and must NOT be picked for
// production, so its effective successor is used instead; a `No Stock`
// predecessor is obsolete and is skipped entirely. The SQL in
// `get_picking_schedule` mirrors this exactly.
//
// Dates are ISO "YYYY-MM-DD" strings; lexicographic comparison is exact for that
// format (same convention as the shared redirect map).

export type PickSupersession = {
  supersessionMode: string;
  successorItemId: string | null;
  successorEffectivityDate: string | null;
  conversionFactor: number | string | null;
};

export type PickTarget =
  | { kind: "pick"; itemId: string; factor: number }
  | { kind: "skip" };

/**
 * The successor item id when it is effective as of `asOfDate`, else null.
 * A null effectivity date means "effective immediately".
 */
export function effectiveSuccessorId(
  ss: PickSupersession,
  asOfDate: string
): string | null {
  if (!ss.successorItemId) return null;
  if (ss.successorEffectivityDate && ss.successorEffectivityDate > asOfDate) {
    return null;
  }
  return ss.successorItemId;
}

function toFactor(value: number | string | null): number {
  const n = Number(value ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Resolve the item a pick should target for a job material.
 *
 * - No supersession → pick the material's own item.
 * - `No Stock` → skip (obsolete, no successor).
 * - `Stock Only` → pick the effective successor (never the spares-only
 *   predecessor); skip when there is no effective successor.
 * - `Prefer New` → pick the effective successor; fall back to the predecessor
 *   until the successor is effective.
 * - `Consume First` → pick the predecessor; redirect to the successor ONLY when
 *   the predecessor has no warehouse stock and an effective successor with stock
 *   exists (never leaves predecessor stock unused, and satisfies
 *   "predecessor out of stock → pick successor").
 *
 * When redirecting to a successor, `factor` is the conversion factor
 * (1 old = N new); otherwise 1.
 */
export function resolvePickTarget(args: {
  itemId: string;
  supersession: PickSupersession | undefined;
  /** predecessor has a resolvable warehouse source (non-lineside on-hand). */
  predecessorInStock: boolean;
  /** successor has a resolvable warehouse source (non-lineside on-hand). */
  successorInStock: boolean;
  asOfDate: string;
}): PickTarget {
  const { itemId, supersession: ss } = args;
  if (!ss) return { kind: "pick", itemId, factor: 1 };

  const successor = effectiveSuccessorId(ss, args.asOfDate);
  const factor = toFactor(ss.conversionFactor);

  switch (ss.supersessionMode) {
    case "No Stock":
      return { kind: "skip" };
    case "Stock Only":
      return successor
        ? { kind: "pick", itemId: successor, factor }
        : { kind: "skip" };
    case "Prefer New":
      return successor
        ? { kind: "pick", itemId: successor, factor }
        : { kind: "pick", itemId, factor: 1 };
    case "Consume First":
      if (successor && !args.predecessorInStock && args.successorInStock) {
        return { kind: "pick", itemId: successor, factor };
      }
      return { kind: "pick", itemId, factor: 1 };
    default:
      return { kind: "pick", itemId, factor: 1 };
  }
}
