// Single source of truth for the supersession swap — should a component be
// replaced by its successor — shared by the MRP engine (planning / demand) and
// the get-method edge function (job creation) so the two can never disagree.
//
// All dates are ISO "YYYY-MM-DD" strings. Lexicographic comparison is exact for
// that format and equivalent to a calendar-date compare, so no date library is
// needed (and the two callers stay byte-for-byte consistent).

import { round, RoundingMode, scrapAllowance } from "../shared/precision.ts";
import type { Database } from "./types.ts";

export type SupersessionMode =
  Database["public"]["Enums"]["supersessionMode"];

export type SupersessionRow = {
  itemId: string;
  supersessionMode: SupersessionMode;
  successorItemId: string | null;
  successorEffectivityDate: string | null;
  conversionFactor: number | string | null;
};

export type Redirect = { to: string; factor: number };

const REDIRECTING_MODES = new Set<SupersessionMode>([
  "Consume First",
  "Prefer New",
  "Stock Only",
]);

export function withoutStockedConsumeFirst(
  supersessions: SupersessionRow[],
  stockedItemIds: Set<string>
): SupersessionRow[] {
  return supersessions.filter(
    (s) =>
      !(s.supersessionMode === "Consume First" && stockedItemIds.has(s.itemId))
  );
}

// Build `oldItemId -> { successor, cumulative factor }` for every item whose
// supersession is *effective* as of `asOfDate`, collapsing multi-hop chains
// (A->B->C becomes A->C with the product of the conversion factors), cycle-safe.
//
// The caller decides what `asOfDate` means for its context:
//   - MRP demand redirect : today (is the part being phased out right now)
//   - job creation        : the job's build date (start date)
//
// This mirrors the redirectByItem construction + chain collapse in mrp/index.ts.
export function buildSupersessionRedirectMap(
  supersessions: SupersessionRow[],
  asOfDate: string
): Map<string, Redirect> {
  const byItem = new Map<string, SupersessionRow>();
  for (const s of supersessions) {
    byItem.set(s.itemId, s);
  }

  const redirect = new Map<string, Redirect>();
  for (const [oldItemId, sup] of byItem) {
    if (!sup.successorItemId) continue;
    if (!REDIRECTING_MODES.has(sup.supersessionMode)) continue;
    const effective =
      !sup.successorEffectivityDate || sup.successorEffectivityDate <= asOfDate;
    if (!effective) continue;
    redirect.set(oldItemId, {
      to: sup.successorItemId,
      factor: Number(sup.conversionFactor ?? 1) || 1,
    });
  }

  // Collapse multi-hop chains, multiplying factors along the way. Built into a
  // SECOND map rather than updating `redirect` in place: mutating it mid-walk
  // makes the result depend on which entry is visited first (a later entry reads
  // an earlier one's already-collapsed value and multiplies its factor in twice)
  // and, once cycle entries are dropped, lets a cycle member read a deleted
  // predecessor, see no successor, and pass as a clean terminal.
  const collapsed = new Map<string, Redirect>();
  for (const [oldId, start] of redirect) {
    let to = start.to;
    let factor = start.factor;
    const seen = new Set<string>([oldId]);
    while (redirect.has(to) && !seen.has(to)) {
      seen.add(to);
      const next = redirect.get(to)!;
      factor *= next.factor;
      to = next.to;
    }
    // Exiting with `to` still in the map means the walk closed a loop. A cycle
    // has no terminal successor, so there is nothing safe to point at — drop the
    // entry and leave the demand on the original part. Keeping it made the item
    // supersede ITSELF (`substitutedFromItemId` = its own id) while multiplying
    // the job's quantities by the cycle's factor product, which is invisible
    // downstream: the quantity is a plausible number and nothing can repair it.
    // Only a self-reference is blocked by the DB CHECK and the zod validator, so
    // a two-row cycle is writable straight from the UI.
    if (!redirect.has(to)) collapsed.set(oldId, { to, factor });
  }

  return collapsed;
}

export function pullBackQuantities(
  successorRow: {
    quantity: number | string | null;
    estimatedQuantity: number | string | null;
    scrapQuantity: number | string | null;
  },
  factor: number,
  predecessorScrapPercentage: number
): { quantity: number; estimatedQuantity: number; scrapQuantity: number } {
  const successorTarget =
    Number(successorRow.estimatedQuantity ?? 0) -
    Number(successorRow.scrapQuantity ?? 0);
  const targetQuantity = successorTarget * factor;
  const scrapQuantity = scrapAllowance(
    targetQuantity,
    predecessorScrapPercentage
  );
  return {
    quantity: Number(successorRow.quantity ?? 0) * factor,
    estimatedQuantity: targetQuantity + scrapQuantity,
    scrapQuantity,
  };
}

