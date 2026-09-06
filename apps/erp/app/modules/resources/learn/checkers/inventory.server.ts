/**
 * Carbon Learn — Inventory challenge checkers.
 *
 * Server-only: never import this from the module barrel. Each checker returns
 * the FIRST unmet requirement in the order the curriculum lists it, so the
 * learner is told the next thing to do rather than everything at once.
 */

import type { LearnCheckResult } from "../types";
import type { CheckerContext } from "./shared.server";
import { fail } from "./shared.server";

/**
 * An adjustment is not a document in Carbon — posting one writes an
 * `itemLedger` entry, and the entry type is how you tell an adjustment from a
 * receipt or a consumption. The trailing period in the enum values is real.
 */
const ADJUSTMENT_ENTRY_TYPES = new Set(["Positive Adjmt.", "Negative Adjmt."]);

/** A transfer that has left Draft. `Completed` counts — they kept going. */
const MOVING_TRANSFER_STATUSES = new Set([
  "Released",
  "In Progress",
  "Completed"
]);

/**
 * `inventory-adjust-quantity` — requirement: `adjustment-posted`.
 */
export async function checkAdjustQuantity({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const entries = await reader.itemLedgerEntriesCreatedBy(scope);
  const adjustment = entries.find((entry) =>
    ADJUSTMENT_ENTRY_TYPES.has(entry.entryType)
  );

  if (!adjustment) {
    if (entries.length > 0) {
      return fail(
        "adjustment-posted",
        `You have moved stock since starting, but as a ${entries[0].entryType || "different"} entry rather than an adjustment — post an inventory adjustment`
      );
    }
    return fail(
      "adjustment-posted",
      "No inventory adjustment posted by you since you started this challenge. Post one and check again."
    );
  }

  return {
    passed: true,
    evidence: {
      itemLedgerId: adjustment.id,
      entryType: adjustment.entryType,
      quantity: adjustment.quantity,
      itemId: adjustment.itemId
    }
  };
}

/**
 * `inventory-transfer-stock` — requirements, in curriculum order:
 * `transfer-exists`, `transfer-released`.
 */
export async function checkTransferStock({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const transfers = await reader.stockTransfersCreatedBy(scope);

  if (transfers.length === 0) {
    return fail(
      "transfer-exists",
      "No stock transfer created by you since you started this challenge. Raise one and check again."
    );
  }

  const moving = transfers.find((transfer) =>
    MOVING_TRANSFER_STATUSES.has(transfer.status)
  );
  if (!moving) {
    const newest = transfers[0];
    return fail(
      "transfer-released",
      `${newest.stockTransferId || "Your stock transfer"} is still ${newest.status || "Draft"} — release it so the stock actually moves`
    );
  }

  return {
    passed: true,
    evidence: {
      stockTransferId: moving.id,
      readableId: moving.stockTransferId,
      status: moving.status
    }
  };
}

/**
 * `inventory-count-and-post` (capstone) — requirements, in curriculum order:
 * `count-exists`, `count-has-lines`, `count-posted`.
 */
export async function checkCountAndPost({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const counts = await reader.inventoryCountsCreatedBy(scope);

  if (counts.length === 0) {
    return fail(
      "count-exists",
      "No inventory count created by you since you started this challenge. Start one and check again."
    );
  }

  const lineCounts = await reader.inventoryCountLineCount(
    scope.companyId,
    counts.map((count) => count.id)
  );

  const withLines = counts.filter((count) => (lineCounts[count.id] ?? 0) >= 1);
  if (withLines.length === 0) {
    const newest = counts[0];
    return fail(
      "count-has-lines",
      `${newest.inventoryCountId || "Your count"} has nothing on it to count — add the items you are counting`
    );
  }

  const posted = withLines.find((count) => count.status === "Posted");
  if (!posted) {
    const newest = withLines[0];
    return fail(
      "count-posted",
      `${newest.inventoryCountId || "Your count"} is still ${newest.status || "Draft"} — post it so the ledger takes the result`
    );
  }

  return {
    passed: true,
    evidence: {
      inventoryCountId: posted.id,
      readableId: posted.inventoryCountId,
      lines: lineCounts[posted.id] ?? 0
    }
  };
}
