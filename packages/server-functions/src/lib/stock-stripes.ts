// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Project stock (Projects Phase 2a) is valuated striping: every itemLedger and
// costLedger row carries a `projectId`, where null is common stock. A demand
// may draw a set of stripes, in order:
//   - project demand (a job or a plan line of a project with project stock)
//     draws that project's stock, then common stock;
//   - every other demand draws common stock only.
// Another project's stock needs a Transfer or a Borrow first.

import type { KyselyDatabase as DB } from "@carbon/database/client";
import type { ExpressionBuilder, Kysely, Transaction } from "kysely";

/** A stock stripe: a project id, or null for common stock. */
export type StockStripe = string | null;

/** The stripes a demand may draw, in draw order. */
export function stripesForDemand({
  projectId,
  projectStock
}: {
  projectId?: string | null;
  projectStock?: boolean | null;
}): StockStripe[] {
  return projectId && projectStock ? [projectId, null] : [null];
}

export interface StripeQuantity {
  stripe: StockStripe;
  quantity: number;
}

/**
 * Takes `quantity` stripe by stripe, in the order of `available`, each stripe
 * up to its available quantity. `remaining` is what no stripe covered; the
 * caller decides where it goes.
 */
export function splitAcrossStripes(
  quantity: number,
  available: readonly StripeQuantity[]
): { draws: StripeQuantity[]; remaining: number } {
  const draws: StripeQuantity[] = [];
  let remaining = quantity;
  for (const { stripe, quantity: onHand } of available) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(onHand, 0));
    if (take <= 0) continue;
    draws.push({ stripe, quantity: take });
    remaining -= take;
  }
  return { draws, remaining };
}

/** '' for common stock: the key the SQL pickers and itemStockQuantities use. */
export function stripeKey(stripe: StockStripe): string {
  return stripe ?? "";
}

/** An itemLedger filter: the row's stripe is one of `stripes`. */
export function itemLedgerInStripes(
  eb: ExpressionBuilder<DB, "itemLedger">,
  stripes: readonly StockStripe[]
) {
  const projectIds = stripes.filter(
    (stripe): stripe is string => stripe !== null
  );
  const filters = [];
  if (stripes.includes(null)) filters.push(eb("projectId", "is", null));
  if (projectIds.length > 0) filters.push(eb("projectId", "in", projectIds));
  // An empty set matches nothing.
  if (filters.length === 0) return eb.val(false);
  return eb.or(filters);
}

/**
 * The stripes a project's demand may draw: the project's stock first when it
 * has project stock, then common stock. No project gives common stock only.
 */
export async function loadDemandStripes(
  db: Kysely<DB> | Transaction<DB>,
  companyId: string,
  projectId: string | null | undefined
): Promise<StockStripe[]> {
  if (!projectId) return [null];
  const project = await db
    .selectFrom("project")
    .select("projectStock")
    .where("id", "=", projectId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  return stripesForDemand({
    projectId,
    projectStock: project?.projectStock ?? false
  });
}
