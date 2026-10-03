// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Database, getCompanyTimeZone } from "@carbon/database";
import { many, notNull, single } from "@carbon/database/rows";
import { datetime } from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { getCurrentAccountingPeriod } from "../lib/get-accounting-period";
import { getDefaultPostingGroup } from "../lib/get-posting-group";
import {
  bookAdjustment,
  createAdjustmentJournal
} from "../lib/post-adjustment";
import { resolveCountedEntity } from "./count-guards";
import { planInventoryCountPost } from "./plan-post";

// Base for post-blocking validation errors. Carries the offending line ids so
// the response can hand them to the UI to highlight the rows.
// A 400 whose `body.invalidLineIds` the caller reads to highlight the rows.
class InvalidLinesError extends InvalidInputError {
  constructor(message: string, lineIds: string[]) {
    super(message, { invalidLineIds: lineIds });
    this.name = "InvalidLinesError";
  }
}

// Thrown when a serial-tracked line is counted as anything other than 0 or 1
// (a serial entity is a single unique unit).
class SerialQuantityError extends InvalidLinesError {
  constructor(lineIds: string[]) {
    super(
      `${lineIds.length} serial line(s) must be counted as 0 or 1 — a serial number is a single unit.`,
      lineIds
    );
    this.name = "SerialQuantityError";
  }
}

// Inventory Count posting uses snapshot-delta reconciliation: for each counted
// line we post a single Positive/Negative adjustment for the variance the counter
// reviewed — `counted - systemQuantity` (the FROZEN snapshot on the line), NOT
// `counted - live on-hand`. This preserves any stock movements that posted between
// the snapshot and the post (a receipt/shipment isn't clobbered; the correction is
// applied on top of it). Each variance books through the shared posting core:
// item ledger + cost layers + (when companySettings.accountingEnabled) a GL
// journal against the inventory adjustment variance account.
// A count posts exactly once (Posted is terminal). Fixing a posted movement
// happens per-movement via the correct-stock-movement server function, which
// links the fix through itemLedger.correctionOfItemLedgerId.
export const postInventoryCountInput = z.object({
  inventoryCountId: z.string()
});

