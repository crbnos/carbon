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
import { InvalidInputError } from "../errors";

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

/**
 * `splitAcrossStripes`, with what no stripe covers drawn from the LAST stripe
 * (common stock for every demand set). A posting that may drive stock
 * negative uses it, as the single unstriped row did before.
 */
export function drawFromStripes(
  quantity: number,
  available: readonly StripeQuantity[]
): StripeQuantity[] {
  const { draws, remaining } = splitAcrossStripes(quantity, available);
  const last = available[available.length - 1];
  if (remaining > 0 && last) {
    const existing = draws.find((draw) => draw.stripe === last.stripe);
    if (existing) existing.quantity += remaining;
    else draws.push({ stripe: last.stripe, quantity: remaining });
  }
  return draws;
}

/**
 * The stripe that holds a tracked entity: the stripe of its rows with the
 * most net on-hand. Null (common stock) when none holds a positive quantity.
 */
export function trackedEntityStripe(
  rows: readonly {
    trackedEntityId: string | null;
    projectId?: string | null;
    quantity: number | string | null;
  }[],
  trackedEntityId: string
): StockStripe {
  const net = new Map<string, number>();
  for (const row of rows) {
    if (row.trackedEntityId !== trackedEntityId) continue;
    const key = row.projectId ?? "";
    net.set(key, (net.get(key) ?? 0) + Number(row.quantity ?? 0));
  }
  let best: { key: string; quantity: number } | null = null;
  for (const [key, quantity] of net) {
    if (quantity > 0 && (!best || quantity > best.quantity)) {
      best = { key, quantity };
    }
  }
  return best && best.key !== "" ? best.key : null;
}

/**
 * Refuses tracked entities whose stripe a demand may not draw: another
 * project's stock needs a Transfer or a Borrow first, and common demand
 * never draws project stock. One query, only when an entity is refused.
 */
export async function assertEntitiesInStripes(
  db: Kysely<DB> | Transaction<DB>,
  companyId: string,
  entities: readonly { readableId: string | null; stripe: StockStripe }[],
  stripes: readonly StockStripe[]
): Promise<void> {
  const refused = entities.filter((entity) => !stripes.includes(entity.stripe));
  if (refused.length === 0) return;
  const projectIds = [
    ...new Set(
      refused
        .map((entity) => entity.stripe)
        .filter((id): id is string => id !== null)
    )
  ];
  const projects =
    projectIds.length > 0
      ? await db
          .selectFrom("project")
          .select(["id", "identifier", "name"])
          .where("id", "in", projectIds)
          .where("companyId", "=", companyId)
          .execute()
      : [];
  const labelOf = (projectId: string) => {
    const project = projects.find((row) => row.id === projectId);
    return project?.identifier || project?.name || projectId;
  };
  const first = refused[0]!;
  const entity = first.readableId ?? "The selected lot";
  throw new InvalidInputError(
    first.stripe
      ? `${entity} is in the stock of project ${labelOf(first.stripe)}. Transfer it first.`
      : `${entity} is in common stock, which this demand cannot draw.`
  );
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

export type ProjectStockFlags = {
  /** The receipt also charges the project (projectLedger), Phase 4 billing. */
  chargeAtReceipt: boolean;
};

/**
 * The projects among `projectIds` that have project stock, with their flags,
 * keyed by project id. One query for any number of projects.
 */
export async function loadProjectStock(
  db: Kysely<DB> | Transaction<DB>,
  companyId: string,
  projectIds: readonly (string | null | undefined)[]
): Promise<Map<string, ProjectStockFlags>> {
  const ids = [
    ...new Set(projectIds.filter((id): id is string => Boolean(id)))
  ];
  const stock = new Map<string, ProjectStockFlags>();
  if (ids.length === 0) return stock;
  const projects = await db
    .selectFrom("project")
    .select(["id", "chargeAtReceipt"])
    .where("id", "in", ids)
    .where("companyId", "=", companyId)
    .where("projectStock", "=", true)
    .execute();
  for (const project of projects) {
    stock.set(project.id, { chargeAtReceipt: project.chargeAtReceipt });
  }
  return stock;
}
