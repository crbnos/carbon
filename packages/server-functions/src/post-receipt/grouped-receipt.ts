// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Projects Phase 3: distribution at the physical event. A PO line made for a
// planning group (`purchaseOrderLine.planningGroupId`) has no project. Its
// receipt splits into member stripes by the line's current pegs:
// `harden_pegs_for_supply` turns the pegs it covers Hard and returns one row
// per stripe; the receipt writes its item ledger rows and cost layers per
// returned row. The remainder follows the group's excess rule (the last row).

import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { EPSILON, round } from "@carbon/utils";
import { type Kysely, sql, type Transaction } from "kysely";

type Db = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

/** One row of `harden_pegs_for_supply`: a member stripe of the supply, or the
 *  excess (`pegId` null; `projectId` the exception project or null for
 *  common stock). */
export interface PegStripe {
  projectId: string | null;
  quantity: number;
  pegId: string | null;
}

/** Calls the one peg split rule for `quantity` units of a supply. */
export async function hardenPegsForSupply(
  trx: Db,
  args: {
    companyId: string;
    userId: string;
    supplyType: Database["public"]["Enums"]["projectPegSupplyType"];
    supplyId: string;
    quantity: number;
  }
): Promise<PegStripe[]> {
  const { rows } = await sql<{
    projectId: string | null;
    quantity: string | number;
    pegId: string | null;
  }>`SELECT "projectId", "quantity", "pegId" FROM harden_pegs_for_supply(
      ${args.companyId}, ${args.userId},
      ${args.supplyType}::"projectPegSupplyType", ${args.supplyId},
      ${args.quantity}::numeric
    )`.execute(trx);
  return rows.map((row) => ({
    projectId: row.projectId,
    quantity: Number(row.quantity),
    pegId: row.pegId
  }));
}

export interface StripePiece {
  /** The index of the row the piece comes from. */
  rowIndex: number;
  quantity: number;
  stripe: PegStripe;
}

/**
 * Walks `quantities` (the rows of one receipt line, in order) and `stripes`
 * together and cuts each row where a stripe ends. A row that spans 2 stripes
 * gives 2 pieces. What the stripes do not cover goes to the last stripe; the
 * caller passes stripes that add up to the rows, so that is float noise only.
 */
export function allocateToStripes(
  quantities: readonly number[],
  stripes: readonly PegStripe[]
): StripePiece[] {
  const pieces: StripePiece[] = [];
  if (stripes.length === 0) return pieces;
  let stripeIndex = 0;
  let stripeLeft = stripes[0]!.quantity;
  quantities.forEach((rowQuantity, rowIndex) => {
    let rowLeft = rowQuantity;
    while (rowLeft > EPSILON) {
      const isLastStripe = stripeIndex === stripes.length - 1;
      if (stripeLeft <= EPSILON && !isLastStripe) {
        stripeIndex += 1;
        stripeLeft = stripes[stripeIndex]!.quantity;
        continue;
      }
      const take = isLastStripe ? rowLeft : Math.min(rowLeft, stripeLeft);
      pieces.push({
        rowIndex,
        quantity: round(take),
        stripe: stripes[stripeIndex]!
      });
      rowLeft -= take;
      stripeLeft -= take;
    }
  });
  return pieces;
}

type ItemLedgerInsert = {
  quantity: number;
  projectId?: string | null;
};

/** The item ledger rows of one grouped receipt line, one per stripe piece.
 *  A lot that spans 2 stripes gives 2 rows with the same `trackedEntityId`.
 *  `pegIds` is parallel to `rows`. */
export function stripeItemLedgerRows<T extends ItemLedgerInsert>(
  rows: readonly T[],
  stripes: readonly PegStripe[]
): { rows: (T & { projectId: string | null })[]; pegIds: (string | null)[] } {
  const pieces = allocateToStripes(
    rows.map((row) => Number(row.quantity)),
    stripes
  );
  return {
    rows: pieces.map((piece) => ({
      ...rows[piece.rowIndex]!,
      quantity: piece.quantity,
      projectId: piece.stripe.projectId
    })),
    pegIds: pieces.map((piece) => piece.stripe.pegId)
  };
}

type CostLedgerInsert = {
  quantity?: number | null;
  cost?: number | null;
  nominalCost?: number | null;
  remainingQuantity?: number | null;
  projectId?: string | null;
};

