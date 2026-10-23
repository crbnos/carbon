// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The MRP netting sequence of a project segment (Projects Phase 2b). A project
// segment nets its own on-hand and supply first. Then it may draw the common
// segment's TRUE surplus: on-hand stock that common demand does not need in
// that period or later. What remains is new supply in the segment.
//
// Planned and open supply never count as surplus. A Transfer moves only stock
// that exists. Pure: MRP (`explodeBom`) calls it per item and location.

/** A project segment's need, or a draw from common stock, in one period. */
export type SegmentQuantity = {
  segmentId: string;
  periodIndex: number;
  quantity: number;
};

/**
 * For each period index t, the common on-hand that common demand does not
 * need in t or later: min over k ≥ t of (onHand − Σ demand[0..k]), floored at
 * 0. `demandByPeriod` is the common segment's gross demand, in period order.
 */
export function trueSurplusByPeriod(
  onHand: number,
  demandByPeriod: readonly number[]
): number[] {
  const balances: number[] = [];
  let balance = onHand;
  for (const demand of demandByPeriod) {
    balance -= demand;
    balances.push(balance);
  }
  const surplus = new Array<number>(balances.length);
  let lowest = Number.POSITIVE_INFINITY;
  for (let t = balances.length - 1; t >= 0; t--) {
    lowest = Math.min(lowest, balances[t]!);
    surplus[t] = Math.max(0, lowest);
  }
  return surplus;
}

/**
 * Gives project needs the common surplus, earliest period first, then by
 * segment id. A need takes min(need, surplus at its period). The draw leaves
 * common stock from its period on, so every later period's surplus falls by
 * the draw, and an earlier period keeps at most what the draw period has
 * left. Later needs therefore see less.
 */
export function allocateCommonSurplus({
  surplusByPeriod,
  needs
}: {
  surplusByPeriod: readonly number[];
  needs: readonly SegmentQuantity[];
}): { draws: SegmentQuantity[]; remaining: SegmentQuantity[] } {
  const surplus = [...surplusByPeriod];
  const ordered = [...needs].sort(
    (a, b) =>
      a.periodIndex - b.periodIndex ||
      (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : 0)
  );

  const draws: SegmentQuantity[] = [];
  const remaining: SegmentQuantity[] = [];
  for (const need of ordered) {
    const available = Math.max(0, surplus[need.periodIndex] ?? 0);
    const take = Math.min(Math.max(0, need.quantity), available);
    if (take > 0) {
      draws.push({ ...need, quantity: take });
      const left = available - take;
      for (let t = 0; t < surplus.length; t++) {
        surplus[t] =
          t >= need.periodIndex
            ? Math.max(0, surplus[t]! - take)
            : Math.min(surplus[t]!, left);
      }
    }
    if (need.quantity - take > 0) {
      remaining.push({ ...need, quantity: need.quantity - take });
    }
  }
  return { draws, remaining };
}
