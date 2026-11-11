// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The goods-in inspection hold: the release flag, the claim of a lot on an
// untracked unit, the locks the hold guard and the ledger handler take, and the
// project stripes held stock sits on. Public through `./quality.ts`.
import type { Transaction } from "kysely";
import { sql } from "kysely";
import type { Kysely, KyselyDatabase } from "./client.ts";
import { EPSILON, round } from "./precision.ts";

/**
 * Lets this transaction move stock the goods-in inspection hold guards
 * (`check_inspection_hold` on `itemLedger`). Call it only from a posting that
 * IS the release. Transaction-local.
 */
export async function setInspectionRelease(
  trx: Transaction<KyselyDatabase>
): Promise<void> {
  await sql`SELECT set_config('app.inspection_release', 'on', true)`.execute(
    trx
  );
}

export async function withInspectionRelease<T>(
  trx: Transaction<KyselyDatabase>,
  fn: () => Promise<T>
): Promise<T> {
  const before = await sql<{ previous: string | null }>`
    SELECT current_setting('app.inspection_release', true) AS previous
  `.execute(trx);
  await setInspectionRelease(trx);
  const previous = before.rows[0]?.previous === "on" ? "on" : "off";
  const restore = () =>
    sql`SELECT set_config('app.inspection_release', ${previous}, true)`.execute(
      trx
    );
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    await restore().catch((restoreError: unknown) => {
      if ((restoreError as { code?: unknown } | null)?.code !== "25P02") {
        console.error("inspection release: restore failed", restoreError);
      }
    });
    throw error;
  }
  await restore();
  return result;
}

export async function storageUnitLocationId(
  handle: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string,
  storageUnitId: string
): Promise<string | null> {
  const unit = await handle
    .selectFrom("storageUnit")
    .select("locationId")
    .where("id", "=", storageUnitId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  return unit?.locationId ?? null;
}

export async function lockClaimUnit(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    storageUnitId: string;
    locationId?: string | null;
    stockRowsLocked?: boolean;
  }
): Promise<void> {
  if (!args.stockRowsLocked) {
    const locationId =
      args.locationId ??
      (await storageUnitLocationId(trx, args.companyId, args.storageUnitId));
    if (!locationId) throw new Error("The storage unit could not be found");
    await lockItemStockRows(trx, args.companyId, [
      { itemId: args.itemId, locationId }
    ]);
  }
  await lockHeldUnits(trx, args.companyId, [args]);
}

export async function lotClaimableAtUnit(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    storageUnitId: string;
    ownHeld: number;
    locationId?: string | null;
    stockRowsLocked?: boolean;
  }
): Promise<number> {
  await lockClaimUnit(trx, args);
  const [row] = (
    await sql<{ onHand: number; held: number }>`
      SELECT
        public.inspection_untracked_on_hand(${args.companyId}, ${args.itemId}, ${args.storageUnitId}) AS "onHand",
        public.inspection_held_quantity(${args.companyId}, ${args.itemId}, ${args.storageUnitId}) AS "held"
    `.execute(trx)
  ).rows;
  const otherHeld = Number(row?.held ?? 0) - args.ownHeld;
  return round(Math.max(Number(row?.onHand ?? 0) - otherHeld, 0));
}

export async function lockItemStockRows(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  pairs: Array<{ itemId: string; locationId: string }>
): Promise<void> {
  if (pairs.length === 0) return;
  await sql`
    SELECT 1 FROM "itemStockQuantities" q
    JOIN unnest(${pairs.map((p) => p.itemId)}::text[], ${pairs.map((p) => p.locationId)}::text[]) AS k(i, l)
      ON q."itemId" = k.i AND q."locationId" = k.l
    WHERE q."companyId" = ${companyId}
    ORDER BY q."itemId", q."locationId", q."projectId"
    FOR UPDATE OF q
  `.execute(trx);
}

export async function lockHeldUnits(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  pairs: Array<{ itemId: string; storageUnitId: string }>
): Promise<void> {
  if (pairs.length === 0) return;
  await sql`SELECT pg_advisory_xact_lock(hashtextextended('inspection-hold:' || ${companyId} || ':' || k.i || ':' || k.u, 0))
    FROM unnest(${pairs.map((p) => p.itemId)}::text[], ${pairs.map((p) => p.storageUnitId)}::text[]) AS k(i, u)
    ORDER BY k.i, k.u`.execute(trx);
}

export type HeldStripe = { projectId: string | null; quantity: number };

export async function heldStockStripes(
  trx: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    storageUnitId: string | null;
    locationId?: string | null;
    documentIds: string[];
  }
): Promise<HeldStripe[]> {
  if (args.storageUnitId === null && !args.locationId) {
    throw new Error("Stock in no storage unit is read at a location");
  }
  const documentIds = args.documentIds.filter(Boolean);
  const rows = await trx
    .selectFrom("itemLedger")
    .select([
      "projectId",
      sql<number>`SUM("quantity")`.as("quantity"),
      (documentIds.length > 0
        ? sql<number>`COALESCE(SUM("quantity") FILTER (WHERE "quantity" > 0 AND "documentId" IN (${sql.join(documentIds)})), 0)`
        : sql<number>`0`
      ).as("lotShare")
    ])
    .where("companyId", "=", args.companyId)
    .where("itemId", "=", args.itemId)
    .$if(args.storageUnitId !== null, (qb) =>
      qb.where("storageUnitId", "=", args.storageUnitId)
    )
    .$if(args.storageUnitId === null, (qb) =>
      qb
        .where("storageUnitId", "is", null)
        .where("locationId", "=", args.locationId as string)
    )
    .where("trackedEntityId", "is", null)
    .groupBy("projectId")
    .execute();
  return rows
    .map((row) => ({
      projectId: row.projectId,
      quantity: round(Number(row.quantity)),
      lotShare: Number(row.lotShare)
    }))
    .filter((row) => row.quantity > EPSILON)
    .sort(
      (a, b) =>
        b.lotShare - a.lotShare ||
        b.quantity - a.quantity ||
        (a.projectId ?? "").localeCompare(b.projectId ?? "")
    )
    .map(({ projectId, quantity }) => ({ projectId, quantity }));
}

export function drawHeldStripes(
  quantity: number,
  available: readonly HeldStripe[],
  options: { overflow?: boolean } = {}
): HeldStripe[] {
  const draws: HeldStripe[] = [];
  let remaining = round(quantity);
  for (const stripe of available) {
    if (remaining <= EPSILON) break;
    const take = round(Math.min(remaining, stripe.quantity));
    if (take <= EPSILON) continue;
    draws.push({ projectId: stripe.projectId, quantity: take });
    remaining = round(remaining - take);
  }
  if (options.overflow && remaining > EPSILON) {
    const unassigned = draws.find((draw) => draw.projectId === null);
    if (unassigned)
      unassigned.quantity = round(unassigned.quantity + remaining);
    else draws.push({ projectId: null, quantity: remaining });
  }
  return draws;
}
