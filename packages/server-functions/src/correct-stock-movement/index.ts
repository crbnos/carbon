// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  assertPostingStatusUnchanged,
  journalPostingStatus
} from "@carbon/database/journal-posting-status";
import {
  inOrder,
  many,
  maybeSingle,
  rpcRows,
  single
} from "@carbon/database/rows";
import { equals, round, statusAfterQuantityChange } from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { getAccountingPeriodForDate } from "../lib/get-accounting-period";
import { getDefaultPostingGroup } from "../lib/get-posting-group";
import { bookAdjustment } from "../lib/post-adjustment";

// Corrects a posted stock movement by inserting ONE opposite (delta) movement
// linked to the original via itemLedger.correctionOfItemLedgerId. The caller
// supplies the SIGNED quantity the movement should have been; the delta is
// derived against the movement's current effective quantity (original + all
// prior corrections in its group), so repeated corrections converge.
//
// The correction carries the ORIGINAL movement's postingDate and posts its GL
// journal into the accounting period containing that date (fails when that
// period is Locked/Closed). entryNumber is a SERIAL and cannot be
// retro-inserted — "next to the original" is delivered by the postingDate and
// by the stock-movements UI, which nests corrections under their original.
export const correctStockMovementInput = z.object({
  itemLedgerId: z.string(),
  // SIGNED corrected quantity, matching the ledger's sign convention
  // (a shipment of -5 that should have been -3 → correctedQuantity: -3).
  correctedQuantity: z.number(),
  comment: z.string().optional().nullable()
});

const MAX_CORRECTION_CHAIN_DEPTH = 100;

