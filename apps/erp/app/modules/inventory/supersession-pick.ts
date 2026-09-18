import type { Database } from "@carbon/database";
import { consumableInWholeAssemblies } from "@carbon/database/supersession-pick";
// Picking-side supersession resolution: given a job material's item and its
// supersession config, decide which item a pick should actually target.
//
// This is intentionally SEPARATE from the MRP / job-creation redirect map
// `get_picking_schedule` mirrors this exactly.
//
// Dates are ISO "YYYY-MM-DD" strings; lexicographic comparison is exact for that
// format (same convention as the shared redirect map).

export type PickSupersession = {
  supersessionMode: Database["public"]["Enums"]["supersessionMode"];
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

function toFactor(value: number | string | null | undefined): number {
  const n = Number(value ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function pickSupersessionItemId(material: {
  itemId: string;
  substitutedFromItemId?: string | null;
}): string {
  return material.substitutedFromItemId ?? material.itemId;
}

export function resolvePickRule<R extends PickSupersession>(
  material: { itemId: string; substitutedFromItemId?: string | null },
  ruleByItem: Map<string, R>
): { rule: R | undefined; swappedFromItemId: string | null } {
  const ownRule = ruleByItem.get(material.itemId);
  const from = material.substitutedFromItemId ?? null;
  if (from && ownRule?.successorItemId === from) {
    return { rule: ownRule, swappedFromItemId: null };
  }
  const swappedRule = from ? ruleByItem.get(from) : undefined;
  if (swappedRule) return { rule: swappedRule, swappedFromItemId: from };
  return { rule: ownRule, swappedFromItemId: null };
}

/**
 * Resolve the item a pick should target for a job material.
 *
 * - No supersession → pick the material's own item.
 * - `No Stock` → skip (obsolete, no successor).
 * - `Stock Only` → pick the effective successor (never the spares-only
 *   predecessor); skip when there is no effective successor.
 * - `Prefer New` → pick the effective successor; fall back to the predecessor
 * - `Consume First` → pick the predecessor; redirect to the successor ONLY when
 *   the predecessor has no warehouse stock and an effective successor with stock
 *
 */
export function resolvePickTarget(args: {
  itemId: string;
  substitutedFromItemId?: string | null;
  substitutionFactor?: number | string | null;
  supersession: PickSupersession | undefined;
  /** predecessor has a resolvable warehouse source (non-lineside on-hand). */
  predecessorInStock: boolean;
  /** successor has a resolvable warehouse source (non-lineside on-hand). */
  successorInStock: boolean;
  asOfDate: string;
}): PickTarget {
  const { itemId, substitutedFromItemId, supersession: ss } = args;
  if (!ss) return { kind: "pick", itemId, factor: 1 };

  if (substitutedFromItemId) {
    const predecessor = {
      kind: "pick" as const,
      itemId: substitutedFromItemId,
      factor: 1 / toFactor(args.substitutionFactor)
    };
    const successor = { kind: "pick" as const, itemId, factor: 1 };
    switch (ss.supersessionMode) {
      case "Consume First":
        return args.predecessorInStock ? predecessor : successor;
      case "Prefer New":
        return !args.successorInStock && args.predecessorInStock
          ? predecessor
          : successor;
      default:
        return successor;
    }
  }

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
      if (successor && (args.successorInStock || !args.predecessorInStock)) {
        return { kind: "pick", itemId: successor, factor };
      }
      return { kind: "pick", itemId, factor: 1 };
    case "Consume First":
      if (successor && !args.predecessorInStock && args.successorInStock) {
        return { kind: "pick", itemId: successor, factor };
      }
      return { kind: "pick", itemId, factor: 1 };
    default:
      return { kind: "pick", itemId, factor: 1 };
  }
}

export type ConsumeFirstPick = {
  item: "predecessor" | "successor";
  quantity: number;
};

export function splitConsumeFirstPick(args: {
  needOld: number;
  perAssemblyOld: number;
  newPerOld: number;
  stagedOld: number;
  stagedNew: number;
  warehouseOld: number;
  successorInStock: boolean;
}): {
  picks: ConsumeFirstPick[];
  warehouseOldUsed: number;
  stagedOldUsed: number;
  stagedNewUsed: number;
} {
  const {
    needOld,
    perAssemblyOld,
    stagedOld,
    stagedNew,
    warehouseOld,
    successorInStock
  } = args;
  const newPerOld = args.newPerOld > 0 ? args.newPerOld : 1;
  const perAssemblyNew = perAssemblyOld * newPerOld;
  const stagedOldUsed = Math.min(
    needOld,
    consumableInWholeAssemblies(stagedOld, perAssemblyOld)
  );
  const stagedNewUsed = Math.min(
    (needOld - stagedOldUsed) * newPerOld,
    consumableInWholeAssemblies(stagedNew, perAssemblyNew)
  );
  const remaining = Math.max(
    0,
    needOld - stagedOldUsed - stagedNewUsed / newPerOld
  );
  if (remaining <= 0) {
    return { picks: [], warehouseOldUsed: 0, stagedOldUsed, stagedNewUsed };
  }

  const usable = Math.min(
    remaining,
    consumableInWholeAssemblies(warehouseOld, perAssemblyOld)
  );
  const picks: ConsumeFirstPick[] = [];
  if (usable > 0) picks.push({ item: "predecessor", quantity: usable });
  const rest = remaining - usable;
  if (rest > 0) {
    picks.push(
      usable > 0 || successorInStock
        ? { item: "successor", quantity: rest * newPerOld }
        : { item: "predecessor", quantity: rest }
    );
  }
  return { picks, warehouseOldUsed: usable, stagedOldUsed, stagedNewUsed };
}