export function consumableInWholeAssemblies(
  onHand: number,
  perAssembly: number
): number {
  const stock = Math.max(0, Number(onHand) || 0);
  const per = Number(perAssembly) || 0;
  if (per <= 0) return stock;
  const assemblies = round(round(stock / per), 0, RoundingMode.Down);
  return round(assemblies * per);
}

export function keepsLineOnPredecessor(
  onHand: number | null | undefined,
  perAssembly: number | string | null | undefined
): boolean {
  return (
    consumableInWholeAssemblies(Number(onHand) || 0, Number(perAssembly) || 0) >
    0
  );
}

export type ConsumeFirstRule = { itemId: string; factor: number };

export type ConsumeFirstRules = {
  successorByPredecessor: Map<string, ConsumeFirstRule>;
  predecessorsBySuccessor: Map<string, ConsumeFirstRule[]>;
};

export function buildConsumeFirstRules(
  rows: {
    itemId: string;
    successorItemId: string | null;
    successorEffectivityDate: string | null;
    conversionFactor: number | string | null;
  }[],
  asOfDate: string
): ConsumeFirstRules {
  const successorByPredecessor = new Map<string, ConsumeFirstRule>();
  const predecessorsBySuccessor = new Map<string, ConsumeFirstRule[]>();
  for (const r of rows) {
    if (!r.successorItemId) continue;
    if (r.successorEffectivityDate && r.successorEffectivityDate > asOfDate) {
      continue;
    }
    const factor = Number(r.conversionFactor ?? 1) || 1;
    successorByPredecessor.set(r.itemId, { itemId: r.successorItemId, factor });
    predecessorsBySuccessor.set(r.successorItemId, [
      ...(predecessorsBySuccessor.get(r.successorItemId) ?? []),
      { itemId: r.itemId, factor },
    ]);
  }
  return { successorByPredecessor, predecessorsBySuccessor };
}

export type ConsumeFirstSettlement = {
  kind: "revert" | "pullBack" | "push";
  toItemId: string;
  factor: number;
};

export function consumeFirstSwappedFrom(
  line: { itemId: string; substitutedFromItemId: string | null },
  rules: ConsumeFirstRules
): ConsumeFirstRule | null {
  const from = line.substitutedFromItemId;
  if (!from) return null;
  const rule = rules.successorByPredecessor.get(from);
  return rule && rule.itemId === line.itemId
    ? { itemId: from, factor: rule.factor }
    : null;
}

export function consumeFirstStockItems(
  line: { itemId: string; substitutedFromItemId: string | null },
  rules: ConsumeFirstRules
): string[] {
  const ids = new Set<string>();
  if (rules.successorByPredecessor.has(line.itemId)) ids.add(line.itemId);
  for (const p of rules.predecessorsBySuccessor.get(line.itemId) ?? []) {
    ids.add(p.itemId);
  }
  const from = consumeFirstSwappedFrom(line, rules);
  if (from) ids.add(from.itemId);
  return [...ids];
}

export function settleConsumeFirstLine(
  line: {
    itemId: string;
    quantity: number | string | null;
    substitutedFromItemId: string | null;
  },
  rules: ConsumeFirstRules,
  onHandByItem: Map<string, number>
): ConsumeFirstSettlement | null {
  const perAssembly = Number(line.quantity ?? 0);
  const onHand = (id: string) => onHandByItem.get(id) ?? 0;

  const from = consumeFirstSwappedFrom(line, rules);
  if (from && keepsLineOnPredecessor(onHand(from.itemId), perAssembly / from.factor)) {
    return { kind: "revert", toItemId: from.itemId, factor: 1 / from.factor };
  }

  const predecessor = (rules.predecessorsBySuccessor.get(line.itemId) ?? []).find(
    (p) => keepsLineOnPredecessor(onHand(p.itemId), perAssembly / p.factor)
  );
  if (predecessor) {
    return {
      kind: "pullBack",
      toItemId: predecessor.itemId,
      factor: 1 / predecessor.factor,
    };
  }

  const successor = rules.successorByPredecessor.get(line.itemId);
  if (successor && !keepsLineOnPredecessor(onHand(line.itemId), perAssembly)) {
    return { kind: "push", toItemId: successor.itemId, factor: successor.factor };
  }
  return null;
}