/** Posts a Pending inventory count: one adjustment per counted variance, atomically. */
const postInventoryCount = defineServerFn({
  name: "post-inventory-count",
  input: postInventoryCountInput,
  permissions: { update: "inventory" },
  async run(ctx, { inventoryCountId }) {
    const { db, companyId, userId } = ctx;
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();
    const nowIso = datetime.timestamp();

    const inventoryCount = await single(db, "inventoryCount", {
      id: inventoryCountId,
      companyId
    });

    if (inventoryCount.error)
      throw new NotFoundError("Inventory count not found");

    const lines = await many(db, "inventoryCountLine", {
      inventoryCountId,
      companyId,
      countedQuantity: notNull
    });

    if (lines.error) throw new Error(lines.error.message);

    const comment = `Inventory Count ${inventoryCount.data.inventoryCountId}`;
    const countedLines = (lines.data ?? []).filter(
      (line) => line.countedQuantity !== null
    );

    // Serial validation: a serial-tracked item is a single unique unit, so each
    // serial line can only be counted 0 or 1. Block the post (before any write)
    // and return the offending line ids so the UI can highlight them.
    const itemIds = [...new Set(countedLines.map((line) => line.itemId))];
    const items = itemIds.length
      ? await many(
          db,
          "item",
          { id: itemIds, companyId },
          { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
        )
      : null;
    if (items?.error) throw new Error(items.error.message);

    const trackingTypeByItem = new Map<string, string | null>(
      (items?.data ?? []).map((item) => [item.id, item.itemTrackingType])
    );
    // Explicit row types for these selects.
    type CountItemRow = {
      id: string;
      replenishmentSystem:
        | Database["public"]["Enums"]["itemReplenishmentSystem"]
        | null;
    };
    type CountItemCostRow = {
      itemId: string;
      costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
      unitCost: number | null;
      standardCost: number | null;
      itemPostingGroupId: string | null;
    };
    const replenishmentByItem = new Map(
      ((items?.data ?? []) as CountItemRow[]).map((item) => [
        item.id,
        item.replenishmentSystem
      ])
    );

    const itemCosts = itemIds.length
      ? await many(
          db,
          "itemCost",
          { itemId: itemIds, companyId },
          {
            columns: [
              "itemId",
              "costingMethod",
              "unitCost",
              "standardCost",
              "itemPostingGroupId"
            ]
          }
        )
      : null;
    if (itemCosts?.error) throw new Error(itemCosts.error.message);
    const itemCostByItem = new Map(
      ((itemCosts?.data ?? []) as CountItemCostRow[]).map((cost) => [
        cost.itemId,
        cost
      ])
    );
    const serialInvalidLineIds = countedLines
      .filter((line) => {
        if (trackingTypeByItem.get(line.itemId) !== "Serial") return false;
        const counted = Number(line.countedQuantity);
        return counted !== 0 && counted !== 1;
      })
      .map((line) => line.id);
    if (serialInvalidLineIds.length > 0) {
      throw new SerialQuantityError(serialInvalidLineIds);
    }

    // Reconcile against the frozen snapshot — no live on-hand read needed.
    const { planned } = planInventoryCountPost(countedLines);

    // The accountingEnabled flag gates ALL journal writes; cost layers are
    // maintained either way. Resolve settings + period BEFORE the transaction
    // (REST hops mid-transaction park the size-1 pool in idle-in-transaction).
    const accountingSettings = await single(
      db,
      "companySettings",
      { id: companyId },
      { columns: ["accountingEnabled"] }
    );
    // Fail closed: a failed settings read must not silently post without GL.
    if (accountingSettings.error) {
      throw new Error("Failed to fetch company settings");
    }
    const accountingEnabled =
      accountingSettings.data?.accountingEnabled ?? false;
    const accountDefaults = accountingEnabled
      ? await getDefaultPostingGroup(db, companyId)
      : null;
    if (
      accountingEnabled &&
      (accountDefaults?.error || !accountDefaults?.data)
    ) {
      throw new Error("Error getting account defaults");
    }
    const accountingPeriodId = accountingEnabled
      ? await getCurrentAccountingPeriod(companyId, db, today)
      : null;

    // Active dimensions for the company group (post-shipment precedent) —
    // journal lines get Item / ItemPostingGroup / Location tags.
    const dimensionMap: Record<string, string> = {};
    if (accountingEnabled) {
      const companyRecord = await single(
        db,
        "company",
        { id: companyId },
        { columns: ["companyGroupId"] }
      );
      if (companyRecord.error) throw new Error("Failed to fetch company");
      const dimensions = await many(
        db,
        "dimension",
        {
          companyGroupId: companyRecord.data.companyGroupId!,
          active: true,
          entityType: ["Item", "ItemPostingGroup", "Location"]
        },
        { columns: ["id", "entityType"] }
      );
      // Fail closed: journal lines must not silently lose dimension tags.
      if (dimensions.error) throw new Error("Failed to fetch dimensions");
      for (const dim of dimensions.data ?? []) {
        if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
      }
    }

    const accounting =
      accountingEnabled && accountDefaults?.data && accountingPeriodId
        ? {
            accountingPeriodId,
            accountDefaults: {
              rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
              finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
              inventoryAdjustmentVarianceAccount:
                accountDefaults.data.inventoryAdjustmentVarianceAccount
            },
            description: comment,
            userId,
            dimensions: dimensionMap
          }
        : null;

    await db.transaction().execute(async (trx) => {
      // Concurrency guard: lock the header and re-assert it is still Pending so
      // two concurrent posts can't both apply the delta (double-post). Mirrors
      // the FOR UPDATE guard in post-payment / post-memo; the end-of-transaction
      // guarded UPDATE below is the backstop.
      const locked = await trx
        .selectFrom("inventoryCount")
        .select(["id", "status"])
        .where("id", "=", inventoryCountId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();

      if (!locked) throw new NotFoundError("Inventory count not found");
      if (locked.status !== "Pending") {
        throw new Error("Inventory count is no longer pending");
      }

      // ONE journal per count post: created lazily on the first variance that
      // carries value, then shared by every line's journal-line pair.
      let sharedJournalId: string | null = null;
      const accountingForLines = accounting
        ? {
            ...accounting,
            getJournalId: async () => {
              if (!sharedJournalId) {
                sharedJournalId = await createAdjustmentJournal(trx, {
                  companyId,
                  accountingPeriodId: accounting.accountingPeriodId,
                  description: accounting.description,
                  postingDate: today,
                  userId
                });
              }
              return sharedJournalId;
            }
          }
        : null;

      // Post the reviewed variance for each line as an inventory adjustment,
      // booked through the shared core (ledger + cost layers + journal).
      for (const { line, delta } of planned) {
        if (delta === 0) continue;

        const itemCost = itemCostByItem.get(line.itemId);
        if (!itemCost) {
          throw new Error(`Missing item cost for item ${line.itemId}`);
        }

        const booked = await bookAdjustment(trx, {
          ledger: {
            postingDate: today,
            itemId: line.itemId,
            quantity: delta,
            locationId: line.locationId,
            storageUnitId: line.storageUnitId,
            trackedEntityId: line.trackedEntityId,
            entryType: delta > 0 ? "Positive Adjmt." : "Negative Adjmt.",
            documentType: "Inventory Count",
            documentId: inventoryCountId,
            comment,
            companyId,
            createdBy: userId
          },
          item: {
            itemTrackingType: trackingTypeByItem.get(line.itemId) ?? null,
            replenishmentSystem: replenishmentByItem.get(line.itemId) ?? null,
            itemPostingGroupId: itemCost.itemPostingGroupId
          },
          itemCost,
          accounting: accountingForLines
        });

        // Tracked lines: apply the same delta to the entity's quantity (not a
        // set-to-counted) so movements since the snapshot aren't overwritten.
        // Lock and read the live row so the guard sees the current quantity;
        // a delta that would drive it negative means stock moved since the
        // count, so we throw to roll back rather than clamp (which would desync
        // the entity from the ledger delta already booked above). Landing on
        // zero flips the lot Consumed.
        if (line.trackedEntityId) {
          const entity = await trx
            .selectFrom("trackedEntity")
            .select(["quantity", "status"])
            .where("id", "=", line.trackedEntityId)
            .where("companyId", "=", companyId)
            .forUpdate()
            .executeTakeFirst();
          const settled = resolveCountedEntity({
            currentQuantity: Number(entity?.quantity ?? 0),
            delta,
            currentStatus: entity?.status ?? "Available"
          });
          await trx
            .updateTable("trackedEntity")
            .set({ quantity: settled.quantity, status: settled.status })
            .where("id", "=", line.trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();
        }

        await trx
          .updateTable("inventoryCountLine")
          .set({ postedItemLedgerId: booked.itemLedgerId })
          .where("id", "=", line.id)
          .where("companyId", "=", companyId)
          .execute();
      }

      // Guard the transition inside the transaction: only a still-Pending count
      // can be posted. If a concurrent post already moved it to Posted, this
      // matches 0 rows and we throw to roll back this transaction's ledger
      // writes — preventing a double-post.
      const posted = await trx
        .updateTable("inventoryCount")
        .set({
          status: "Posted",
          postedBy: userId,
          postedAt: nowIso,
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", inventoryCountId)
        .where("companyId", "=", companyId)
        .where("status", "=", "Pending")
        .returning(["id"])
        .executeTakeFirst();

      if (!posted) {
        throw new Error("Inventory count is no longer pending");
      }
    });

    return { success: true };
  }
});

export default postInventoryCount;
