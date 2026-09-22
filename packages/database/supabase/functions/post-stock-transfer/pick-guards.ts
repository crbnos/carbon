// Pure idempotency guards for stock-transfer picks. Compares at internal scale
// (round/equals from the shared precision module) so a float-residue draw never
// reads as an over-pick, and a line that is already fully picked is refused
// before any ledger row is written — a repeat scan would otherwise double-post
// the transfer. Dependency-free aside from the sibling precision module.

import { equals, EPSILON, round } from "../shared/precision.ts";

/** A guard refusal the caller turns into a 400 (never a 500). `kind` lets the
 *  edge function's outer catch distinguish it from a data-layer error. */
export class PickGuardError extends Error {
  readonly kind: "over-pick" | "already-picked";
  constructor(kind: "over-pick" | "already-picked", message: string) {
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
