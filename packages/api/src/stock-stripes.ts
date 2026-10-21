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

// @carbon/api has no kysely dependency of its own: the Kysely types come
// through @carbon/database/client.
import type {
  KyselyDatabase as DB,
  ExpressionBuilder,
  Kysely,
  KyselyTx
} from "@carbon/database/client";
import { InvalidInputError } from "./errors";

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
  db: Kysely<DB> | KyselyTx,
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
      : `${entity} is in unassigned stock, which this demand cannot draw.`
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
  db: Kysely<DB> | KyselyTx,
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
  db: Kysely<DB> | KyselyTx,
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

/**
 * The stripe that holds a tracked entity, read from its item ledger rows
 * (`trackedEntityStripe`). One query.
 */
export async function loadTrackedEntityStripe(
  db: Kysely<DB> | KyselyTx,
  companyId: string,
  trackedEntityId: string
): Promise<StockStripe> {
  const rows = await db
    .selectFrom("itemLedger")
    .select(["trackedEntityId", "projectId", "quantity"])
    .where("trackedEntityId", "=", trackedEntityId)
    .where("companyId", "=", companyId)
    .execute();
  return trackedEntityStripe(rows, trackedEntityId);
}

/**
 * Sets `projectId` on every row: a Transfer pair, and every row a move writes
 * with it, carries the stripe of the stock it moves. Every row of a multi-row
 * insert gets the key, so Kysely writes no NULL into a sibling by accident.
 */
export function withStripe<T extends object>(
  rows: readonly T[],
  stripe: StockStripe
): (T & { projectId: string | null })[] {
  return rows.map((row) => ({ ...row, projectId: stripe }));
}

/**
 * The stripe of each tracked entity (`trackedEntityStripe`), keyed by id.
 * One query for any number of entities.
 */
export async function loadTrackedEntityStripes(
  db: Kysely<DB> | KyselyTx,
  companyId: string,
  trackedEntityIds: readonly string[]
): Promise<Map<string, StockStripe>> {
  const ids = [...new Set(trackedEntityIds)];
  const stripes = new Map<string, StockStripe>();
  if (ids.length === 0) return stripes;
  const rows = await db
    .selectFrom("itemLedger")
    .select(["trackedEntityId", "projectId", "quantity"])
    .where("trackedEntityId", "in", ids)
    .where("companyId", "=", companyId)
    .execute();
  for (const id of ids) stripes.set(id, trackedEntityStripe(rows, id));
  return stripes;
}

/**
 * Refuses tracked entities outside common stock for a document that ships to
 * a customer: a project's stock reaches a customer only through a Transfer to
 * common stock first. One query, plus one only when an entity is refused.
 */
export async function assertEntitiesInCommonStock(
  db: Kysely<DB> | KyselyTx,
  companyId: string,
  entities: readonly { id: string; readableId: string | null }[]
): Promise<void> {
  if (entities.length === 0) return;
  const stripes = await loadTrackedEntityStripes(
    db,
    companyId,
    entities.map((entity) => entity.id)
  );
  await assertEntitiesInStripes(
    db,
    companyId,
    entities.map((entity) => ({
      readableId: entity.readableId,
      stripe: stripes.get(entity.id) ?? null
    })),
    [null]
  );
}