export function buildConsumeFirstHops(
  supersessions: SupersessionRow[],
  asOfDate: string
): Map<string, Redirect> {
  const byItem = new Map<string, SupersessionRow>();
  for (const s of supersessions) byItem.set(s.itemId, s);
  const effective = (s: SupersessionRow | undefined) =>
    !!s &&
    !!s.successorItemId &&
    REDIRECTING_MODES.has(s.supersessionMode) &&
    (!s.successorEffectivityDate || s.successorEffectivityDate <= asOfDate);

  const chainTerminates = (oldId: string): boolean => {
    const walked = new Set<string>([oldId]);
    let current = byItem.get(oldId)!.successorItemId!;
    while (effective(byItem.get(current))) {
      if (walked.has(current)) return false;
      walked.add(current);
      current = byItem.get(current)!.successorItemId!;
    }
    return true;
  };

  const hops = new Map<string, Redirect>();
  for (const [oldId, start] of byItem) {
    if (start.supersessionMode !== "Consume First" || !effective(start)) {
      continue;
    }
    if (!chainTerminates(oldId)) continue;
    let to = start.successorItemId!;
    let factor = Number(start.conversionFactor ?? 1) || 1;
    const seen = new Set<string>([oldId]);
    let next = byItem.get(to);
    while (
      effective(next) &&
      next!.supersessionMode !== "Consume First" &&
      !seen.has(to)
    ) {
      seen.add(to);
      factor *= Number(next!.conversionFactor ?? 1) || 1;
      to = next!.successorItemId!;
      next = byItem.get(to);
    }
    hops.set(oldId, { to, factor });
  }
  return hops;
}

export function firstStockedInConsumeFirstChain(
  itemId: string,
  perAssembly: number,
  hops: Map<string, Redirect>,
  onHandByItem: Map<string, number>
): { itemId: string; factor: number } | null {
  let current = itemId;
  let factor = 1;
  const seen = new Set<string>();
  while (hops.has(current) && !seen.has(current)) {
    seen.add(current);
    if (
      onHandByItem.has(current) &&
      keepsLineOnPredecessor(onHandByItem.get(current), perAssembly * factor)
    ) {
      return { itemId: current, factor };
    }
    const hop = hops.get(current)!;
    factor *= hop.factor;
    current = hop.to;
  }
  return null;
}

export type SupersessionContext = {
  redirect: Map<string, Redirect>;
  consumeFirstOnHand: Map<string, number>;
  consumeFirstHops: Map<string, Redirect>;
  boughtSuccessors: Set<string>;
};

export function resolveMadeLinePull(
  itemId: string,
  perAssembly: number,
  ctx: SupersessionContext
): { itemId: string; factor: number } | null {
  const stocked = firstStockedInConsumeFirstChain(
    itemId,
    perAssembly,
    ctx.consumeFirstHops,
    ctx.consumeFirstOnHand
  );
  if (stocked) return stocked;
  const redirect = ctx.redirect.get(itemId);
  if (redirect && ctx.boughtSuccessors.has(redirect.to)) {
    return { itemId: redirect.to, factor: redirect.factor };
  }
  return null;
}

export function reserveConsumeFirstStock(
  line: {
    itemId: string;
    quantity: number | string | null;
    estimatedQuantity: number | string | null;
    scrapQuantity: number | string | null;
  },
  settlement: ConsumeFirstSettlement | null,
  rules: ConsumeFirstRules,
  onHandByItem: Map<string, number>
): void {
  const target = Math.max(
    0,
    Number(line.estimatedQuantity ?? 0) - Number(line.scrapQuantity ?? 0)
  );
  let itemId = line.itemId;
  let factor = 1;
  if (settlement) {
    if (settlement.kind === "push") return;
    itemId = settlement.toItemId;
    factor = settlement.factor;
  } else if (!rules.successorByPredecessor.has(line.itemId)) {
    return;
  }
  if (!onHandByItem.has(itemId)) return;
  const perAssembly = Number(line.quantity ?? 0) * factor;
  const reserved = Math.min(
    target * factor,
    consumableInWholeAssemblies(onHandByItem.get(itemId) ?? 0, perAssembly)
  );
  onHandByItem.set(itemId, Math.max(0, (onHandByItem.get(itemId) ?? 0) - reserved));
}
