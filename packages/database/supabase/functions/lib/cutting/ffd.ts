/**
 * 1D cutting-stock optimizer (linear nesting / "multing").
 *
 * Best-fit-decreasing over individual stock records, with the physical
 * allowances every real saw needs: kerf between pieces, end trim, and the
 * grip margin the clamp/pusher holds.
 *
 * Pure and deterministic — same inputs always produce the same patterns.
 * No clock, no randomness, no I/O. Keep it that way: the edge function
 * re-runs this whenever a planner edits a cut list.
 *
 * Kerf model: n pieces from one stock unit consume (n - 1) kerfs — the blade
 * passes *between* pieces. The severing cut that frees the last piece from the
 * remnant is charged to the remnant side, so a bar that is cut to exhaustion
 * is not penalized twice. This matches the pieces-per-stock formula used in
 * quoting: floor((usable + kerf) / (piece + kerf)).
 */

export type CutDemand = {
  /** cutListLine id this piece belongs to */
  lineId: string;
  /** length of one piece, in the cut list's unitOfDimension */
  length: number;
  /** how many pieces of this length are needed */
  quantity: number;
};

export type StockUnit = {
  /** the size-item id (itemStockDimension.itemId) */
  stockId: string;
  /** lot/tag id when the material is batch tracked; absent for untracked stock */
  trackedEntityId?: string;
  /** physical length of this bar/tube/remnant */
  length: number;
  /** remnants are consumed before full stock */
  isRemnant: boolean;
};

export type CutParameters = {
  /** material destroyed by each blade pass */
  kerf: number;
  /** unusable material trimmed off the end of a new stock unit */
  endTrim: number;
  /** length the clamp or pusher holds and cannot cut */
  gripMargin: number;
  /** leftover at or above this length returns to stock; below it is scrap */
  minRemnantLength: number;
};

export type PlacedCut = {
  lineId: string;
  length: number;
};

export type CutPatternResult = {
  stockId: string;
  trackedEntityId?: string;
  /** 1-based order the operator works the patterns in */
  sequence: number;
  /** pieces in cut order (longest first, as placed) */
  cuts: PlacedCut[];
  /** stock length physically committed to this pattern */
  stockLength: number;
  /** sum of the piece lengths on this pattern */
  piecesLength: number;
  /** usable leftover returning to stock; 0 when below minRemnantLength */
  expectedRemnant: number;
  /** everything not a piece and not a returnable remnant */
  waste: number;
};

export type UnplacedDemand = {
  lineId: string;
  length: number;
  quantity: number;
  reason: "no-stock-long-enough" | "stock-exhausted";
};

export type OptimizeResult = {
  patterns: CutPatternResult[];
  unplaced: UnplacedDemand[];
  /**
   * Percentage of consumed material that became parts.
   * consumed = committed stock length - returnable remnants.
   * 0 when nothing was placed.
   */
  yieldPct: number;
};

type OpenStock = {
  unit: StockUnit;
  /** capacity left after trim, grip, pieces already placed and their kerfs */
  remaining: number;
  cuts: PlacedCut[];
};

/** Length actually available to cut on a fresh stock unit. */
export function usableLength(unit: StockUnit, params: CutParameters): number {
  return unit.length - params.endTrim - params.gripMargin;
}

/**
 * How many pieces of `pieceLength` fit in one stock unit.
 * Exported for quoting, which needs the count without running a full plan.
 */
export function piecesPerStock(
  stockLength: number,
  pieceLength: number,
  params: CutParameters
): number {
  const usable = stockLength - params.endTrim - params.gripMargin;
  if (pieceLength <= 0 || usable < pieceLength) return 0;
  return Math.floor((usable + params.kerf) / (pieceLength + params.kerf));
}

/** Cost of adding one more piece to a stock unit that already holds `placed` pieces. */
function costOfNextPiece(
  pieceLength: number,
  placedCount: number,
  params: CutParameters
): number {
  return placedCount === 0 ? pieceLength : params.kerf + pieceLength;
}

