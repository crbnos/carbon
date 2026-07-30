// Pure planning core for posting an inventory count, extracted so the delta math
// can be unit-tested without a database.
//
// Reconciliation model: post the variance the counter reviewed against the
// FROZEN snapshot — `delta = counted - systemQuantity` — NOT against live on-hand.
// This preserves any stock movements that posted between the snapshot and the
// post (a receipt/shipment isn't clobbered; the count's correction is applied on
// top of it). A line whose delta is 0 is still returned; the caller skips writing
// it.

export type PlannableLine = {
  id: string;
  itemId: string;
  systemQuantity: number | string | null;
  // Callers pass only counted lines; null is tolerated for the row type and
  // coerces to 0 (delta = −systemQuantity), never actually reached.
  countedQuantity: number | string | null;
};

export type PlanResult<L extends PlannableLine> = {
  planned: { line: L; delta: number }[];
};

export function planInventoryCountPost<L extends PlannableLine>(
  lines: L[]
): PlanResult<L> {
  const planned = lines.map((line) => ({
    line,
    delta: Number(line.countedQuantity) - Number(line.systemQuantity)
  }));
  return { planned };
}