/** The cost layers of one grouped receipt line, one per stripe piece, at the
 *  receipt's unit cost. The last piece of a layer takes the rounding rest, so
 *  the pieces add up to the layer exactly. */
export function stripeCostLedgerRows<T extends CostLedgerInsert>(
  rows: readonly T[],
  stripes: readonly PegStripe[]
): (T & { projectId: string | null })[] {
  const pieces = allocateToStripes(
    rows.map((row) => Number(row.quantity ?? 0)),
    stripes
  );
  // What the earlier pieces of each layer already took.
  const taken = new Map<
    number,
    { cost: number; nominalCost: number; remainingQuantity: number }
  >();
  return pieces.map((piece, index) => {
    const row = rows[piece.rowIndex]!;
    const rowQuantity = Number(row.quantity ?? 0);
    const isLastOfRow = pieces[index + 1]?.rowIndex !== piece.rowIndex;
    const before = taken.get(piece.rowIndex) ?? {
      cost: 0,
      nominalCost: 0,
      remainingQuantity: 0
    };
    const share = rowQuantity === 0 ? 0 : piece.quantity / rowQuantity;
    const part = (value: number | null | undefined, sum: number) =>
      isLastOfRow
        ? round(Number(value ?? 0) - sum)
        : round(Number(value ?? 0) * share);
    const cost = part(row.cost, before.cost);
    const nominalCost = part(row.nominalCost, before.nominalCost);
    const remainingQuantity = part(
      row.remainingQuantity,
      before.remainingQuantity
    );
    taken.set(piece.rowIndex, {
      cost: before.cost + cost,
      nominalCost: before.nominalCost + nominalCost,
      remainingQuantity: before.remainingQuantity + remainingQuantity
    });
    return {
      ...row,
      quantity: piece.quantity,
      cost,
      nominalCost: row.nominalCost == null ? row.nominalCost : nominalCost,
      remainingQuantity,
      projectId: piece.stripe.projectId
    };
  });
}

/** Points each Hard peg at the first item ledger row written for it. The one
 *  in-place peg update the plan allows. */
export async function linkPegsToItemLedger(
  trx: Db,
  companyId: string,
  links: readonly { pegId: string; itemLedgerId: string }[]
): Promise<void> {
  if (links.length === 0) return;
  const values = sql.join(
    links.map((link) => sql`(${link.pegId}, ${link.itemLedgerId})`)
  );
  await sql`UPDATE "projectPeg" AS pp
    SET "itemLedgerId" = v."itemLedgerId"
    FROM (VALUES ${values}) AS v("pegId", "itemLedgerId")
    WHERE pp."id" = v."pegId" AND pp."companyId" = ${companyId}`.execute(trx);
}

/**
 * The void of a grouped receipt: supersede the Hard pegs of the receipt's item
 * ledger rows and insert a Soft copy of each, so the next MRP run can re-peg
 * the open supply. One statement.
 */
export async function softenPegsOfItemLedger(
  trx: Db,
  args: { companyId: string; userId: string; itemLedgerIds: readonly string[] }
): Promise<number> {
  if (args.itemLedgerIds.length === 0) return 0;
  const { rows } = await sql<{ id: string }>`
    WITH hard AS (
      UPDATE "projectPeg"
      SET "supersededAt" = now()
      WHERE "companyId" = ${args.companyId}
        AND "supersededAt" IS NULL
        AND "state" = 'Hard'
        AND "itemLedgerId" IN (${sql.join(args.itemLedgerIds)})
      RETURNING *
    )
    INSERT INTO "projectPeg" (
      "companyId", "planningGroupId", "itemId", "locationId", "supplyType",
      "supplyId", "projectId", "projectElementId", "demandSourceType",
      "demandSourceId", "parentPegId", "quantity", "needDate", "state",
      "createdByRunId", "createdBy"
    )
    SELECT "companyId", "planningGroupId", "itemId", "locationId", "supplyType",
      "supplyId", "projectId", "projectElementId", "demandSourceType",
      "demandSourceId", "parentPegId", "quantity", "needDate", 'Soft',
      "createdByRunId", ${args.userId}
    FROM hard
    RETURNING "id"`.execute(trx);
  return rows.length;
}
