// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Goods-in inspection hold, the edges: what a count reports, a putaway pick
// after the stock left, an adjustment of a held batch, a repeated Reject, the
// restore of a rejected lot kept as is, a Partial whose NCR fails after the
// decision, and a negative received quantity.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as inventory from "../../app/modules/inventory/inventory.server";
import {
  heldStockMovedByCount,
  insertReceiptPutAway,
  pickUntrackedStockTransferLines,
  postInventoryAdjustment,
  postReceipt,
  StockTransferPickRefusal
} from "../../app/modules/inventory/inventory.service";
import * as quality from "../../app/modules/quality/quality.server";
import { closeIssue } from "../../app/modules/quality/quality.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  draftReceiptFromPurchaseOrder,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

describe.skipIf(!hasLocalDatabase)("goods-in inspection hold edges", () => {
  let f: Fixture;
  let rejectedUnit: string;
  let shelf: string;
  const unitOf = (key: string) => `${f.prefix}-qc-${key}`;
  const UNIT_KEYS = ["count", "put", "batch", "reject", "keep", "serial"];

  beforeAll(async () => {
    f = await alwaysPostFixture();
    rejectedUnit = `${f.prefix}-mrb`;
    shelf = `${f.prefix}-shelf`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values(
          [rejectedUnit, ...UNIT_KEYS.map(unitOf)].map((id) => ({
            id,
            name: id,
            locationId: f.locationId,
            nettable: false,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
      await trx
        .insertInto("storageUnit")
        .values({
          id: shelf,
          name: shelf,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .updateTable("location")
        .set({
          inspectionStorageUnitId: unitOf("count"),
          rejectedStorageUnitId: rejectedUnit
        })
        .where("id", "=", f.locationId)
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .insertInto("sequence")
        .values([
          {
            table: "inspection",
            name: "Inspection",
            prefix: "INS-",
            companyId: f.companyId
          },
          {
            table: "nonConformance",
            name: "Issue",
            prefix: "NCR",
            companyId: f.companyId
          },
          {
            table: "stockTransfer",
            name: "Stock Transfer",
            prefix: "ST-",
            companyId: f.companyId
          }
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      const document = await trx
        .insertInto("inspectionDocument")
        .values({ partId: f.partId, companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("itemInspectionDocumentAssignment")
        .values({
          itemId: f.partId,
          usage: "Receipt",
          inspectionDocumentId: document.id,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
  });

  afterAll(async () => {
    if (!f) return;
    // The plan's part link is RESTRICT; clear it before the company cascade.
    await seed(f, async (trx) => {
      await trx
        .deleteFrom("inspection")
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .deleteFrom("itemInspectionDocumentAssignment")
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .deleteFrom("inspectionDocument")
        .where("companyId", "=", f.companyId)
        .execute();
    });
    await f.cleanup();
  });

  // The fixture's connection runs with the sync flag on, which the guard and
  // the interceptors step aside for. Turn it off to reach them.
  const withGuard = async <T>(run: () => Promise<T>): Promise<T> => {
    await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
      f.db
    );
    try {
      return await run();
    } finally {
      await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
        f.db
      );
    }
  };

  // Operations that open an NCR or read through PostgREST need the local stack.
  const client = hasLocalDatabase ? localServiceRoleClient() : null;
  const stackContext = () =>
    createServiceContext({
      actor: { type: "system", onBehalfOf: USER },
      company: { id: f.companyId, groupId: f.groupId },
      caller: client!,
      system: () => client!,
      pg: () => f.db,
      kv: () => {
        throw new Error("No operation here reads the cache");
      }
    });

  // An NCR needs an issue type. Added by the tests that open one, after the
  // test that needs the company to have none.
  const ensureIssueType = () =>
    seed(f, (trx) =>
      trx
        .insertInto("nonConformanceType")
        .values({
          name: `${f.prefix}-type`,
          companyId: f.companyId,
          createdBy: USER
        })
        .onConflict((oc) => oc.doNothing())
        .execute()
    );

  /** 10 of the part received into a held unit; returns the receipt and lot. */
  const receiveInto = async (key: string) => {
    const receiptId = await draftReceiptFromPurchaseOrder(f, key);
    await seed(f, (trx) =>
      trx
        .updateTable("receiptLine")
        .set({ storageUnitId: unitOf(key) })
        .where("receiptId", "=", receiptId)
        .where("companyId", "=", f.companyId)
        .execute()
    );
    const posted = await invokePosting(
      handlesOf(f.ctx),
      "post-receipt",
      { type: "post", receiptId },
      postReceipt
    );
    expect(posted.error).toBeNull();
    const lot = await f.db
      .selectFrom("inspection")
      .select("id")
      .where("sourceDocumentId", "=", receiptId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    return { receiptId, lotId: lot.id };
  };

  const untrackedAt = async (storageUnitId: string) =>
    Number(
      (
        await f.db
          .selectFrom("itemLedger")
          .select(sql<number>`COALESCE(SUM("quantity"), 0)`.as("quantity"))
          .where("itemId", "=", f.partId)
          .where("storageUnitId", "=", storageUnitId)
          .where("trackedEntityId", "is", null)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).quantity
    );

  const statusOf = async (lotId: string) =>
    (
      await f.db
        .selectFrom("inspection")
        .select("status")
        .where("id", "=", lotId)
        .executeTakeFirstOrThrow()
    ).status;

  /** A serial or batch item with one On Hold unit on a held receipt line. */
  const heldUnit = async (
    key: string,
    trackingType: "Serial" | "Batch",
    lot: "open" | "none"
  ) => {
    const item = `${f.prefix}-item-${key}`;
    const line = `${f.prefix}-line-${key}`;
    const unit = `${f.prefix}-unit-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: item,
          readableId: `${f.prefix}-${key.toUpperCase()}`,
          name: key,
          type: "Part",
          itemTrackingType: trackingType,
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      const receipt = await trx
        .insertInto("receipt")
        .values({
          receiptId: `${f.prefix}-RE-${key}`,
          locationId: f.locationId,
          sourceDocument: "Purchase Order",
          status: "Posted",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("receiptLine")
        .values({
          id: line,
          receiptId: receipt.id,
          itemId: item,
          locationId: f.locationId,
          storageUnitId: unitOf("batch"),
          orderQuantity: 5,
          receivedQuantity: 5,
          unitOfMeasure: "EA",
          unitPrice: 0,
          requiresInspection: lot === "open",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("trackedEntity")
        .values({
          id: unit,
          readableId: `${f.prefix}-${key}-1`,
          itemId: item,
          quantity: trackingType === "Batch" ? 5 : 1,
          status: "On Hold",
          sourceDocument: "Receipt",
          sourceDocumentId: receipt.id,
          attributes: JSON.stringify({ "Receipt Line": line }),
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("itemLedger")
        .values({
          entryType: "Positive Adjmt.",
          documentType: "Purchase Receipt",
          documentId: receipt.id,
          itemId: item,
          locationId: f.locationId,
          storageUnitId: unitOf("batch"),
          trackedEntityId: unit,
          quantity: trackingType === "Batch" ? 5 : 1,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      if (lot === "open") {
        await trx
          .insertInto("inspection")
          .values({
            inspectionId: `${f.prefix}-INS-${key}`,
            itemId: item,
            lotSize: 5,
            samplingStandard: "ANSI_Z1_4",
            samplingPlanType: "All",
            sampleSize: 5,
            acceptanceNumber: 0,
            rejectionNumber: 1,
            sourceDocument: "Receipt",
            sourceDocumentId: receipt.id,
            sourceDocumentLineId: line,
            storageUnitId: unitOf("batch"),
            status: "Pending",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      }
    });
    return { item, unit };
  };

  databaseTest(
    "a posted count flags held stock it took: an open lot's unit, a short inspection unit, stock found elsewhere",
    async () => {
      const countId = `${f.prefix}-count`;
      const { lotId } = await receiveInto("count");
      const awaiting = await heldUnit("awaiting", "Serial", "open");
      // On Hold for a customer return: no lot, not held for inspection.
      const returned = await heldUnit("returned", "Serial", "none");
      const moveOut = (
        rows: Array<{
          itemId: string;
          storageUnitId: string;
          trackedEntityId?: string;
          quantity: number;
        }>
      ) =>
        seed(f, (trx) =>
          trx
            .insertInto("itemLedger")
            .values(
              rows.map((row) => ({
                entryType: "Negative Adjmt." as const,
                documentType: "Inventory Count" as const,
                documentId: countId,
                locationId: f.locationId,
                trackedEntityId: row.trackedEntityId ?? null,
                itemId: row.itemId,
                storageUnitId: row.storageUnitId,
                quantity: row.quantity,
                companyId: f.companyId,
                createdBy: USER
              }))
            )
            .execute()
        );
      await moveOut([
        { itemId: f.partId, storageUnitId: unitOf("count"), quantity: -3 },
        {
          itemId: awaiting.item,
          storageUnitId: unitOf("batch"),
          trackedEntityId: awaiting.unit,
          quantity: -1
        },
        {
          itemId: returned.item,
          storageUnitId: unitOf("batch"),
          trackedEntityId: returned.unit,
          quantity: -1
        }
      ]);
      const warnings = () =>
        heldStockMovedByCount(f.db, f.companyId, countId, [
          awaiting.unit,
          returned.unit
        ]);
      const byUnit = async () =>
        Object.fromEntries((await warnings()).map((row) => [row.unit, row]));
      const first = await byUnit();
      expect(Object.keys(first).sort()).toEqual(
        [unitOf("batch"), unitOf("count")].sort()
      );
      expect(first[unitOf("batch")]).toEqual({
        part: `${f.prefix}-AWAITING`,
        unit: unitOf("batch"),
        awaitingInspection: true,
        countedShort: false
      });
      expect(first[unitOf("count")]).toMatchObject({
        awaitingInspection: false,
        countedShort: true
      });

      // The same count found the 3 on the shelf: stock found elsewhere.
      await moveOut([
        { itemId: f.partId, storageUnitId: shelf, quantity: 3 }
      ]);
      expect((await byUnit())[unitOf("count")]).toMatchObject({
        countedShort: false
      });
      expect(await statusOf(lotId)).toBe("Pending");
    }
  );

  databaseTest(
    "a putaway pick takes no more than is still in its unit; an ordinary pick is unchanged",
    async () => {
      const { receiptId, lotId } = await receiveInto("put");
      // Accepted (the fixture's writes run as a sync, past the lot check).
      await seed(f, (trx) =>
        trx
          .updateTable("inspection")
          .set({ status: "Passed" })
          .where("id", "=", lotId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const result = await insertReceiptPutAway(f.db, {
        companyId: f.companyId,
        userId: USER,
        receiptId
      });
      if (!("created" in result)) throw new Error(result.refusal);
      // An ordinary move takes 9 of the 10 before the putaway is picked.
      expect(
        (
          await withGuard(() =>
            invokePosting(
              handlesOf(f.ctx),
              "post-inventory-adjustment",
              {
                adjustmentType: "Negative Adjmt.",
                itemId: f.partId,
                locationId: f.locationId,
                storageUnitId: unitOf("put"),
                quantity: 9
              },
              postInventoryAdjustment
            )
          )
        ).error
      ).toBeNull();

      const shelfBefore = await untrackedAt(shelf);
      const pickAll = () =>
        withGuard(() =>
          pickUntrackedStockTransferLines(f.db, {
            stockTransferId: result.created.id,
            companyId: f.companyId,
            userId: USER
          })
        );
      await expect(pickAll()).rejects.toBeInstanceOf(StockTransferPickRefusal);
      expect(await untrackedAt(unitOf("put"))).toBe(1);
      expect(await untrackedAt(shelf)).toBe(shelfBefore);

      // A transfer line that is not a putaway still picks as before.
      const ordinary = await f.db
        .insertInto("stockTransfer")
        .values({
          stockTransferId: `${f.prefix}-ST-ORD`,
          locationId: f.locationId,
          status: "Released",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await f.db
        .insertInto("stockTransferLine")
        .values({
          stockTransferId: ordinary.id,
          itemId: f.partId,
          quantity: 2,
          fromStorageUnitId: unitOf("put"),
          toStorageUnitId: shelf,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      expect(
        await withGuard(() =>
          pickUntrackedStockTransferLines(f.db, {
            stockTransferId: ordinary.id,
            companyId: f.companyId,
            userId: USER
          })
        )
      ).toHaveLength(1);
      expect(await untrackedAt(unitOf("put"))).toBe(-1);
    }
  );

  databaseTest(
    "a batch held for inspection refuses a positive adjustment",
    async () => {
      const held = await heldUnit("held-batch", "Batch", "open");
      const adjusted = await withGuard(() =>
        invokePosting(
          handlesOf(f.ctx),
          "post-inventory-adjustment",
          {
            adjustmentType: "Positive Adjmt.",
            itemId: held.item,
            locationId: f.locationId,
            storageUnitId: unitOf("batch"),
            trackedEntityId: held.unit,
            quantity: 2
          },
          postInventoryAdjustment
        )
      );
      expect(adjusted.error?.message).toMatch(/held for inspection/);
      expect(
        await f.db
          .selectFrom("trackedEntity")
          .select("quantity")
          .where("id", "=", held.unit)
          .executeTakeFirstOrThrow()
      ).toEqual({ quantity: 5 });
    }
  );

  it.skipIf(!client)(
    "a serial Partial whose NCR fails to open reports the decision as made",
    async () => {
      // A serial lot: one unit failed, one passed, sampling complete.
      const units = ["p", "q"].map((k) => `${f.prefix}-sn-${k}`);
      const line = `${f.prefix}-line-serial`;
      const item = `${f.prefix}-item-serial`;
      const lot = `${f.prefix}-lot-serial`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: item,
            readableId: `${f.prefix}-SERIAL`,
            name: "serial",
            type: "Part",
            itemTrackingType: "Serial",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        const receipt = await trx
          .insertInto("receipt")
          .values({
            receiptId: `${f.prefix}-RE-SERIAL`,
            locationId: f.locationId,
            sourceDocument: "Purchase Order",
            status: "Posted",
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("receiptLine")
          .values({
            id: line,
            receiptId: receipt.id,
            itemId: item,
            locationId: f.locationId,
            storageUnitId: unitOf("serial"),
            orderQuantity: 2,
            receivedQuantity: 2,
            unitOfMeasure: "EA",
            unitPrice: 0,
            requiresInspection: true,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("trackedEntity")
          .values(
            units.map((id) => ({
              id,
              itemId: item,
              quantity: 1,
              status: "On Hold" as const,
              sourceDocument: "Receipt",
              sourceDocumentId: receipt.id,
              attributes: JSON.stringify({ "Receipt Line": line }),
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
        await trx
          .insertInto("inspection")
          .values({
            id: lot,
            inspectionId: `${f.prefix}-INS-SERIAL`,
            itemId: item,
            lotSize: 2,
            samplingStandard: "ANSI_Z1_4",
            samplingPlanType: "All",
            sampleSize: 2,
            acceptanceNumber: 0,
            rejectionNumber: 1,
            sourceDocument: "Receipt",
            sourceDocumentId: receipt.id,
            sourceDocumentLineId: line,
            storageUnitId: unitOf("serial"),
            status: "In Progress",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("inspectionSample")
          .values([
            {
              inspectionId: lot,
              trackedEntityId: units[0]!,
              status: "Failed" as const,
              companyId: f.companyId,
              createdBy: USER
            },
            {
              inspectionId: lot,
              trackedEntityId: units[1]!,
              status: "Passed" as const,
              companyId: f.companyId,
              createdBy: USER
            }
          ])
          .execute();
      });
      // The company has no issue type yet, so the NCR cannot open.
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), { id: lot, createNcr: true })
      );
      expect(partial.error?.message).toMatch(/marked partial/);
      expect(await statusOf(lot)).toBe("Partial");
    },
    60_000
  );

  it.skipIf(!client)(
    "a repeated Reject keeps the lot's one NCR",
    async () => {
      await ensureIssueType();
      const { lotId } = await receiveInto("reject");
      const ctx = stackContext();
      const reject = () =>
        withGuard(() =>
          quality.rejectInspection(ctx, {
            id: lotId,
            createNcr: true,
            reason: "Suspected counterfeit"
          })
        );
      const first = await reject();
      expect(first.error).toBeNull();
      const second = await reject();
      expect(second.error).toBeNull();
      expect(second.data?.issueId).toBe(first.data?.issueId);
      expect(
        await f.db
          .selectFrom("nonConformanceInspection")
          .select("nonConformanceId")
          .where("inspectionId", "=", lotId)
          .execute()
      ).toEqual([{ nonConformanceId: first.data!.issueId }]);
    },
    60_000
  );

  it.skipIf(!client)(
    "Use As Is puts a rejected lot back where the reject wrote it off",
    async () => {
      await ensureIssueType();
      const { lotId } = await receiveInto("keep");
      const ctx = stackContext();
      const rejected = await withGuard(() =>
        quality.rejectInspection(ctx, {
          id: lotId,
          createNcr: true,
          reason: "Transit damage"
        })
      );
      expect(rejected.error).toBeNull();
      const issueId = rejected.data!.issueId!;
      expect(await untrackedAt(unitOf("keep"))).toBe(0);

      await seed(f, (trx) =>
        trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Use As Is" })
          .where("nonConformanceId", "=", issueId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const closed = await withGuard(() =>
        closeIssue(client!, f.db, {
          nonConformanceId: issueId,
          companyId: f.companyId,
          userId: USER
        })
      );
      expect(closed.error).toBeNull();
      expect(
        (
          await f.db
            .selectFrom("itemLedger")
            .select(["storageUnitId", "projectId", "quantity"])
            .where("documentType", "=", "Non-Conformance")
            .where("documentId", "=", issueId)
            .where("companyId", "=", f.companyId)
            .execute()
        ).map((row) => ({ ...row, quantity: Number(row.quantity) }))
      ).toEqual([{ storageUnitId: unitOf("keep"), projectId: null, quantity: 10 }]);
      expect(await untrackedAt(unitOf("keep"))).toBe(10);
    },
    60_000
  );

  it.skipIf(!client)(
    "a receipt line refuses a negative received quantity",
    async () => {
      const receiptId = await draftReceiptFromPurchaseOrder(f, "negative");
      const lines = await f.db
        .selectFrom("receiptLine")
        .select("id")
        .where("receiptId", "=", receiptId)
        .where("companyId", "=", f.companyId)
        .execute();
      const ids = lines.map((line) => line.id);
      const ctx = stackContext();
      const negative = await inventory.updateReceiptLines(ctx, {
        ids,
        field: "receivedQuantity",
        value: "-5"
      });
      expect(negative.error).not.toBeNull();
      expect(
        (
          await inventory.updateReceiptLines(ctx, {
            ids,
            field: "receivedQuantity",
            value: "3"
          })
        ).error
      ).toBeNull();
      expect(
        await f.db
          .selectFrom("receiptLine")
          .select("receivedQuantity")
          .where("id", "in", ids)
          .execute()
      ).toEqual([{ receivedQuantity: 3 }]);
    },
    60_000
  );
});