const correctStockMovement = defineServerFn({
  name: "correct-stock-movement",
  input: correctStockMovementInput,
  permissions: { update: "inventory" },
  async run(ctx, { itemLedgerId, correctedQuantity, comment }) {
    const { db, companyId, userId } = ctx;
    const ledgerColumns = [
      "id",
      "itemId",
      "locationId",
      "storageUnitId",
      "trackedEntityId",
      "quantity",
      "postingDate",
      "entryType",
      "documentType",
      "documentId",
      "correctionOfItemLedgerId"
    ] as const;

    const originalResult = await maybeSingle(
      db,
      "itemLedger",
      { id: itemLedgerId, companyId },
      { columns: ledgerColumns }
    );
    if (originalResult.error) throw new Error("Failed to fetch stock movement");
    if (!originalResult.data) {
      throw new NotFoundError("Stock movement not found");
    }

    // Walk up to the topmost ancestor: corrections always link to the ROOT so
    // the group stays flat and its effective quantity is a simple sum.
    let root = originalResult.data;
    for (
      let depth = 0;
      root.correctionOfItemLedgerId && depth < MAX_CORRECTION_CHAIN_DEPTH;
      depth++
    ) {
      const parent = await maybeSingle(
        db,
        "itemLedger",
        { id: root.correctionOfItemLedgerId, companyId },
        { columns: ledgerColumns }
      );
      if (parent.error) throw new Error("Failed to fetch stock movement");
      // Broken link (no FK on correctionOfItemLedgerId): treat the current row
      // as the root rather than failing the correction.
      if (!parent.data) break;
      root = parent.data;
    }

    // Collect the whole correction group (historical count corrections chained
    // fix→fix, so descendants can be more than one level deep).
    let effectiveQuantity = Number(root.quantity);
    let frontier = [root.id];
    const seen = new Set<string>([root.id]);
    while (frontier.length > 0) {
      const children = await many(
        db,
        "itemLedger",
        { correctionOfItemLedgerId: frontier, companyId },
        { columns: ["id", "quantity"] }
      );
      if (children.error) throw new Error("Failed to fetch corrections");
      frontier = [];
      for (const child of children.data ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        effectiveQuantity += Number(child.quantity);
        frontier.push(child.id);
      }
    }

    // Round the delta ONCE, here: it is persisted twice — into the entity via
    // eb("quantity", "+", delta) and into the correction's own itemLedger row —
    // and both must carry the same value at internal scale. A raw `=== 0` no-op
    // gate also lets float residue (correcting a -5 line back to exactly its
    // effective -4.99999999999999 sum) through as a 1e-14 correction row.
    const delta = round(correctedQuantity - effectiveQuantity);
    if (equals(delta, 0)) {
      throw new InvalidInputError(
        "Corrected quantity matches the current effective quantity — nothing to correct"
      );
    }

    // A correction row shows only its delta (+4), which doesn't tell the reader
    // the from→to intent — so when the user gives no reason, self-document it.
    const resolvedComment =
      comment?.trim() ||
      `Corrected from ${effectiveQuantity} to ${correctedQuantity}`;

    const [itemResult, itemCostResult, trackingQuantities] = await inOrder([
      () =>
        single(
          db,
          "item",
          { id: root.itemId, companyId },
          { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
        ),
      () =>
        single(
          db,
          "itemCost",
          { itemId: root.itemId, companyId },
          {
            columns: [
              "costingMethod",
              "unitCost",
              "standardCost",
              "itemPostingGroupId"
            ]
          }
        ),
      () =>
        root.locationId
          ? rpcRows(db, "get_item_quantities_by_tracking_id", {
              item_id: root.itemId,
              company_id: companyId,
              location_id: root.locationId
            })
          : Promise.resolve({ data: null, error: null })
    ]);

    if (itemResult.error) throw new Error("Failed to fetch item");
    if (itemCostResult.error) throw new Error("Failed to fetch item cost");
    // Fail closed: a failed quantity read must abort, not read as "no stock".
    if (trackingQuantities.error) {
      throw new Error("Failed to fetch current quantities");
    }

    const item = {
      itemTrackingType: itemResult.data.itemTrackingType,
      replenishmentSystem: itemResult.data.replenishmentSystem,
      itemPostingGroupId: itemCostResult.data.itemPostingGroupId
    };

    const isSerial = item.itemTrackingType === "Serial";
    if (isSerial) {
      if (!Number.isInteger(delta)) {
        throw new InvalidInputError(
          "Corrections on serial-tracked items must be whole numbers"
        );
      }
      // A serial number is a single unique unit — the corrected movement can
      // never carry more than one of it (matches inventoryAdjustmentValidator).
      if (Math.abs(correctedQuantity) > 1) {
        throw new InvalidInputError(
          "Serial items can only have a quantity of 1"
        );
      }
    }

    // A negative delta removes stock now — it must not drive the stock target
    // (tracked entity, or untracked stock in the original's bin) below zero.
    if (delta < 0 && root.locationId) {
      type TrackingQuantityRow = {
        trackedEntityId: string | null;
        storageUnitId: string | null;
        quantity: number | null;
      };
      const trackingRows = (trackingQuantities.data ??
        []) as TrackingQuantityRow[];
      // null == undefined — loose equality is deliberate (matches
      // post-inventory-adjustment's storage-unit lookup).
      const stockTarget = root.trackedEntityId
        ? trackingRows.find((q) => q.trackedEntityId == root.trackedEntityId)
        : trackingRows.find(
            (q) =>
              q.trackedEntityId == null && q.storageUnitId == root.storageUnitId
          );
      if ((stockTarget?.quantity ?? 0) < Math.abs(delta)) {
        throw new InvalidInputError(
          "Insufficient quantity for negative adjustment"
        );
      }
    }

    let trackedEntityStatus: string | null = null;
    if (root.trackedEntityId) {
      const entity = await maybeSingle(
        db,
        "trackedEntity",
        { id: root.trackedEntityId, companyId },
        { columns: ["status", "quantity"] }
      );
      if (entity.error || !entity.data) {
        throw new Error("Failed to fetch tracked entity");
      }
      trackedEntityStatus = entity.data.status;
      if (trackedEntityStatus === "Consumed") {
        throw new InvalidInputError(
          "Cannot correct a movement of a consumed tracked entity"
        );
      }
      // Round before comparing: a correction that lands the lot exactly on
      // zero can read as −1e-17 raw and refuse a legitimate full correction.
      if (round(Number(entity.data.quantity) + delta) < 0) {
        throw new InvalidInputError(
          "Correction would make the tracked entity quantity negative"
        );
      }
      if (isSerial && Number(entity.data.quantity) + delta > 1) {
        throw new InvalidInputError(
          "Serial items can only have a quantity of 1"
        );
      }
    }

    // A correction that carries value posts a journal: Provisional before the
    // company's accounting cutover, Posted after it. Read here to decide
    // whether to resolve a period, and again inside the transaction.
    const postingStatus = await journalPostingStatus(db, companyId);
    const accountDefaults = await getDefaultPostingGroup(db, companyId);
    if (accountDefaults.error || !accountDefaults.data) {
      throw new Error("Error getting account defaults");
    }

    const dimensionMap: Record<string, string> = {};
    const companyRecord = await single(
      db,
      "company",
      { id: companyId },
      { columns: ["companyGroupId"] }
    );
    if (companyRecord.error) throw new Error("Failed to fetch company");
    const companyGroupId = companyRecord.data.companyGroupId;
    if (companyGroupId) {
      const dimensions = await many(
        db,
        "dimension",
        {
          companyGroupId,
          active: true,
          entityType: ["Item", "ItemPostingGroup", "Location"]
        },
        { columns: ["id", "entityType"] }
      );
      if (dimensions.error) throw new Error("Failed to fetch dimensions");
      for (const dim of dimensions.data ?? []) {
        if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
      }
    }

    // Resolve the accounting period BEFORE opening the Kysely transaction —
    // the REST client mid-transaction parks the (size 1) pool. The period is
    // the one containing the ORIGINAL movement's postingDate; Locked/Closed
    // periods throw here with a user-facing message. A Provisional journal has
    // no accounting period.
    const accountingPeriodId =
      postingStatus === "Posted"
        ? await getAccountingPeriodForDate(companyId, db, root.postingDate)
        : null;
    const accounting = {
      postingStatus,
      accountingPeriodId,
      accountDefaults: {
        rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
        finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
        inventoryAdjustmentVarianceAccount:
          accountDefaults.data.inventoryAdjustmentVarianceAccount
      },
      description: `Stock Movement Correction — ${resolvedComment}`,
      userId,
      dimensions: dimensionMap
    };

    let resultLedgerId: string | null = null;

    await db.transaction().execute(async (trx) => {
      await assertPostingStatusUnchanged(trx, companyId, postingStatus);

      if (root.trackedEntityId) {
        const updated = await trx
          .updateTable("trackedEntity")
          .set((eb) => ({ quantity: eb("quantity", "+", delta) }))
          .where("id", "=", root.trackedEntityId!)
          .where("companyId", "=", companyId)
          .where("status", "!=", "Consumed")
          .where((eb) => eb("quantity", ">=", -delta))
          // Serial ceiling re-checked atomically: resulting quantity ≤ 1.
          .$if(isSerial, (qb) =>
            qb.where((eb) => eb("quantity", "<=", 1 - delta))
          )
          .returning(["id", "quantity", "status"])
          .executeTakeFirst();
        if (!updated) {
          throw new InvalidInputError(
            "Tracked entity changed while correcting — try again"
          );
        }
        // If the correction drove the lot to zero, Consume it (a Scrapped lot
        // stays Scrapped). `updated.status` is the unchanged pre-flip status.
        const settledStatus = statusAfterQuantityChange(
          Number(updated.quantity),
          updated.status
        );
        if (settledStatus !== updated.status) {
          await trx
            .updateTable("trackedEntity")
            .set({ status: settledStatus })
            .where("id", "=", root.trackedEntityId!)
            .where("companyId", "=", companyId)
            .execute();
        }
      }

      const booked = await bookAdjustment(trx, {
        ledger: {
          postingDate: root.postingDate,
          itemId: root.itemId,
          quantity: delta,
          locationId: root.locationId,
          storageUnitId: root.storageUnitId,
          trackedEntityId: root.trackedEntityId,
          entryType: delta > 0 ? "Positive Adjmt." : "Negative Adjmt.",
          documentType: root.documentType,
          documentId: root.documentId,
          correctionOfItemLedgerId: root.id,
          comment: resolvedComment,
          companyId,
          createdBy: userId
        },
        item,
        itemCost: itemCostResult.data,
        accounting
      });
      resultLedgerId = booked.itemLedgerId;
    });

    return { itemLedger: resultLedgerId ? { id: resultLedgerId } : null };
  }
});

export default correctStockMovement;
