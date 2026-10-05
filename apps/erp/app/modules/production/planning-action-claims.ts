// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql, type Transaction } from "kysely";

// The claim half of a set-based Apply, shared by the purchasing and the
// production apply (purchasing.service.ts / production.service.ts). Both run
// inside the caller's transaction, so a claim, its write and its release
// commit together or not at all.

type Handle = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

/**
 * Flip every Open action of the batch to Actioned and return the ids that
 * flipped. One that does not flip was applied by someone else since the page
 * loaded, and the caller leaves its target alone — a stale page never
 * overwrites a later manual edit. The conditional update is the lock.
 */
export async function claimPlanningActions(
  trx: Handle,
  args: { ids: string[]; companyId: string; userId: string; now: string }
): Promise<Set<string>> {
  if (args.ids.length === 0) return new Set();
  const rows = await trx
    .updateTable("planningAction")
    .set({ status: "Actioned", updatedBy: args.userId, updatedAt: args.now })
    .where("id", "in", args.ids)
    .where("companyId", "=", args.companyId)
    .where("status", "=", "Open")
    .returning("id")
    .execute();
  return new Set(rows.map((row) => row.id));
}

/**
 * Give claimed actions back: to Open, so the planner can try again — or
 * deleted, when an MRP run has meanwhile written a fresh Open row for the same
 * need (the reopen would hit the natural-key unique index; that fresh row
 * replaces this one). The same two steps `releasePlanningActionClaim` takes
 * outside a transaction.
 */
export async function releasePlanningActionClaims(
  trx: Handle,
  args: { ids: string[]; companyId: string; userId: string; now: string }
): Promise<void> {
  if (args.ids.length === 0) return;
  const reopened = await sql<{ id: string }>`
    UPDATE "planningAction" AS a
    SET "status" = 'Open', "updatedBy" = ${args.userId}, "updatedAt" = ${args.now}
    WHERE a."id" IN (${sql.join(args.ids.map((id) => sql`${id}`))})
      AND a."companyId" = ${args.companyId}
      AND a."status" = 'Actioned'
      AND NOT EXISTS (
        SELECT 1 FROM "planningAction" o
        WHERE o."companyId" = a."companyId"
          AND o."itemId" = a."itemId"
          AND o."locationId" = a."locationId"
          AND o."type" = a."type"
          AND COALESCE(o."purchaseOrderLineId", o."jobId", o."periodId")
            = COALESCE(a."purchaseOrderLineId", a."jobId", a."periodId")
          AND o."status" <> 'Actioned'
          AND o."id" <> a."id"
      )
    RETURNING a."id"
  `.execute(trx);
  const reopenedIds = new Set(reopened.rows.map((row) => row.id));
  const toDelete = args.ids.filter((id) => !reopenedIds.has(id));
  if (toDelete.length > 0) {
    await trx
      .deleteFrom("planningAction")
      .where("id", "in", toDelete)
      .where("companyId", "=", args.companyId)
      .where("status", "=", "Actioned")
      .execute();
  }
}
