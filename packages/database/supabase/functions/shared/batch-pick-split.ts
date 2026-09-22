// Pro-rata split of one physical material pick across a batch's member
// operations, weighted by each member's REMAINING requirement so a multi-lot
// pick sequence converges on exactly the per-member BOM quantities.
//
// Canonical source (with the vitest coverage in packages/utils). Deno edge
// functions cannot import workspace packages, so @carbon/utils RE-EXPORTS this
// file (see packages/utils/src/batch-pick-split.ts) — one source of truth, no
// drift. Dependency-free pure TS aside from the sibling precision module.
// See .ai/specs/2026-09-16-batch-materials-and-output-lots.md.

import { distributeRoundingResidual, EPSILON } from "./precision.ts";

export interface PickMember {
  jobOperationId: string;
  /** This member's remaining requirement for the picked item (estimated − already consumed). */
  remaining: number;
}

export interface PickShare {
  jobOperationId: string;
  quantity: number;
}

/**
 * Split `pickedQuantity` across members pro-rata by remaining requirement.
 * Members with no remaining requirement are skipped; the returned shares are
 * rounded at internal scale and sum EXACTLY to `pickedQuantity`
 * (largest-remainder via distributeRoundingResidual — parts are never rounded
 * independently). Throws when nothing remains or the pick exceeds the total
 * remaining; callers surface the message verbatim.
 */
export function splitPickAcrossMembers(
  members: PickMember[],
  pickedQuantity: number
): PickShare[] {
  if (!Number.isFinite(pickedQuantity) || pickedQuantity <= 0) {
    throw new Error("Pick quantity must be greater than zero");
  }

  const open = members.filter((m) => m.remaining > 0);
  const totalRemaining = open.reduce((sum, m) => sum + m.remaining, 0);
  if (open.length === 0 || totalRemaining <= 0) {
    throw new Error("No member operation still requires this item");
  }
  if (pickedQuantity > totalRemaining + EPSILON) {
    throw new Error(
      `Pick of ${pickedQuantity} exceeds the batch's remaining requirement of ${totalRemaining}`
    );
  }

  const exact = open.map((m) => (pickedQuantity * m.remaining) / totalRemaining);
  const shares = distributeRoundingResidual(exact, pickedQuantity);

  return open.map((m, i) => ({
    jobOperationId: m.jobOperationId,
    quantity: shares[i] ?? 0
  }));
}
