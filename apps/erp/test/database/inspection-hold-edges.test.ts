// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Goods-in inspection hold, the edges: what a count reports, a putaway pick
// after the stock left, an adjustment of a held batch, a repeated Reject, the
// restore of a rejected lot kept as is, a Partial whose NCR fails after the
// decision, a negative received quantity, and a Partial lot's remainder
// (void, return to a customer, its NCR closed), an NCR holding two lots, a
// Set Quantity of one stripe, and a second lot sharing a unit (a void, a
// Partial, an NCR's Scrap), and an NCR that scraps units of an open lot.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as inventory from "../../app/modules/inventory/inventory.server";
import {
  heldStockMovedByCount,
  insertReceiptPutAway,
  inspectionHoldAdjustmentRefusal,
  pickUntrackedStockTransferLines,
  postInventoryAdjustment,
  postReceipt,
  refuseShippingOpenLotStock,
  StockTransferPickRefusal
} from "../../app/modules/inventory/inventory.service";
import * as quality from "../../app/modules/quality/quality.server";
import {
  closeIssue,
  dispositionInspection
} from "../../app/modules/quality/quality.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  draftReceiptFromPurchaseOrder,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import {
  connectLocalTestDatabase,
  databaseTest,
  hasLocalDatabase
} from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

describe.skipIf(!hasLocalDatabase)("goods-in inspection hold edges", () => {
  let f: Fixture;
  let rejectedUnit: string;
  let shelf: string;
  const unitOf = (key: string) => `${f.prefix}-qc-${key}`;
  const UNIT_KEYS = [
    "count",
    "put",
    "batch",
    "reject",
    "keep",
    "short",
    "serial",
    "vpart",
    "two-a",
    "two-b",
    "rma",
    "stripe",
    "closed",
    "share",
    "partshare",
    "cap",
    "pa",
    "leg",
    "dual",
    "legheld",
    "legnet",
    "nobin",
    "legmove"
  ];

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
  const receiveInto = async (key: string, unitKey = key) => {
    const receiptId = await draftReceiptFromPurchaseOrder(f, key);
    await seed(f, (trx) =>
      trx
        .updateTable("receiptLine")
        .set({ storageUnitId: unitOf(unitKey) })
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
        countedShort: false,
        onHand: null,
        held: null
      });
      // The lot of 10 holds 10; the count left 7.
      expect(first[unitOf("count")]).toMatchObject({
        awaitingInspection: false,
        countedShort: true,
        onHand: 7,
        held: 10
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
    "Use As Is on a lot counted short restores only what the reject wrote off",
    async () => {
      await ensureIssueType();
      const { lotId } = await receiveInto("short");
      // A count found 4 of the lot's 10 missing from its unit.
      await seed(f, (trx) =>
        trx
          .insertInto("itemLedger")
          .values({
            entryType: "Negative Adjmt.",
            documentType: "Inventory Count",
            documentId: `${f.prefix}-short-count`,
            locationId: f.locationId,
            itemId: f.partId,
            storageUnitId: unitOf("short"),
            quantity: -4,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      const rejected = await withGuard(() =>
        quality.rejectInspection(stackContext(), {
          id: lotId,
          createNcr: true,
          reason: "Transit damage"
        })
      );
      expect(rejected.error).toBeNull();
      const issueId = rejected.data!.issueId!;
      expect(await untrackedAt(unitOf("short"))).toBe(0);

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
            .select(["storageUnitId", "quantity"])
            .where("documentType", "=", "Non-Conformance")
            .where("documentId", "=", issueId)
            .where("companyId", "=", f.companyId)
            .execute()
        ).map((row) => ({ ...row, quantity: Number(row.quantity) }))
      ).toEqual([{ storageUnitId: unitOf("short"), quantity: 6 }]);
    },
    60_000
  );

  // With no rejected unit, a Partial lot's remainder stays held where it was
  // received.
  const withoutRejectedUnit = async <T>(run: () => Promise<T>): Promise<T> => {
    const setRejected = (unit: string | null) =>
      seed(f, (trx) =>
        trx
          .updateTable("location")
          .set({ rejectedStorageUnitId: unit })
          .where("id", "=", f.locationId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
    await setRejected(null);
    try {
      return await run();
    } finally {
      await setRejected(rejectedUnit);
    }
  };

  /** A lot of 10 in its own unit, 6 accepted, 4 held under an open NCR. */
  const partialLot = async (key: string, unitKey = key) => {
    await ensureIssueType();
    const received = await receiveInto(key, unitKey);
    const partial = await withoutRejectedUnit(() =>
      withGuard(() =>
        quality.partialInspection(stackContext(), {
          id: received.lotId,
          acceptedQuantity: 6,
          createNcr: true
        })
      )
    );
    expect(partial.error).toBeNull();
    return { ...received, issueId: partial.data!.issueId! };
  };

  it.skipIf(!client)(
    "a receipt void refuses an untracked Partial lot",
    async () => {
      const { receiptId } = await partialLot("vpart");
      const voided = await withGuard(() =>
        invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "void", receiptId },
          postReceipt
        )
      );
      expect(voided.error).not.toBeNull();
      expect(await untrackedAt(unitOf("vpart"))).toBe(10);
    },
    60_000
  );

  it.skipIf(!client)(
    "a return to a customer cannot ship a Partial lot's held remainder; a supplier return can",
    async () => {
      await partialLot("rma");
      class Rollback extends Error {}
      // Ship 7 of the 10: 3 stay, below the 4 the Partial lot holds.
      const outcome = async (includePartial: boolean) => {
        try {
          await f.db.transaction().execute(async (trx) => {
            const row = {
              itemId: f.partId,
              storageUnitId: unitOf("rma"),
              quantity: -7
            };
            await trx
              .insertInto("itemLedger")
              .values({
                ...row,
                entryType: "Negative Adjmt.",
                documentType: "Inventory Count",
                documentId: `${f.prefix}-rma-ship`,
                locationId: f.locationId,
                companyId: f.companyId,
                createdBy: USER
              })
              .execute();
            await refuseShippingOpenLotStock(trx, f.companyId, [row], {
              includePartial
            });
            throw new Rollback();
          });
        } catch (error) {
          return error instanceof Rollback ? "ships" : "refused";
        }
        return "committed";
      };
      expect(await outcome(true)).toBe("refused");
      expect(await outcome(false)).toBe("ships");
    },
    60_000
  );

  it.skipIf(!client)(
    "a Partial lot keeps its storage unit while its NCR is open, and lets it go once the NCR closes",
    async () => {
      const { lotId, issueId } = await partialLot("closed");
      const clearUnit = () =>
        withGuard(() =>
          f.db
            .updateTable("inspection")
            .set({ storageUnitId: null })
            .where("id", "=", lotId)
            .where("companyId", "=", f.companyId)
            .execute()
        );
      await expect(clearUnit()).rejects.toThrow();

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
      await expect(clearUnit()).resolves.toBeDefined();
    },
    60_000
  );

  it.skipIf(!client)(
    "Use As Is on an NCR holding two rejected lots restores both",
    async () => {
      await ensureIssueType();
      const a = await receiveInto("two-a");
      const b = await receiveInto("two-b");
      const ctx = stackContext();
      const rejectedA = await withGuard(() =>
        quality.rejectInspection(ctx, {
          id: a.lotId,
          createNcr: true,
          reason: "Transit damage"
        })
      );
      expect(rejectedA.error).toBeNull();
      const rejectedB = await withGuard(() =>
        quality.rejectInspection(ctx, {
          id: b.lotId,
          createNcr: false,
          reason: "Transit damage"
        })
      );
      expect(rejectedB.error).toBeNull();
      const issueId = rejectedA.data!.issueId!;
      await seed(f, async (trx) => {
        await trx
          .insertInto("nonConformanceInspection")
          .values({
            nonConformanceId: issueId,
            inspectionId: b.lotId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Use As Is", quantity: 20 })
          .where("nonConformanceId", "=", issueId)
          .where("companyId", "=", f.companyId)
          .execute();
      });

      const closed = await withGuard(() =>
        closeIssue(client!, f.db, {
          nonConformanceId: issueId,
          companyId: f.companyId,
          userId: USER
        })
      );
      expect(closed.error).toBeNull();
      expect(await untrackedAt(unitOf("two-a"))).toBe(10);
      expect(await untrackedAt(unitOf("two-b"))).toBe(10);
    },
    60_000
  );

  it.skipIf(!client)(
    "a Set Quantity of one stripe counts the other stripes left in the unit",
    async () => {
      await receiveInto("stripe");
      const projectId = `${f.prefix}-stripe-project`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("project")
          .values({
            id: projectId,
            name: projectId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("itemLedger")
          .values({
            entryType: "Positive Adjmt.",
            documentType: "Inventory Count",
            documentId: `${f.prefix}-stripe-count`,
            locationId: f.locationId,
            itemId: f.partId,
            storageUnitId: unitOf("stripe"),
            projectId,
            quantity: 5,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      // The unit holds 10 common (all held by the open lot) and 5 of the project.
      const setTo = (quantity: number, stripe: string | null) =>
        inspectionHoldAdjustmentRefusal(f.db, f.companyId, {
          itemId: f.partId,
          storageUnitId: unitOf("stripe"),
          adjustmentType: "Set Quantity",
          quantity,
          projectId: stripe
        });
      // The project stripe to 3 leaves 13, still above the 10 held.
      expect(await setTo(3, projectId)).toBeNull();
      // The common stripe to 3 leaves 8.
      expect(await setTo(3, null)).not.toBeNull();
    },
    60_000
  );

  const moveOut = (storageUnitId: string, quantity: number, key: string) =>
    seed(f, (trx) =>
      trx
        .insertInto("itemLedger")
        .values({
          entryType: "Negative Adjmt.",
          documentType: "Inventory Count",
          documentId: `${f.prefix}-${key}`,
          locationId: f.locationId,
          itemId: f.partId,
          storageUnitId,
          quantity: -quantity,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );

  it.skipIf(!client)(
    "closing an NCR does not scrap a unit its open lot still holds",
    async () => {
      await ensureIssueType();
      const { item, unit } = await heldUnit("ncr-open", "Serial", "open");
      const issueId = `${f.prefix}-ncr-open`;
      await seed(f, async (trx) => {
        const type = await trx
          .selectFrom("nonConformanceType")
          .select("id")
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("nonConformance")
          .values({
            id: issueId,
            nonConformanceId: `${f.prefix}-NCR-OPEN`,
            name: "Scrap before the decision",
            source: "Internal",
            locationId: f.locationId,
            nonConformanceTypeId: type.id,
            openDate: f.today,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        const row = await trx
          .insertInto("nonConformanceItem")
          .values({
            nonConformanceId: issueId,
            itemId: item,
            disposition: "Scrap",
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("nonConformanceItemTrackedEntity")
          .values({
            nonConformanceId: issueId,
            nonConformanceItemId: row.id,
            trackedEntityId: unit,
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const closed = await withGuard(() =>
        closeIssue(client!, f.db, {
          nonConformanceId: issueId,
          companyId: f.companyId,
          userId: USER
        })
      );
      expect(closed.error).not.toBeNull();
      const after = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", unit)
        .executeTakeFirstOrThrow();
      expect(after.status).toBe("On Hold");
      const issue = await f.db
        .selectFrom("nonConformance")
        .select("status")
        .where("id", "=", issueId)
        .executeTakeFirstOrThrow();
      expect(issue.status).not.toBe("Closed");
    },
    60_000
  );

  it.skipIf(!client)(
    "a receipt void cannot take stock another receipt's open lot holds in the unit",
    async () => {
      const first = await receiveInto("share");
      // The first lot is accepted and its stock leaves the unit.
      const accepted = await withGuard(() =>
        dispositionInspection(f.db, {
          id: first.lotId,
          decision: "Accept",
          companyId: f.companyId,
          dispositionedBy: USER
        })
      );
      expect(accepted.error).toBeNull();
      await moveOut(unitOf("share"), 10, "share-away");
      // A second receipt's open lot now holds the unit's 10.
      await receiveInto("share-2", "share");

      const voided = await withGuard(() =>
        invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "void", receiptId: first.receiptId },
          postReceipt
        )
      );
      expect(voided.error).not.toBeNull();
      expect(await untrackedAt(unitOf("share"))).toBe(10);
    },
    60_000
  );

  it.skipIf(!client)(
    "an untracked Partial cannot keep another lot's stock as its remainder",
    async () => {
      await ensureIssueType();
      const first = await receiveInto("partshare");
      await receiveInto("partshare-2", "partshare");
      // A count found 6 missing: 14 there, the second lot holds 10.
      await moveOut(unitOf("partshare"), 6, "partshare-count");
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), {
          id: first.lotId,
          acceptedQuantity: 2,
          createNcr: true
        })
      );
      expect(partial.error).not.toBeNull();
      expect(await statusOf(first.lotId)).toBe("Pending");
      expect(await untrackedAt(unitOf("partshare"))).toBe(14);
    },
    60_000
  );

  it.skipIf(!client)(
    "an NCR's Scrap of a Partial lot writes off no more than the lot's remainder",
    async () => {
      const { issueId } = await partialLot("cap");
      // A second open lot holds 10 in the same unit.
      await receiveInto("cap-2", "cap");
      await seed(f, (trx) =>
        trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Scrap", quantity: 12 })
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
      // 20 received, 4 written off: the 6 accepted and the second lot's 10 stay.
      expect(await untrackedAt(unitOf("cap"))).toBe(16);
    },
    60_000
  );

  it.skipIf(!client)(
    "an NCR's Scrap of a Partial lot leaves what another Partial lot holds in a short unit",
    async () => {
      const first = await partialLot("pa");
      await partialLot("pa-2", "pa");
      // 20 received, each lot holds 4. A count found 13 missing: 7 there.
      await moveOut(unitOf("pa"), 13, "pa-count");
      await seed(f, (trx) =>
        trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Scrap" })
          .where("nonConformanceId", "=", first.issueId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const closed = await withGuard(() =>
        closeIssue(client!, f.db, {
          nonConformanceId: first.issueId,
          companyId: f.companyId,
          userId: USER
        })
      );
      expect(closed.error).toBeNull();
      // 3 written off: the second lot's 4 stay.
      expect(await untrackedAt(unitOf("pa"))).toBe(4);
    },
    60_000
  );

  it.skipIf(!client)(
    "two NCR closes at once in one short unit write off what is there, no less",
    async () => {
      const first = await partialLot("dual");
      const second = await partialLot("dual-2", "dual");
      // 20 received, each lot holds 4. A count found 13 missing: 7 there.
      await moveOut(unitOf("dual"), 13, "dual-count");
      await seed(f, (trx) =>
        trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Scrap" })
          .where("nonConformanceId", "in", [first.issueId, second.issueId])
          .where("companyId", "=", f.companyId)
          .execute()
      );
      // Each close on its own connection, as two users at once.
      const connect = async () => {
        const db = await connectLocalTestDatabase();
        await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
          db
        );
        return db;
      };
      const left = await connect();
      const right = await connect();
      try {
        const [a, b] = await Promise.all([
          closeIssue(client!, left, {
            nonConformanceId: first.issueId,
            companyId: f.companyId,
            userId: USER
          }),
          closeIssue(client!, right, {
            nonConformanceId: second.issueId,
            companyId: f.companyId,
            userId: USER
          })
        ]);
        expect(a.error).toBeNull();
        expect(b.error).toBeNull();
      } finally {
        await left.destroy();
        await right.destroy();
      }
      // The first close takes 3 (the other lot holds 4), the second the 4.
      expect(await untrackedAt(unitOf("dual"))).toBe(0);
    },
    60_000
  );

  it.skipIf(!client)(
    "a Partial of a lot from before the hold holds its remainder where it is",
    async () => {
      await ensureIssueType();
      const legacy = await receiveInto("legheld");
      await seed(f, (trx) =>
        trx
          .updateTable("inspection")
          .set({ storageUnitId: null })
          .where("id", "=", legacy.lotId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const partial = await withoutRejectedUnit(() =>
        withGuard(() =>
          quality.partialInspection(stackContext(), {
            id: legacy.lotId,
            acceptedQuantity: 6,
            createNcr: true
          })
        )
      );
      expect(partial.error).toBeNull();
      // The 4 rejected stay held: moving 7 of the 10 out leaves 3.
      await expect(
        withGuard(() =>
          f.db
            .insertInto("itemLedger")
            .values({
              entryType: "Negative Adjmt.",
              documentType: "Inventory Count",
              documentId: `${f.prefix}-legheld-out`,
              locationId: f.locationId,
              itemId: f.partId,
              storageUnitId: unitOf("legheld"),
              quantity: -7,
              companyId: f.companyId,
              createdBy: USER
            })
            .execute()
        )
      ).rejects.toThrow(/held for inspection/);
      expect(await untrackedAt(unitOf("legheld"))).toBe(10);
    },
    60_000
  );

  it.skipIf(!client)(
    "a lot from before the hold in a pickable bin: its Partial holds nothing there, even when the bin is short, and its NCR's Scrap writes off what is there",
    async () => {
      await ensureIssueType();
      const legacy = await receiveInto("legnet");
      // Before the hold, a lot recorded no unit, and its bin could be pickable.
      await seed(f, async (trx) => {
        await trx
          .updateTable("inspection")
          .set({ storageUnitId: null })
          .where("id", "=", legacy.lotId)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .updateTable("storageUnit")
          .set({ nettable: true, effectiveNettable: true })
          .where("id", "=", unitOf("legnet"))
          .where("companyId", "=", f.companyId)
          .execute();
      });
      const unit = await f.db
        .selectFrom("storageUnit")
        .select("effectiveNettable")
        .where("id", "=", unitOf("legnet"))
        .executeTakeFirstOrThrow();
      expect(unit.effectiveNettable).toBe(true);
      // 8 of the bin's 10 were picked to a job.
      await moveOut(unitOf("legnet"), 8, "legnet-picked");

      const partial = await withoutRejectedUnit(() =>
        withGuard(() =>
          quality.partialInspection(stackContext(), {
            id: legacy.lotId,
            acceptedQuantity: 6,
            createNcr: true
          })
        )
      );
      expect(partial.error).toBeNull();
      const lot = await f.db
        .selectFrom("inspection")
        .select("storageUnitId")
        .where("id", "=", legacy.lotId)
        .executeTakeFirstOrThrow();
      expect(lot.storageUnitId).toBeNull();

      const issueId = partial.data!.issueId!;
      await seed(f, (trx) =>
        trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Scrap" })
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
      // The Scrap writes off from the receipt line's bin, no more than is there.
      expect(await untrackedAt(unitOf("legnet"))).toBe(0);
    },
    60_000
  );

  it.skipIf(!client)(
    "an NCR's Scrap writes off a Partial lot's remainder received into no storage unit",
    async () => {
      await ensureIssueType();
      const legacy = await receiveInto("nobin");
      // A location without bins: the lot, its line and its stock have no unit.
      await seed(f, async (trx) => {
        await trx
          .updateTable("inspection")
          .set({ storageUnitId: null })
          .where("id", "=", legacy.lotId)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .updateTable("receiptLine")
          .set({ storageUnitId: null })
          .where("receiptId", "=", legacy.receiptId)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .updateTable("itemLedger")
          .set({ storageUnitId: null })
          .where("documentId", "=", legacy.receiptId)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      const noUnit = async () =>
        Number(
          (
            await f.db
              .selectFrom("itemLedger")
              .select(sql<number>`COALESCE(SUM("quantity"), 0)`.as("quantity"))
              .where("itemId", "=", f.partId)
              .where("storageUnitId", "is", null)
              .where("trackedEntityId", "is", null)
              .where("companyId", "=", f.companyId)
              .executeTakeFirstOrThrow()
          ).quantity
        );
      const before = await noUnit();
      const partial = await withoutRejectedUnit(() =>
        withGuard(() =>
          quality.partialInspection(stackContext(), {
            id: legacy.lotId,
            acceptedQuantity: 6,
            createNcr: true
          })
        )
      );
      expect(partial.error).toBeNull();
      const issueId = partial.data!.issueId!;
      await seed(f, (trx) =>
        trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Scrap" })
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
      expect(await noUnit()).toBe(before - 4);
    },
    60_000
  );

  it.skipIf(!client)(
    "a lot from before the hold in a short pickable bin cannot move to the rejected unit more than is there",
    async () => {
      await ensureIssueType();
      const legacy = await receiveInto("legmove");
      await seed(f, async (trx) => {
        await trx
          .updateTable("inspection")
          .set({ storageUnitId: null })
          .where("id", "=", legacy.lotId)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .updateTable("storageUnit")
          .set({ nettable: true, effectiveNettable: true })
          .where("id", "=", unitOf("legmove"))
          .where("companyId", "=", f.companyId)
          .execute();
      });
      await moveOut(unitOf("legmove"), 7, "legmove-picked");
      // The location has a rejected unit: 8 rejected would be held there,
      // but only 3 are in the bin.
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), {
          id: legacy.lotId,
          acceptedQuantity: 2,
          createNcr: true
        })
      );
      expect(partial.error).not.toBeNull();
      expect(await statusOf(legacy.lotId)).toBe("Pending");
      expect(await untrackedAt(unitOf("legmove"))).toBe(3);
    },
    60_000
  );

  it.skipIf(!client)(
    "a Partial of a lot from before the hold cannot keep another lot's stock",
    async () => {
      await ensureIssueType();
      const legacy = await receiveInto("leg");
      // Lots open before the hold recorded no storage unit.
      await seed(f, (trx) =>
        trx
          .updateTable("inspection")
          .set({ storageUnitId: null })
          .where("id", "=", legacy.lotId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      await receiveInto("leg-2", "leg");
      // 20 received, the second lot holds 10. A count found 8 missing: 12 there.
      await moveOut(unitOf("leg"), 8, "leg-count");
      // With no rejected unit nothing moves, so only the check stops it.
      const partial = await withoutRejectedUnit(() =>
        withGuard(() =>
          quality.partialInspection(stackContext(), {
            id: legacy.lotId,
            acceptedQuantity: 5,
            createNcr: true
          })
        )
      );
      expect(partial.error).not.toBeNull();
      expect(await untrackedAt(unitOf("leg"))).toBe(12);
    },
    60_000
  );

  it.skipIf(!client)(
    "an inspected receipt line refuses a negative received quantity; another line keeps it",
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

      await f.db
        .updateTable("receiptLine")
        .set({ requiresInspection: false })
        .where("id", "in", ids)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        (
          await inventory.updateReceiptLines(ctx, {
            ids,
            field: "receivedQuantity",
            value: "-5"
          })
        ).error
      ).toBeNull();
    },
    60_000
  );
});