export function optimizeCuts1D(
  demands: CutDemand[],
  stock: StockUnit[],
  params: CutParameters
): OptimizeResult {
  // Expand quantities into individual pieces, longest first. Ties break on
  // lineId so the result never depends on input ordering.
  const pieces: { lineId: string; length: number }[] = [];
  for (const demand of demands) {
    for (let i = 0; i < demand.quantity; i++) {
      pieces.push({ lineId: demand.lineId, length: demand.length });
    }
  }
  pieces.sort((a, b) =>
    b.length !== a.length ? b.length - a.length : a.lineId.localeCompare(b.lineId)
  );

  // Remnants before full stock; shortest first within each group so the rack
  // clears from the least useful end. Ties break on id for determinism.
  const available = [...stock].sort((a, b) => {
    if (a.isRemnant !== b.isRemnant) return a.isRemnant ? -1 : 1;
    if (a.length !== b.length) return a.length - b.length;
    return (a.trackedEntityId ?? a.stockId).localeCompare(
      b.trackedEntityId ?? b.stockId
    );
  });

  const longestUsable = available.reduce(
    (max, unit) => Math.max(max, usableLength(unit, params)),
    0
  );

  const open: OpenStock[] = [];
  const unplacedCounts = new Map<string, { length: number; quantity: number; reason: UnplacedDemand["reason"] }>();

  const recordUnplaced = (
    lineId: string,
    length: number,
    reason: UnplacedDemand["reason"]
  ) => {
    const existing = unplacedCounts.get(lineId);
    if (existing) {
      existing.quantity += 1;
      // no-stock-long-enough is the more informative diagnosis; keep it.
      if (reason === "no-stock-long-enough") existing.reason = reason;
    } else {
      unplacedCounts.set(lineId, { length, quantity: 1, reason });
    }
  };

  for (const piece of pieces) {
    // A piece longer than any stock unit can never be cut — say so plainly
    // rather than silently dropping it.
    if (piece.length > longestUsable) {
      recordUnplaced(piece.lineId, piece.length, "no-stock-long-enough");
      continue;
    }

    // Best fit among already-open stock: the tightest remaining capacity that
    // still holds the piece. Fewer bars opened, less waste stranded.
    let best: OpenStock | undefined;
    let bestLeftover = Number.POSITIVE_INFINITY;
    for (const candidate of open) {
      const cost = costOfNextPiece(piece.length, candidate.cuts.length, params);
      const leftover = candidate.remaining - cost;
      if (leftover >= 0 && leftover < bestLeftover) {
        best = candidate;
        bestLeftover = leftover;
      }
    }

    if (best) {
      best.remaining -= costOfNextPiece(piece.length, best.cuts.length, params);
      best.cuts.push({ lineId: piece.lineId, length: piece.length });
      continue;
    }

    // Nothing open fits — commit a new stock unit. `available` is already in
    // remnant-first, shortest-first order, so the first unit that holds the
    // piece is the right one to burn.
    const index = available.findIndex(
      (unit) => usableLength(unit, params) >= piece.length
    );
    if (index === -1) {
      recordUnplaced(piece.lineId, piece.length, "stock-exhausted");
      continue;
    }

    const [unit] = available.splice(index, 1);
    open.push({
      unit,
      remaining: usableLength(unit, params) - piece.length,
      cuts: [{ lineId: piece.lineId, length: piece.length }],
    });
  }

  const patterns: CutPatternResult[] = open.map((entry, i) => {
    const piecesLength = entry.cuts.reduce((sum, cut) => sum + cut.length, 0);
    const leftover = entry.remaining;
    // A zero-length leftover is not a drop, and anything under the threshold
    // is waste rather than something worth racking.
    const expectedRemnant =
      leftover > 0 && leftover >= params.minRemnantLength ? leftover : 0;

    return {
      stockId: entry.unit.stockId,
      trackedEntityId: entry.unit.trackedEntityId,
      sequence: i + 1,
      cuts: entry.cuts,
      stockLength: entry.unit.length,
      piecesLength,
      expectedRemnant,
      waste: entry.unit.length - piecesLength - expectedRemnant,
    };
  });

  const totalPieces = patterns.reduce((sum, p) => sum + p.piecesLength, 0);
  const totalConsumed = patterns.reduce(
    (sum, p) => sum + p.stockLength - p.expectedRemnant,
    0
  );

  return {
    patterns,
    unplaced: [...unplacedCounts.entries()].map(([lineId, entry]) => ({
      lineId,
      length: entry.length,
      quantity: entry.quantity,
      reason: entry.reason,
    })),
    yieldPct: totalConsumed > 0 ? (totalPieces / totalConsumed) * 100 : 0,
  };
}
