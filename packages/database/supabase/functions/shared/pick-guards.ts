// Pure idempotency guards for a pick against a document line — shared by
// post-stock-transfer and post-picking, so both accumulate the same way.
// Compares at internal scale
// (round/equals from the shared precision module) so a float-residue draw never
// reads as an over-pick, and a line that is already fully picked is refused
// before any ledger row is written — a repeat scan would otherwise double-post
// the transfer. Dependency-free aside from the sibling precision module.

import { equals, EPSILON, round } from "./precision.ts";

export type PickGuardKind = "over-pick" | "already-picked" | "empty-pick";

/** A guard refusal the caller turns into a 400 (never a 500). `kind` lets the
 *  edge function's outer catch distinguish it from a data-layer error. */
export class PickGuardError extends Error {
  readonly kind: PickGuardKind;
  constructor(kind: PickGuardKind, message: string) {
    super(message);
    this.name = "PickGuardError";
    this.kind = kind;
  }
}

/**
 * Resolve a pick against the line's running total. Returns the NEW accumulated
 * `pickedQuantity` (never a replacement), or throws a typed `PickGuardError`:
 *   - "already-picked" — the line has no outstanding quantity left.
 *   - "over-pick"      — this pick exceeds what is still outstanding.
 *   - "empty-pick"     — the pick rounds to nothing at internal scale.
 * A serial pick (transferQuantity 1) is the same rule: it is refused once
 * pickedQuantity has reached the line quantity.
 */
export function resolvePick(input: {
  lineQuantity: number;
  pickedQuantity: number;
  transferQuantity: number;
}): number {
  const line = round(input.lineQuantity);
  const already = round(input.pickedQuantity);
  const pick = round(input.transferQuantity);
  const outstanding = round(line - already);

  // A quantity below half a minor unit rounds to 0: accumulating it would
  // write a "Picked" status and a zero ledger pair for nothing. Refuse it
  // here rather than let the split builder throw its `draw > 0` guard as a 500.
  if (pick <= 0) {
    throw new PickGuardError(
      "empty-pick",
      `Pick of ${input.transferQuantity} rounds to zero — nothing to pick`
    );
  }
  if (equals(outstanding, 0) || outstanding < 0) {
    throw new PickGuardError(
      "already-picked",
      "This line is already fully picked"
    );
  }
  // An equal-at-scale pick of the whole remainder is allowed; only a pick that
  // exceeds it beyond float noise is an over-pick.
  if (!equals(pick, outstanding) && pick - outstanding > EPSILON) {
    throw new PickGuardError(
      "over-pick",
      `Pick of ${pick} exceeds outstanding ${outstanding}`
    );
  }
  return round(already + pick);
}

/** Guard a batch pick against the SOURCE entity's on-hand: a transfer may never
 *  draw more than the entity holds. Equal-at-scale is fine (a full draw). */
export function assertEntityCoversPick(input: {
  entityQuantity: number;
  transferQuantity: number;
}): void {
  const entity = round(input.entityQuantity);
  const pick = round(input.transferQuantity);
  if (!equals(pick, entity) && pick - entity > EPSILON) {
    throw new PickGuardError(
      "over-pick",
      `Pick of ${pick} exceeds the ${entity} on hand for this lot`
    );
  }
}
