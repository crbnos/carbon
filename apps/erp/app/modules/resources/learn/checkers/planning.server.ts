/**
 * Carbon Learn — Planning challenge checkers.
 *
 * Server-only: never import this from the module barrel. Each checker returns
 * the FIRST unmet requirement in the order the curriculum lists it, so the
 * learner is told the next thing to do rather than everything at once.
 */

import type { LearnCheckResult } from "../types";
import type { LearnItemPlanningRow } from "./reader.server";
import type { CheckerContext } from "./shared.server";
import { fail } from "./shared.server";

/**
 * An ALLOWLIST, not "anything but Manual Reorder". The reader maps a missing policy to `""`,
 * which passes an exclusion test and then falls through `missingNumbersFor`'s
 * default branch — a false pass on a certification challenge. The column is
 * NOT NULL today, so this is not reachable from real data; it is here so the
 * checker cannot be broken by a reader that is.
 */
const PLANNING_POLICIES = new Set([
  "Demand-Based Reorder",
  "Fixed Reorder Quantity",
  "Maximum Quantity"
]);

/**
 * Each policy needs different numbers, and a policy set without them plans
 * nothing — which looks identical to "MRP is broken" from the learner's side.
 * This is the check that makes the difference visible.
 */
function missingNumbersFor(row: LearnItemPlanningRow): string | null {
  const positive = (value: number | null) => value !== null && value > 0;

  switch (row.reorderingPolicy) {
    case "Demand-Based Reorder":
      return positive(row.demandAccumulationPeriod)
        ? null
        : "a demand accumulation period";
    case "Fixed Reorder Quantity":
      if (!positive(row.reorderPoint)) return "a reorder point";
      return positive(row.reorderQuantity) ? null : "a reorder quantity";
    case "Maximum Quantity":
      if (!positive(row.reorderPoint)) return "a reorder point";
      return positive(row.maximumInventoryQuantity)
        ? null
        : "a maximum inventory quantity";
    default:
      return null;
  }
}

/**
 * `planning-set-reorder-policy` — requirements, in curriculum order:
 * `policy-set`, `policy-not-manual`, `policy-has-numbers`.
 */
export async function checkSetReorderPolicy({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const rows = await reader.itemPlanningUpdatedBy(scope);

  if (rows.length === 0) {
    return fail(
      "policy-set",
      "No part's planning changed by you since you started this challenge. Open a part's Planning tab and check again."
    );
  }

  const planned = rows.filter((row) =>
    PLANNING_POLICIES.has(row.reorderingPolicy)
  );
  if (planned.length === 0) {
    return fail(
      "policy-not-manual",
      "That part is still on Manual Reorder — pick a policy that lets Carbon ask for more on its own"
    );
  }

  const complete = planned.find((row) => missingNumbersFor(row) === null);
  if (!complete) {
    const first = planned[0];
    return fail(
      "policy-has-numbers",
      `${first.reorderingPolicy} needs ${missingNumbersFor(first)} — a policy without its numbers plans nothing`
    );
  }

  return {
    passed: true,
    evidence: {
      itemId: complete.itemId,
      reorderingPolicy: complete.reorderingPolicy
    }
  };
}

/**
 * `planning-run-mrp-and-review` (capstone) — requirements, in curriculum order:
 * `policy-set`, `order-for-item`.
 *
 * The purchase order is deliberately NOT scoped to `createdBy`: MRP is what
 * raises it, so the row belongs to the run rather than to the person who
 * started it. Scoping it to the learner would fail the exact outcome the
 * challenge is asking for.
 */
export async function checkRunMrpAndReview({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const rows = await reader.itemPlanningUpdatedBy(scope);
  const planned = rows.filter(
    (row) =>
      PLANNING_POLICIES.has(row.reorderingPolicy) &&
      missingNumbersFor(row) === null
  );

  if (planned.length === 0) {
    return fail(
      "policy-set",
      "No part is set up to replenish itself yet — give one a reorder policy with the numbers it needs."
    );
  }

  const itemIds = planned.map((row) => row.itemId).filter(Boolean);
  const lines = await reader.purchaseOrderLinesForItems(scope, itemIds);

  if (lines.length === 0) {
    return fail(
      "order-for-item",
      "The part is planned but nothing has been ordered for it — run MRP and get the suggestion onto a purchase order"
    );
  }

  return {
    passed: true,
    evidence: {
      itemId: lines[0].itemId,
      purchaseOrderId: lines[0].purchaseOrderId,
      reorderingPolicy:
        planned.find((row) => row.itemId === lines[0].itemId)
          ?.reorderingPolicy ?? planned[0].reorderingPolicy
    }
  };
}
