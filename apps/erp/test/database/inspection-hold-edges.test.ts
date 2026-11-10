// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { dispositionInspection as dispositionWithReason } from "@carbon/database/quality";
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
  postShipment,
  postStockTransfer,
  receiptLinesOpeningLots,
  refuseShippingOpenLotStock,
  StockTransferPickRefusal
} from "../../app/modules/inventory/inventory.service";
import * as quality from "../../app/modules/quality/quality.server";
import {
  closeIssue,
  dispositionInspection
} from "../../app/modules/quality/quality.service";
import {
  invokeCreate,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  draftReceiptFromPurchaseOrder,
  type Fixture,
  seed,
  USER,
  unwrap
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
    "legmove",
    "link-a",
    "link-b",
    "link-c",
    "mix-a",
    "mix-b",
    "again",
    "retry",
    "norow",
    "reopen",
    "track",
    "void-pa",
    "pa-to",
    "ncr-msg",
    "pa-site",
    "rel-link",
    "two-p",
    "pa-draft",
    "move-a",
    "move-b",
    "move-c",
    "pa-two",
    "share-a",
    "share-b",
    "shut",
    "legfail",
    "void-pk",
    "passed-ncr",
    "mix-j",
    "pa-held",
    "ship"
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
      expect(first[unitOf("count")]).toMatchObject({
        awaitingInspection: false,
        countedShort: true,
        onHand: 7,
        held: 10
      });

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
    "a serial Partial with no issue type is refused before the lot closes",
    async () => {
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
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), { id: lot, createNcr: true })
      );
      expect(partial.error?.message).toMatch(/issue type/);
      expect(await statusOf(lot)).toBe("In Progress");
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
      expect(voided.error?.message).toMatch(/accepted part of this stock/);
      expect(await untrackedAt(unitOf("vpart"))).toBe(10);
    },
    60_000
  );

  it.skipIf(!client)(
    "a return to a customer cannot ship a Partial lot's held remainder; a supplier return can",
    async () => {
      await partialLot("rma");
      class Rollback extends Error {}
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
      await expect(clearUnit()).rejects.toThrow(/inspection decision/);

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
      await clearUnit();
      const cleared = await f.db
        .selectFrom("inspection")
        .select("storageUnitId")
        .where("id", "=", lotId)
        .executeTakeFirstOrThrow();
      expect(cleared.storageUnitId).toBeNull();
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
      const setTo = (quantity: number, stripe: string | null) =>
        inspectionHoldAdjustmentRefusal(f.db, f.companyId, {
          itemId: f.partId,
          storageUnitId: unitOf("stripe"),
          adjustmentType: "Set Quantity",
          quantity,
          projectId: stripe
        });
      expect(await setTo(3, projectId)).toBeNull();
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
      await receiveInto("share-2", "share");

      const voided = await withGuard(() =>
        invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "void", receiptId: first.receiptId },
          postReceipt
        )
      );
      expect(voided.error?.status).toBe(400);
      expect(voided.error?.message).toMatch(
        /^Cannot void: .* is held for inspection in /
      );
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
      await moveOut(unitOf("partshare"), 6, "partshare-count");
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), {
          id: first.lotId,
          acceptedQuantity: 2,
          createNcr: true
        })
      );
      expect(partial.error?.message).toMatch(/in the held storage unit/);
      expect(await statusOf(first.lotId)).toBe("Pending");
      expect(await untrackedAt(unitOf("partshare"))).toBe(14);
    },
    60_000
  );

  it.skipIf(!client)(
    "an NCR's Scrap of a Partial lot writes off no more than the lot's remainder",
    async () => {
      const { issueId } = await partialLot("cap");
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
      expect(await untrackedAt(unitOf("cap"))).toBe(16);
      expect(closed.data?.warning).toMatch(
        /^4 of 12 set to Scrap written off: the lot holds only 4 rejected\.$/
      );
    },
    60_000
  );

  it.skipIf(!client)(
    "an NCR's Scrap of a Partial lot leaves what another Partial lot holds in a short unit",
    async () => {
      const first = await partialLot("pa");
      await partialLot("pa-2", "pa");
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
      expect(await untrackedAt(unitOf("pa"))).toBe(4);
      expect(closed.data?.warning).toMatch(/^3 of 4 set to Scrap written off: 1 is not in /);
    },
    60_000
  );

  it.skipIf(!client)(
    "two NCR closes at once in one short unit write off what is there, no less",
    async () => {
      const first = await partialLot("dual");
      const second = await partialLot("dual-2", "dual");
      await moveOut(unitOf("dual"), 13, "dual-count");
      await seed(f, (trx) =>
        trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Scrap" })
          .where("nonConformanceId", "in", [first.issueId, second.issueId])
          .where("companyId", "=", f.companyId)
          .execute()
      );
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
      expect(await untrackedAt(unitOf("legnet"))).toBe(0);
    },
    60_000
  );

  it.skipIf(!client)(
    "an NCR's Scrap writes off a Partial lot's remainder received into no storage unit",
    async () => {
      await ensureIssueType();
      const legacy = await receiveInto("nobin");
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
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), {
          id: legacy.lotId,
          acceptedQuantity: 2,
          createNcr: true
        })
      );
      expect(partial.error?.message).toMatch(/in the held storage unit/);
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
      await seed(f, (trx) =>
        trx
          .updateTable("inspection")
          .set({ storageUnitId: null })
          .where("id", "=", legacy.lotId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      await receiveInto("leg-2", "leg");
      await moveOut(unitOf("leg"), 8, "leg-count");
      const partial = await withoutRejectedUnit(() =>
        withGuard(() =>
          quality.partialInspection(stackContext(), {
            id: legacy.lotId,
            acceptedQuantity: 5,
            createNcr: true
          })
        )
      );
      expect(partial.error?.message).toMatch(/in the held storage unit/);
      expect(await untrackedAt(unitOf("leg"))).toBe(12);
    },
    60_000
  );

  const createIssueFor = async (item: string, units: string[]) => {
    const type = await f.db
      .selectFrom("nonConformanceType")
      .select("id")
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    const created = await withGuard(() =>
      quality.createIssue(stackContext(), {
        name: "Failed units",
        priority: "Medium",
        source: "Internal",
        locationId: f.locationId,
        nonConformanceTypeId: type.id,
        openDate: f.today,
        items: [item],
        trackedEntityIds: units
      })
    );
    expect(created.error).toBeNull();
    return created.data!.id;
  };
  const scrapAndClose = async (issueId: string) => {
    await seed(f, (trx) =>
      trx
        .updateTable("nonConformanceItem")
        .set({ disposition: "Scrap" })
        .where("nonConformanceId", "=", issueId)
        .where("companyId", "=", f.companyId)
        .execute()
    );
    return withGuard(() =>
      closeIssue(client!, f.db, {
        nonConformanceId: issueId,
        companyId: f.companyId,
        userId: USER
      })
    );
  };
  const unitStatus = async (unit: string) =>
    (
      await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", unit)
        .executeTakeFirstOrThrow()
    ).status;

  it.skipIf(!client)(
    "an issue created for a serial unit links it to the item's row, so its Scrap writes the unit off",
    async () => {
      await ensureIssueType();
      const { item, unit } = await heldUnit("ci-free", "Serial", "none");
      const issueId = await createIssueFor(item, [unit]);
      expect(
        await f.db
          .selectFrom("nonConformanceItemTrackedEntity")
          .select(["trackedEntityId", "quantity"])
          .where("nonConformanceId", "=", issueId)
          .execute()
      ).toEqual([{ trackedEntityId: unit, quantity: 1 }]);

      const closed = await scrapAndClose(issueId);
      expect(closed.error).toBeNull();
      expect(await unitStatus(unit)).toBe("Rejected");
      expect(
        (
          await f.db
            .selectFrom("itemLedger")
            .select("quantity")
            .where("documentType", "=", "Non-Conformance")
            .where("documentId", "=", issueId)
            .where("trackedEntityId", "=", unit)
            .execute()
        ).map((row) => Number(row.quantity))
      ).toEqual([-1]);
    },
    60_000
  );

  it.skipIf(!client)(
    "an issue created for units of two items puts each on its own item's row, a batch at its quantity",
    async () => {
      await ensureIssueType();
      const serial = await heldUnit("ci-two-s", "Serial", "none");
      const batch = await heldUnit("ci-two-b", "Batch", "none");
      const issueId = await createIssueFor(serial.item, [
        serial.unit,
        batch.unit
      ]);
      const rows = await f.db
        .selectFrom("nonConformanceItem as r")
        .innerJoin("nonConformanceItemTrackedEntity as l", (join) =>
          join.onRef("l.nonConformanceItemId", "=", "r.id")
        )
        .select(["r.itemId", "r.quantity", "l.trackedEntityId"])
        .where("r.nonConformanceId", "=", issueId)
        .execute();
      expect(
        rows
          .map((row) => ({ ...row, quantity: Number(row.quantity) }))
          .sort((a, b) => a.itemId.localeCompare(b.itemId))
      ).toEqual(
        [
          { itemId: serial.item, quantity: 1, trackedEntityId: serial.unit },
          { itemId: batch.item, quantity: 5, trackedEntityId: batch.unit }
        ].sort((a, b) => a.itemId.localeCompare(b.itemId))
      );
    },
    60_000
  );

  it.skipIf(!client)(
    "a unit on two issues' rows is written off once, and a unit out of stock goes on no row",
    async () => {
      await ensureIssueType();
      const { item, unit } = await heldUnit("ci-twice", "Serial", "none");
      const linkedRows = (issueId: string) =>
        f.db
          .selectFrom("nonConformanceItemTrackedEntity")
          .select("trackedEntityId")
          .where("nonConformanceId", "=", issueId)
          .execute();
      const first = await createIssueFor(item, [unit]);
      const second = await createIssueFor(item, [unit]);
      expect(await linkedRows(first)).toEqual([{ trackedEntityId: unit }]);
      expect(await linkedRows(second)).toEqual([{ trackedEntityId: unit }]);
      expect((await scrapAndClose(first)).error).toBeNull();
      const closedSecond = await scrapAndClose(second);
      expect(closedSecond.error).toBeNull();
      expect(closedSecond.data?.warning).toMatch(
        /^1 tracked unit set to Scrap or Return had less stock than linked: only what was there was written off\./
      );
      const writeOffs = async () =>
        (
          await f.db
            .selectFrom("itemLedger")
            .select("quantity")
            .where("trackedEntityId", "=", unit)
            .where("documentType", "=", "Non-Conformance")
            .execute()
        ).map((row) => Number(row.quantity));
      expect(await writeOffs()).toEqual([-1]);
      const third = await createIssueFor(item, [unit]);
      expect(await linkedRows(third)).toEqual([]);
      expect((await scrapAndClose(third)).error).toBeNull();
      expect(await writeOffs()).toEqual([-1]);
    },
    60_000
  );

  it.skipIf(!client)(
    "Use As Is on a second issue leaves a unit another issue scrapped as it is",
    async () => {
      await ensureIssueType();
      const { item, unit } = await heldUnit("ci-keep", "Serial", "none");
      const first = await createIssueFor(item, [unit]);
      const second = await createIssueFor(item, [unit]);
      expect((await scrapAndClose(first)).error).toBeNull();
      expect(await unitStatus(unit)).toBe("Rejected");
      await seed(f, (trx) =>
        trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Use As Is" })
          .where("nonConformanceId", "=", second)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const closed = await withGuard(() =>
        closeIssue(client!, f.db, {
          nonConformanceId: second,
          companyId: f.companyId,
          userId: USER
        })
      );
      expect(closed.error).toBeNull();
      expect(await unitStatus(unit)).toBe("Rejected");
      expect(closed.data?.warning).toMatch(/left as it was: no stock left/);
    },
    60_000
  );

  const nonConformanceWriteOffs = (unit: string) =>
    f.db
      .selectFrom("itemLedger")
      .select(["quantity", "locationId", "storageUnitId"])
      .where("trackedEntityId", "=", unit)
      .where("documentType", "=", "Non-Conformance")
      .execute()
      .then((rows) =>
        rows.map((row) => ({ ...row, quantity: Number(row.quantity) }))
      );

  it.skipIf(!client)(
    "a unit in stock that no receipt brought in is written off at its bin, and once",
    async () => {
      await ensureIssueType();
      const { item, unit } = await heldUnit("ci-adjusted", "Serial", "none");
      await seed(f, (trx) =>
        trx
          .updateTable("trackedEntity")
          .set({ attributes: JSON.stringify({}) })
          .where("id", "=", unit)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const first = await createIssueFor(item, [unit]);
      const second = await createIssueFor(item, [unit]);
      expect((await scrapAndClose(first)).error).toBeNull();
      expect(await nonConformanceWriteOffs(unit)).toEqual([
        {
          quantity: -1,
          locationId: f.locationId,
          storageUnitId: unitOf("batch")
        }
      ]);
      const closedSecond = await scrapAndClose(second);
      expect(closedSecond.error).toBeNull();
      expect(closedSecond.data?.warning).toMatch(
        /^1 tracked unit set to Scrap or Return had less stock than linked: only what was there was written off\./
      );
      expect(await nonConformanceWriteOffs(unit)).toHaveLength(1);
    },
    60_000
  );

  it.skipIf(!client)(
    "a unit never in stock stays an association, and on a row its Scrap keeps the older rule",
    async () => {
      await ensureIssueType();
      const item = `${f.prefix}-item-ci-wip`;
      const unit = `${f.prefix}-unit-ci-wip`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: item,
            readableId: `${f.prefix}-CI-WIP`,
            name: "ci-wip",
            type: "Part",
            itemTrackingType: "Serial",
            replenishmentSystem: "Make",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("trackedEntity")
          .values({
            id: unit,
            readableId: `${f.prefix}-ci-wip-1`,
            itemId: item,
            quantity: 1,
            status: "Reserved",
            sourceDocument: "Job",
            sourceDocumentId: `${f.prefix}-job-ci-wip`,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const issueId = await createIssueFor(item, [unit]);
      expect(
        await f.db
          .selectFrom("nonConformanceItemTrackedEntity")
          .select("trackedEntityId")
          .where("nonConformanceId", "=", issueId)
          .execute()
      ).toEqual([]);
      expect(
        await f.db
          .selectFrom("nonConformanceTrackedEntity")
          .select("trackedEntityId")
          .where("nonConformanceId", "=", issueId)
          .execute()
      ).toEqual([{ trackedEntityId: unit }]);
      await seed(f, async (trx) => {
        const row = await trx
          .selectFrom("nonConformanceItem")
          .select("id")
          .where("nonConformanceId", "=", issueId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("nonConformanceItemTrackedEntity")
          .values({
            nonConformanceItemId: row.id,
            nonConformanceId: issueId,
            trackedEntityId: unit,
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("nonConformanceItem")
          .set({ quantity: 1 })
          .where("id", "=", row.id)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      const closed = await scrapAndClose(issueId);
      expect(closed.error).toBeNull();
      expect(closed.data?.warning).toBeUndefined();
      expect(await nonConformanceWriteOffs(unit)).toEqual([
        { quantity: -1, locationId: f.locationId, storageUnitId: null }
      ]);
    },
    60_000
  );

  it.skipIf(!client)(
    "an issue created for a unit of a still-open lot cannot scrap it",
    async () => {
      await ensureIssueType();
      const { item, unit } = await heldUnit("ci-open", "Serial", "open");
      const issueId = await createIssueFor(item, [unit]);
      const closed = await scrapAndClose(issueId);
      expect(closed.error?.message).toMatch(/held for inspection/);
      expect(await unitStatus(unit)).toBe("On Hold");
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

  it.skipIf(!client)(
    "a receipt lot belongs to one NCR",
    async () => {
      const first = await partialLot("link-a");
      const second = await partialLot("link-b");
      await expect(
        withGuard(() =>
          f.db
            .insertInto("nonConformanceInspection")
            .values({
              nonConformanceId: second.issueId,
              inspectionId: first.lotId,
              companyId: f.companyId,
              createdBy: USER
            })
            .execute()
        )
      ).rejects.toThrow(/already has its NCR/);
    },
    60_000
  );

  it.skipIf(!client)(
    "a Partial lot is the only lot on its NCR",
    async () => {
      const partial = await partialLot("link-c");
      const other = await receiveInto("mix-a");
      await expect(
        withGuard(() =>
          f.db
            .insertInto("nonConformanceInspection")
            .values({
              nonConformanceId: partial.issueId,
              inspectionId: other.lotId,
              companyId: f.companyId,
              createdBy: USER
            })
            .execute()
        )
      ).rejects.toThrow(/only lot on its NCR/);
    },
    60_000
  );

  it.skipIf(!client)(
    "closing an NCR that holds a Partial lot beside another lot is refused",
    async () => {
      const partial = await partialLot("mix-b");
      const other = await receiveInto("mix-b-2", "mix-b");
      await seed(f, async (trx) => {
        await trx
          .insertInto("nonConformanceInspection")
          .values({
            nonConformanceId: partial.issueId,
            inspectionId: other.lotId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("nonConformanceItem")
          .set({ disposition: "Scrap" })
          .where("nonConformanceId", "=", partial.issueId)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      const closed = await withGuard(() =>
        closeIssue(client!, f.db, {
          nonConformanceId: partial.issueId,
          companyId: f.companyId,
          userId: USER
        })
      );
      expect(closed.error?.message).toMatch(/only lot on its NCR/);
      expect(await untrackedAt(unitOf("mix-b"))).toBe(20);
    },
    60_000
  );

  it.skipIf(!client)(
    "a Partial lot's NCR cannot close with no disposition for the rest",
    async () => {
      const { issueId, lotId } = await partialLot("norow");
      await seed(f, (trx) =>
        trx
          .deleteFrom("nonConformanceItem")
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
      expect(closed.error?.message).toMatch(/disposition/);
      expect(await statusOf(lotId)).toBe("Partial");
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
    "a closed NCR that released a Partial lot's remainder cannot be reopened",
    async () => {
      const { issueId } = await partialLot("reopen");
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
      await expect(
        withGuard(() =>
          f.db
            .updateTable("nonConformance")
            .set({ status: "Registered" })
            .where("id", "=", issueId)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/cannot be reopened/);
    },
    60_000
  );

  it.skipIf(!client)(
    "a repeated Reject writes off nothing that arrived since the lot failed",
    async () => {
      await ensureIssueType();
      const { lotId } = await receiveInto("again");
      await moveOut(unitOf("again"), 10, "again-count");
      const reject = () =>
        withGuard(() =>
          quality.rejectInspection(stackContext(), {
            id: lotId,
            createNcr: false,
            reason: "Transit damage"
          })
        );
      expect((await reject()).error).toBeNull();
      expect(await statusOf(lotId)).toBe("Failed");
      await seed(f, (trx) =>
        trx
          .insertInto("itemLedger")
          .values({
            entryType: "Positive Adjmt.",
            documentType: "Inventory Count",
            documentId: `${f.prefix}-again-in`,
            locationId: f.locationId,
            itemId: f.partId,
            storageUnitId: unitOf("again"),
            quantity: 5,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      expect((await reject()).error).toBeNull();
      expect(await untrackedAt(unitOf("again"))).toBe(5);
    },
    60_000
  );

  it.skipIf(!client)(
    "a repeated Reject keeps the original decision on record",
    async () => {
      await ensureIssueType();
      const { lotId } = await receiveInto("retry");
      const reject = (reason: string) =>
        withGuard(() =>
          quality.rejectInspection(stackContext(), {
            id: lotId,
            createNcr: false,
            reason
          })
        );
      expect((await reject("Transit damage")).error).toBeNull();
      expect((await reject("A later guess")).error).toBeNull();
      const lot = await f.db
        .selectFrom("inspection")
        .select("notes")
        .where("id", "=", lotId)
        .executeTakeFirstOrThrow();
      expect(lot.notes).toBe("Transit damage");
      const history = await f.db
        .selectFrom("inspectionHistory")
        .select("id")
        .where("inspectionId", "=", lotId)
        .execute();
      expect(history).toHaveLength(1);
    },
    60_000
  );

  it.skipIf(!client)(
    "an item with an open lot cannot change tracking type",
    async () => {
      await receiveInto("track");
      await expect(
        withGuard(() =>
          f.db
            .updateTable("item")
            .set({ itemTrackingType: "Batch" })
            .where("id", "=", f.partId)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/held for inspection/);
    },
    60_000
  );

  const accepted = async (key: string, unitKey = key) => {
    await ensureIssueType();
    const received = await receiveInto(key, unitKey);
    const decided = await withGuard(() =>
      dispositionInspection(f.db, {
        id: received.lotId,
        decision: "Accept",
        companyId: f.companyId,
        dispositionedBy: USER,
        requireSource: "Receipt"
      })
    );
    expect(decided.error).toBeNull();
    const result = await insertReceiptPutAway(f.db, {
      companyId: f.companyId,
      userId: USER,
      receiptId: received.receiptId
    });
    if (!("created" in result)) throw new Error(result.refusal);
    return { ...received, transferId: result.created.id };
  };

  it.skipIf(!client)(
    "a Put Away scan of a line with no To unit is refused",
    async () => {
      const units = `${f.prefix}-sn-noto`;
      const transferLine = `${f.prefix}-stl-noto`;
      await seed(f, async (trx) => {
        const transfer = await trx
          .insertInto("stockTransfer")
          .values({
            stockTransferId: `${f.prefix}-ST-noto`,
            locationId: f.locationId,
            status: "Released",
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const receipt = await trx
          .insertInto("receipt")
          .values({
            receiptId: `${f.prefix}-RE-noto`,
            locationId: f.locationId,
            sourceDocument: "Purchase Order",
            status: "Posted",
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const line = await trx
          .insertInto("receiptLine")
          .values({
            receiptId: receipt.id,
            itemId: f.partId,
            locationId: f.locationId,
            orderQuantity: 1,
            receivedQuantity: 1,
            unitOfMeasure: "EA",
            unitPrice: 0,
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("stockTransferLine")
          .values({
            id: transferLine,
            stockTransferId: transfer.id,
            receiptLineId: line.id,
            itemId: f.partId,
            fromStorageUnitId: rejectedUnit,
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("trackedEntity")
          .values({
            id: units,
            itemId: f.partId,
            quantity: 1,
            status: "Available",
            sourceDocument: "Receipt",
            sourceDocumentId: receipt.id,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const transferRow = await f.db
        .selectFrom("stockTransferLine")
        .select("stockTransferId")
        .where("id", "=", transferLine)
        .executeTakeFirstOrThrow();
      const picked = await withGuard(() =>
        invokePosting(
          handlesOf(f.ctx),
          "post-stock-transfer",
          {
            type: "serial",
            stockTransferId: transferRow.stockTransferId,
            stockTransferLineId: transferLine,
            trackedEntityId: units,
            locationId: f.locationId
          },
          postStockTransfer
        )
      );
      expect(picked.error?.message).toMatch(/To storage unit/);
    },
    60_000
  );

  it.skipIf(!client)(
    "an open non-inventory lot keeps its item's tracking type",
    async () => {
      const item = `${f.prefix}-noninv-track`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: item,
            readableId: `${f.prefix}-NIT`,
            name: "non inventory",
            type: "Part",
            itemTrackingType: "Non-Inventory",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("inspection")
          .values({
            id: `${f.prefix}-lot-nit`,
            inspectionId: `${f.prefix}-INS-NIT`,
            itemId: item,
            lotSize: 1,
            samplingStandard: "ANSI_Z1_4",
            samplingPlanType: "All",
            sampleSize: 1,
            acceptanceNumber: 0,
            rejectionNumber: 1,
            sourceDocument: "Receipt",
            sourceDocumentId: `${f.prefix}-rcpt-nit`,
            status: "Pending",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      await expect(
        withGuard(() =>
          f.db
            .updateTable("item")
            .set({ itemTrackingType: "Inventory" })
            .where("id", "=", item)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/held for inspection/);
    },
    60_000
  );

  it.skipIf(!client)(
    "a Failed lot's only link can move to another NCR",
    async () => {
      await ensureIssueType();
      const carrier = await partialLot("move-a");
      const target = await partialLot("move-b");
      const failed = await receiveInto("move-c");
      await seed(f, async (trx) => {
        await trx
          .updateTable("inspection")
          .set({ status: "Cancelled" })
          .where("id", "in", [carrier.lotId, target.lotId])
          .execute();
        await trx
          .updateTable("inspection")
          .set({ status: "Failed" })
          .where("id", "=", failed.lotId)
          .execute();
      });
      await linkLotToNcr(carrier.issueId, failed.lotId);
      await withGuard(() =>
        f.db
          .updateTable("nonConformanceInspection")
          .set({ nonConformanceId: target.issueId })
          .where("inspectionId", "=", failed.lotId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const links = await f.db
        .selectFrom("nonConformanceInspection")
        .select("nonConformanceId")
        .where("inspectionId", "=", failed.lotId)
        .execute();
      expect(links).toEqual([{ nonConformanceId: target.issueId }]);
    },
    60_000
  );

  it.skipIf(!client)(
    "a serial Partial with no closed NCR keeps its tracking type",
    async () => {
      const item = `${f.prefix}-sp-track`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: item,
            readableId: `${f.prefix}-SPT`,
            name: "serial",
            type: "Part",
            itemTrackingType: "Serial",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("inspection")
          .values({
            id: `${f.prefix}-lot-spt`,
            inspectionId: `${f.prefix}-INS-SPT`,
            itemId: item,
            lotSize: 5,
            samplingStandard: "ANSI_Z1_4",
            samplingPlanType: "All",
            sampleSize: 5,
            acceptanceNumber: 0,
            rejectionNumber: 1,
            sourceDocument: "Receipt",
            sourceDocumentId: `${f.prefix}-rcpt-spt`,
            status: "Partial",
            acceptedQuantity: 3,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      await expect(
        withGuard(() =>
          f.db
            .updateTable("item")
            .set({ itemTrackingType: "Inventory" })
            .where("id", "=", item)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/held for inspection/);
    },
    60_000
  );

  it.skipIf(!client)(
    "the link of a Partial lot whose NCR closed cannot be removed",
    async () => {
      const { issueId, lotId } = await partialLot("rel-link");
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
      await expect(
        withGuard(() =>
          f.db
            .deleteFrom("nonConformanceInspection")
            .where("inspectionId", "=", lotId)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/decided by this NCR/);
    },
    60_000
  );

  it.skipIf(!client)(
    "a Partial lot beside another lot can be unlinked so the NCR can close",
    async () => {
      const carrier = await partialLot("two-p");
      const other = await receiveInto("two-p-2", "two-p");
      await linkLotToNcr(carrier.issueId, other.lotId);
      await withGuard(() =>
        f.db
          .deleteFrom("nonConformanceInspection")
          .where("inspectionId", "=", carrier.lotId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const links = await f.db
        .selectFrom("nonConformanceInspection")
        .select("inspectionId")
        .where("nonConformanceId", "=", carrier.issueId)
        .execute();
      expect(links).toEqual([{ inspectionId: other.lotId }]);
    },
    60_000
  );

  it.skipIf(!client)(
    "a Put Away with a line that has no To unit is created Draft",
    async () => {
      await ensureIssueType();
      const { lotId, receiptId } = await receiveInto("pa-draft");
      const decided = await withGuard(() =>
        dispositionInspection(f.db, {
          id: lotId,
          decision: "Accept",
          companyId: f.companyId,
          dispositionedBy: USER,
          requireSource: "Receipt"
        })
      );
      expect(decided.error).toBeNull();
      const rule = await f.db
        .deleteFrom("pickMethod")
        .where("itemId", "=", f.partId)
        .where("companyId", "=", f.companyId)
        .returningAll()
        .execute();
      try {
        const result = await insertReceiptPutAway(f.db, {
          companyId: f.companyId,
          userId: USER,
          receiptId
        });
        if (!("created" in result)) throw new Error(result.refusal);
        const transfer = await f.db
          .selectFrom("stockTransfer")
          .select("status")
          .where("id", "=", result.created.id)
          .executeTakeFirstOrThrow();
        expect(transfer.status).toBe("Draft");
        const released = await withGuard(() =>
          inventory.setStockTransferStatus(stackContext(), {
            id: result.created.id,
            status: "Released"
          })
        );
        expect(released.error?.message).toMatch(/To storage unit/);
        const line = await f.db
          .selectFrom("stockTransferLine")
          .select(["id", "itemId", "fromStorageUnitId", "quantity"])
          .where("stockTransferId", "=", result.created.id)
          .executeTakeFirstOrThrow();
        const edited = await withGuard(() =>
          inventory.updateStockTransferLine(stackContext(), {
            id: line.id,
            stockTransferId: result.created.id,
            itemId: line.itemId,
            fromStorageUnitId: line.fromStorageUnitId ?? undefined,
            quantity: Number(line.quantity) + 1,
            requiresBatchTracking: false,
            requiresSerialTracking: false
          })
        );
        expect(edited.error?.message).toMatch(/Only its To storage unit/);
        const toSaved = await withGuard(() =>
          inventory.updateStockTransferLine(stackContext(), {
            id: line.id,
            stockTransferId: result.created.id,
            itemId: line.itemId,
            fromStorageUnitId: line.fromStorageUnitId ?? undefined,
            toStorageUnitId: shelf,
            quantity: Number(line.quantity),
            requiresBatchTracking: true,
            requiresSerialTracking: true
          })
        );
        expect(toSaved.error).toBeNull();
        const saved = await f.db
          .selectFrom("stockTransferLine")
          .select([
            "toStorageUnitId",
            "requiresSerialTracking",
            "requiresBatchTracking"
          ])
          .where("id", "=", line.id)
          .executeTakeFirstOrThrow();
        expect(saved).toEqual({
          toStorageUnitId: shelf,
          requiresSerialTracking: false,
          requiresBatchTracking: false
        });
        const movedFrom = await withGuard(() =>
          inventory.updateStockTransferLines(stackContext(), {
            ids: [line.id],
            field: "fromStorageUnitId",
            value: shelf
          })
        );
        expect(movedFrom.error?.message).toMatch(/Only its To storage unit/);
      } finally {
        if (rule.length > 0) {
          await f.db.insertInto("pickMethod").values(rule).execute();
        }
      }
    },
    60_000
  );

  it.skipIf(!client)(
    "a Put Away is created at the location of the line it moves",
    async () => {
      const { lotId, receiptId } = await receiveInto("pa-site");
      const decided = await withGuard(() =>
        dispositionInspection(f.db, {
          id: lotId,
          decision: "Accept",
          companyId: f.companyId,
          dispositionedBy: USER,
          requireSource: "Receipt"
        })
      );
      expect(decided.error).toBeNull();
      await seed(f, (trx) =>
        trx
          .updateTable("receiptLine")
          .set({ locationId: f.otherLocationId })
          .where("receiptId", "=", receiptId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const result = await insertReceiptPutAway(f.db, {
        companyId: f.companyId,
        userId: USER,
        receiptId
      });
      if (!("created" in result)) throw new Error(result.refusal);
      const transfer = await f.db
        .selectFrom("stockTransfer")
        .select("locationId")
        .where("id", "=", result.created.id)
        .executeTakeFirstOrThrow();
      expect(transfer.locationId).toBe(f.otherLocationId);
    },
    60_000
  );

  it.skipIf(!client)(
    "moving a Partial lot's held remainder names its NCR",
    async () => {
      const { issueId } = await partialLot("ncr-msg");
      const readable = await f.db
        .selectFrom("nonConformance")
        .select("nonConformanceId")
        .where("id", "=", issueId)
        .executeTakeFirstOrThrow();
      await expect(
        withGuard(() =>
          f.db
            .insertInto("itemLedger")
            .values({
              entryType: "Negative Adjmt.",
              documentType: "Inventory Count",
              documentId: `${f.prefix}-ncr-msg-move`,
              locationId: f.locationId,
              itemId: f.partId,
              storageUnitId: unitOf("ncr-msg"),
              quantity: -10,
              companyId: f.companyId,
              createdBy: USER
            })
            .execute()
        )
      ).rejects.toThrow(
        new RegExp(`until NCR ${readable.nonConformanceId} is completed`)
      );
    },
    60_000
  );

  it.skipIf(!client)(
    "a job lot cannot join an NCR that holds a Partial receipt lot",
    async () => {
      const partial = await partialLot("mix-j");
      const jobLot = `${f.prefix}-joblot`;
      await seed(f, (trx) =>
        trx
          .insertInto("inspection")
          .values({
            id: jobLot,
            inspectionId: `${f.prefix}-INS-JOB`,
            itemId: f.partId,
            lotSize: 1,
            samplingStandard: "ANSI_Z1_4",
            samplingPlanType: "All",
            sampleSize: 1,
            acceptanceNumber: 0,
            rejectionNumber: 1,
            sourceDocument: "Job Operation",
            sourceDocumentId: `${f.prefix}-job`,
            status: "Pending",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      await expect(
        withGuard(() =>
          f.db
            .insertInto("nonConformanceInspection")
            .values({
              nonConformanceId: partial.issueId,
              inspectionId: jobLot,
              companyId: f.companyId,
              createdBy: USER
            })
            .execute()
        )
      ).rejects.toThrow(/only lot on its NCR/);
    },
    60_000
  );

  const voidOf = (receiptId: string) =>
    withGuard(() =>
      invokePosting(
        handlesOf(f.ctx),
        "post-receipt",
        { type: "void", receiptId },
        postReceipt
      )
    );

  it.skipIf(!client)(
    "a void removes a Put Away that picked nothing",
    async () => {
      const { receiptId, transferId } = await accepted("void-pa");
      expect((await voidOf(receiptId)).error).toBeNull();
      const left = await f.db
        .selectFrom("stockTransfer")
        .select("id")
        .where("id", "=", transferId)
        .execute();
      expect(left).toEqual([]);
    },
    60_000
  );

  it.skipIf(!client)(
    "a void refuses a Put Away with picked stock",
    async () => {
      const { receiptId, transferId } = await accepted("void-pk");
      await seed(f, (trx) =>
        trx
          .updateTable("stockTransferLine")
          .set({ pickedQuantity: 1 })
          .where("stockTransferId", "=", transferId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      expect((await voidOf(receiptId)).error?.message).toMatch(/Unpick it first/);
    },
    60_000
  );

  it.skipIf(!client)(
    "Pick All leaves a Put Away line with no To unit and picks the rest",
    async () => {
      const { transferId } = await accepted("pa-two");
      const line = await f.db
        .selectFrom("stockTransferLine")
        .selectAll()
        .where("stockTransferId", "=", transferId)
        .executeTakeFirstOrThrow();
      await seed(f, async (trx) => {
        await trx
          .updateTable("stockTransfer")
          .set({ status: "Released" })
          .where("id", "=", transferId)
          .execute();
        await trx
          .updateTable("stockTransferLine")
          .set({ quantity: 6, toStorageUnitId: shelf })
          .where("id", "=", line.id)
          .execute();
        await trx
          .insertInto("stockTransferLine")
          .values({
            stockTransferId: transferId,
            receiptLineId: line.receiptLineId,
            itemId: line.itemId,
            fromStorageUnitId: line.fromStorageUnitId,
            toStorageUnitId: null,
            quantity: 4,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const shelfBefore = await untrackedAt(shelf);
      const picked = await withGuard(() =>
        pickUntrackedStockTransferLines(f.db, {
          stockTransferId: transferId,
          companyId: f.companyId,
          userId: USER
        })
      );
      expect(picked).toEqual([line.id]);
      expect(await untrackedAt(shelf)).toBe(shelfBefore + 6);
    },
    60_000
  );

  const linkLotToNcr = (nonConformanceId: string, inspectionId: string) =>
    seed(f, (trx) =>
      trx
        .insertInto("nonConformanceInspection")
        .values({
          nonConformanceId,
          inspectionId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );

  it.skipIf(!client)(
    "a lot that shares its NCR cannot become Partial",
    async () => {
      await ensureIssueType();
      const carrier = await partialLot("share-a");
      const open = await receiveInto("share-b");
      await linkLotToNcr(carrier.issueId, open.lotId);
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), {
          id: open.lotId,
          acceptedQuantity: 6,
          createNcr: true
        })
      );
      expect(partial.error?.message).toMatch(/only lot on its NCR/);
      expect(await statusOf(open.lotId)).toBe("Pending");
    },
    60_000
  );

  it.skipIf(!client)(
    "an untracked lot linked to a Closed NCR cannot become Partial",
    async () => {
      await ensureIssueType();
      const carrier = await partialLot("shut");
      const open = await receiveInto("shut-2", "shut");
      await seed(f, async (trx) => {
        await trx
          .updateTable("nonConformance")
          .set({ status: "Closed" })
          .where("id", "=", carrier.issueId)
          .execute();
        await trx
          .deleteFrom("nonConformanceInspection")
          .where("nonConformanceId", "=", carrier.issueId)
          .where("inspectionId", "=", carrier.lotId)
          .execute();
      });
      await linkLotToNcr(carrier.issueId, open.lotId);
      const partial = await withGuard(() =>
        quality.partialInspection(stackContext(), {
          id: open.lotId,
          acceptedQuantity: 6,
          createNcr: true
        })
      );
      expect(partial.error?.message).toMatch(/already closed/);
      expect(await statusOf(open.lotId)).toBe("Pending");
    },
    60_000
  );

  it.skipIf(!client)(
    "a Failed lot from before the hold can retry its missing write-off",
    async () => {
      const { lotId } = await receiveInto("legfail");
      await seed(f, (trx) =>
        trx
          .updateTable("inspection")
          .set({ status: "Failed", storageUnitId: null })
          .where("id", "=", lotId)
          .execute()
      );
      const retried = await withGuard(() =>
        dispositionWithReason(f.db, {
          id: lotId,
          decision: "Reject",
          reason: "Transit damage",
          companyId: f.companyId,
          dispositionedBy: USER,
          requireSource: "Receipt"
        })
      );
      expect(retried.error).toBeNull();
      expect(retried.data?.writeOff?.quantity).toBe(-10);
    },
    60_000
  );

  it.skipIf(!client)(
    "a Passed lot can be linked to a later NCR",
    async () => {
      const first = await partialLot("passed-ncr");
      const second = await partialLot("passed-ncr-2", "passed-ncr");
      const passed = await receiveInto("passed-ncr-3", "passed-ncr");
      await seed(f, async (trx) => {
        await trx
          .updateTable("inspection")
          .set({ status: "Passed" })
          .where("id", "=", passed.lotId)
          .execute();
        await trx
          .updateTable("inspection")
          .set({ status: "Cancelled" })
          .where("id", "in", [first.lotId, second.lotId])
          .execute();
      });
      await linkLotToNcr(first.issueId, passed.lotId);
      await withGuard(() =>
        f.db
          .insertInto("nonConformanceInspection")
          .values({
            nonConformanceId: second.issueId,
            inspectionId: passed.lotId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      const links = await f.db
        .selectFrom("nonConformanceInspection")
        .select("id")
        .where("inspectionId", "=", passed.lotId)
        .execute();
      expect(links).toHaveLength(2);
    },
    60_000
  );

  it.skipIf(!client)(
    "a Put Away line with no To unit cannot be picked",
    async () => {
      const { transferId } = await accepted("pa-to");
      await seed(f, async (trx) => {
        await trx
          .updateTable("stockTransfer")
          .set({ status: "Released" })
          .where("id", "=", transferId)
          .execute();
        await trx
          .updateTable("stockTransferLine")
          .set({ toStorageUnitId: null })
          .where("stockTransferId", "=", transferId)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      await expect(
        withGuard(() =>
          pickUntrackedStockTransferLines(f.db, {
            stockTransferId: transferId,
            companyId: f.companyId,
            userId: USER
          })
        )
      ).rejects.toThrow(/To storage unit/);
    },
    60_000
  );

  it.skipIf(!client)(
    "Pick All shows the hold's refusal",
    async () => {
      await receiveInto("pa-held");
      let transferId = "";
      await seed(f, async (trx) => {
        const created = await trx
          .insertInto("stockTransfer")
          .values({
            stockTransferId: `${f.prefix}-ST-held`,
            locationId: f.locationId,
            status: "Released",
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("stockTransferLine")
          .values({
            stockTransferId: created.id,
            itemId: f.partId,
            fromStorageUnitId: unitOf("pa-held"),
            toStorageUnitId: shelf,
            quantity: 4,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        transferId = created.id;
      });
      const picked = await withGuard(() =>
        inventory.pickAllStockTransferLines(stackContext(), {
          stockTransferId: transferId
        })
      );
      expect(picked.error?.message).toMatch(/held for inspection/);
    },
    60_000
  );

  it.skipIf(!client)(
    "a return shipment takes no stock an open lot holds",
    async () => {
      await receiveInto("ship");
      const returnId = `${f.prefix}-pro`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("purchaseReturnOrder")
          .values({
            id: returnId,
            purchaseReturnOrderId: `${f.prefix}-PRO`,
            supplierId: f.supplierId,
            currencyCode: "USD",
            orderDate: f.today,
            locationId: f.locationId,
            status: "To Ship",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("purchaseReturnOrderLine")
          .values({
            purchaseReturnOrderId: returnId,
            itemId: f.partId,
            quantity: 2,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromPurchaseReturnOrder",
          purchaseReturnOrderId: returnId,
          locationId: f.locationId
        })
      ) as { id: string };
      await seed(f, (trx) =>
        trx
          .updateTable("shipmentLine")
          .set({ storageUnitId: unitOf("ship") })
          .where("shipmentId", "=", shipment.id)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const posted = await withGuard(() =>
        invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "post", shipmentId: shipment.id },
          postShipment
        )
      );
      expect(posted.error?.message).toMatch(/inspection/);
      expect(await untrackedAt(unitOf("ship"))).toBe(10);
    },
    60_000
  );

  databaseTest(
    "a planned non-inventory line opens a lot and holds no stock",
    async () => {
      const nonInventory = `${f.prefix}-non-inv`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: nonInventory,
            readableId: `${f.prefix}-NONINV`,
            name: "non inventory",
            type: "Part",
            itemTrackingType: "Non-Inventory",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        const document = await trx
          .insertInto("inspectionDocument")
          .values({
            partId: nonInventory,
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("itemInspectionDocumentAssignment")
          .values({
            itemId: nonInventory,
            usage: "Receipt",
            inspectionDocumentId: document.id,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const lines = [
        { itemId: f.partId, lineId: null },
        { itemId: nonInventory, lineId: null }
      ];
      expect(
        await receiptLinesOpeningLots(f.db, f.companyId, { lines })
      ).toEqual([
        { ...lines[0], holdsStock: true },
        { ...lines[1], holdsStock: false }
      ]);
    }
  );
});
