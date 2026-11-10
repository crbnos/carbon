// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Goods-in inspection hold: an inspected purchase receipt stays held in the
// inspection storage unit until Quality decides its lot.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { createServiceContext } from "@carbon/api/service-fn.server";
import { dispositionInspection } from "@carbon/database/quality";
import { describeCause, reasonText } from "@carbon/utils";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completeStockTransfer,
  getReceiptPutAwayLines,
  insertReceiptPutAway,
  postInventoryAdjustment,
  postReceipt,
  postStockTransfer,
  unheldInspectedLineRefusal
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  draftReceiptFromPurchaseOrder,
  type Fixture,
  receiveFromPurchaseOrder,
  seed,
  USER
} from "./fixtures/always-post";
import * as inventory from "../../app/modules/inventory/inventory.server";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

describe.skipIf(!hasLocalDatabase)("goods-in inspection hold", () => {
  let f: Fixture;
  let inspectionUnit: string;
  let rejectedUnit: string;
  // The part's nettable default bin, where Put Away takes it.
  let shelf: string;
  // A non-nettable unit at the fixture's other location.
  let otherSiteUnit: string;
  let receiptId: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    inspectionUnit = `${f.prefix}-qc`;
    rejectedUnit = `${f.prefix}-mrb`;
    shelf = `${f.prefix}-shelf`;
    otherSiteUnit = `${f.prefix}-qc-2`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values([
          ...[inspectionUnit, rejectedUnit].map((id) => ({
            id,
            name: id,
            locationId: f.locationId,
            nettable: false,
            companyId: f.companyId,
            createdBy: USER
          })),
          {
            id: shelf,
            name: shelf,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: otherSiteUnit,
            name: otherSiteUnit,
            locationId: f.otherLocationId,
            nettable: false,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
      await trx
        .insertInto("pickMethod")
        .values({
          itemId: f.partId,
          locationId: f.locationId,
          defaultStorageUnitId: shelf,
          companyId: f.companyId,
          createdBy: USER
        })
        .onConflict((oc) =>
          oc
            .columns(["itemId", "locationId"])
            .doUpdateSet({ defaultStorageUnitId: shelf })
        )
        .execute();
      await trx
        .updateTable("location")
        .set({
          inspectionStorageUnitId: inspectionUnit,
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
            table: "stockTransfer",
            name: "Stock Transfer",
            prefix: "ST-",
            companyId: f.companyId
          }
        ])
        .execute();
      const document = await trx
        .insertInto("inspectionDocument")
        .values({
          partId: f.partId,
          companyId: f.companyId,
          createdBy: USER
        })
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
    receiptId = await receiveFromPurchaseOrder(f, "inspected");
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

  const lotOf = () =>
    f.db
      .selectFrom("inspection")
      .select(["id", "status", "storageUnitId", "acceptedQuantity"])
      .where("sourceDocumentId", "=", receiptId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();

  const receiptStatus = async () =>
    (
      await f.db
        .selectFrom("receipt")
        .select("inspectionStatus")
        .where("id", "=", receiptId)
        .executeTakeFirstOrThrow()
    ).inspectionStatus;

  const onHand = async (storageUnitId: string) =>
    Number(
      (
        await f.db
          .selectFrom("itemLedger")
          .select(sql<number>`COALESCE(SUM("quantity"), 0)`.as("quantity"))
          .where("itemId", "=", f.partId)
          .where("storageUnitId", "=", storageUnitId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).quantity
    );

  // The fixture's connection runs with the sync flag on, which the guard
  // steps aside for (dataset apply, restore). Turn it off to reach the guard.
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

  const adjust = (
    adjustmentType: "Positive Adjmt." | "Negative Adjmt.",
    storageUnitId: string,
    quantity: number
  ) =>
    withGuard(() =>
      invokePosting(
        handlesOf(f.ctx),
        "post-inventory-adjustment",
        {
          adjustmentType,
          itemId: f.partId,
          locationId: f.locationId,
          storageUnitId,
          quantity
        },
        postInventoryAdjustment
      )
    );

  const takeOut = (quantity: number) =>
    adjust("Negative Adjmt.", inspectionUnit, quantity);

  databaseTest(
    "receives an inspected part into the inspection unit and holds it",
    async () => {
      const line = await f.db
        .selectFrom("receiptLine")
        .select(["storageUnitId", "requiresInspection"])
        .where("receiptId", "=", receiptId)
        .executeTakeFirstOrThrow();
      expect(line).toEqual({
        storageUnitId: inspectionUnit,
        requiresInspection: true
      });
      expect(await lotOf()).toMatchObject({
        status: "Pending",
        storageUnitId: inspectionUnit
      });
      expect(await receiptStatus()).toBe("Pending Inspection");
      expect(await onHand(inspectionUnit)).toBe(10);
    }
  );

  // A refusal's text, as the toast shows it: the guard's RAISE reaches the
  // person as the failure's reason, not its (withheld) 500 message.
  const refusal = (error: unknown) => {
    const reason = describeCause(error);
    return reason ? reasonText(reason) : "";
  };

  databaseTest("refuses to take held stock out of the inspection unit", async () => {
    const result = await takeOut(3);
    expect(refusal(result.error)).toMatch(/held for inspection/);
    expect(await onHand(inspectionUnit)).toBe(10);
  });

  databaseTest(
    "a Partial lot frees what passed and moves the rest to the rejected unit, still held",
    async () => {
      const lot = await lotOf();
      const partial = await withGuard(() =>
        dispositionInspection(f.db, {
          id: lot.id,
          decision: "Partial",
          acceptedQuantity: 7,
          companyId: f.companyId,
          dispositionedBy: USER,
          requireSource: "Receipt"
        })
      );
      expect(partial.error).toBeNull();
      expect(partial.data?.rejectedQuantity).toBe(3);

      expect(await lotOf()).toMatchObject({
        status: "Partial",
        storageUnitId: rejectedUnit,
        acceptedQuantity: 7
      });
      expect(await onHand(inspectionUnit)).toBe(7);
      expect(await onHand(rejectedUnit)).toBe(3);
      expect(await receiptStatus()).toBe("Partially Passed");

      // The 7 that passed may move; the 3 rejected may not.
      expect((await takeOut(7)).error).toBeNull();
      expect((await adjust("Positive Adjmt.", inspectionUnit, 7)).error).toBeNull();
      const rejectedMove = await withGuard(() =>
        invokePosting(
          handlesOf(f.ctx),
          "post-inventory-adjustment",
          {
            adjustmentType: "Negative Adjmt.",
            itemId: f.partId,
            locationId: f.locationId,
            storageUnitId: rejectedUnit,
            quantity: 1
          },
          postInventoryAdjustment
        )
      );
      expect(refusal(rejectedMove.error)).toMatch(/held for inspection/);
    }
  );

  databaseTest(
    "Put Away offers the passed quantity from the unit it was received into",
    async () => {
      const lines = await getReceiptPutAwayLines(
        f.db,
        f.companyId,
        receiptId
      );
      expect(lines).toEqual([
        expect.objectContaining({
          itemId: f.partId,
          fromStorageUnitId: inspectionUnit,
          quantity: 7,
          requiresSerialTracking: false,
          requiresBatchTracking: false
        })
      ]);
    }
  );

  databaseTest("refuses a second decision on a Partial lot", async () => {
    const lot = await lotOf();
    const again = await dispositionInspection(f.db, {
      id: lot.id,
      decision: "Reject",
      reason: "changed my mind",
      companyId: f.companyId,
      dispositionedBy: USER,
      requireSource: "Receipt"
    });
    expect(again.error?.message).toMatch(/already partly accepted/);
    expect(await lotOf()).toMatchObject({ status: "Partial" });
  });

  // Put Away the receipt, pick `picked` of its one line through the stock
  // transfer posting, and complete the transfer.
  const putAway = async (picked: number) => {
    const result = await insertReceiptPutAway(f.db, {
      companyId: f.companyId,
      userId: USER,
      receiptId
    });
    if (!("created" in result)) throw new Error(result.refusal);
    const line = await f.db
      .selectFrom("stockTransferLine")
      .select(["id", "fromStorageUnitId", "toStorageUnitId", "receiptLineId"])
      .where("stockTransferId", "=", result.created.id)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    expect(line).toMatchObject({
      fromStorageUnitId: inspectionUnit,
      toStorageUnitId: shelf
    });
    expect(line.receiptLineId).not.toBeNull();
    const pick = await withGuard(() =>
      invokePosting(
        handlesOf(f.ctx),
        "post-stock-transfer",
        {
          type: "inventory",
          stockTransferId: result.created.id,
          stockTransferLineId: line.id,
          quantity: picked,
          locationId: f.locationId
        },
        postStockTransfer
      )
    );
    expect(pick.error).toBeNull();
    // A transfer picked in full completes itself; one picked short is
    // completed by hand.
    const transfer = () =>
      f.db
        .selectFrom("stockTransfer")
        .select("status")
        .where("id", "=", result.created.id)
        .executeTakeFirstOrThrow();
    if ((await transfer()).status !== "Completed") {
      expect(
        await completeStockTransfer(f.db, {
          id: result.created.id,
          companyId: f.companyId,
          userId: USER
        })
      ).toBeNull();
    }
    expect(await transfer()).toEqual({ status: "Completed" });
  };

  databaseTest(
    "a putaway completed short leaves the rest to put away, and the receipt waits for it",
    async () => {
      expect(await onHand(inspectionUnit)).toBe(7);
      expect(await onHand(shelf)).toBe(0);

      await putAway(4);
      expect(await onHand(inspectionUnit)).toBe(3);
      expect(await onHand(shelf)).toBe(4);
      expect(
        (await getReceiptPutAwayLines(f.db, f.companyId, receiptId)).map(
          (line) => line.quantity
        )
      ).toEqual([3]);
      expect(await receiptStatus()).toBe("Partially Passed");

      await putAway(3);
      expect(await onHand(inspectionUnit)).toBe(0);
      expect(await onHand(shelf)).toBe(7);
      expect(await getReceiptPutAwayLines(f.db, f.companyId, receiptId)).toEqual(
        []
      );
      expect(await receiptStatus()).toBe("Put Away");
      expect(
        await insertReceiptPutAway(f.db, {
          companyId: f.companyId,
          userId: USER,
          receiptId
        })
      ).toEqual({ refusal: "nothingReady" });
    }
  );

  const post = (draftId: string) =>
    invokePosting(
      handlesOf(f.ctx),
      "post-receipt",
      { type: "post", receiptId: draftId },
      postReceipt
    );

  // What a refused post must leave: a Draft receipt with no stock and no lot.
  const expectNothingPosted = async (draftId: string) => {
    const [receipt, ledger, lots] = await Promise.all([
      f.db
        .selectFrom("receipt")
        .select("status")
        .where("id", "=", draftId)
        .executeTakeFirstOrThrow(),
      f.db
        .selectFrom("itemLedger")
        .select("id")
        .where("documentId", "=", draftId)
        .where("companyId", "=", f.companyId)
        .execute(),
      f.db
        .selectFrom("inspection")
        .select("id")
        .where("sourceDocumentId", "=", draftId)
        .where("companyId", "=", f.companyId)
        .execute()
    ]);
    expect({ status: receipt.status, ledger, lots }).toEqual({
      status: "Draft",
      ledger: [],
      lots: []
    });
  };

  const setLineUnit = (draftId: string, storageUnitId: string) =>
    seed(f, (trx) =>
      trx
        .updateTable("receiptLine")
        .set({ storageUnitId })
        .where("receiptId", "=", draftId)
        .where("companyId", "=", f.companyId)
        .execute()
    );

  databaseTest(
    "posts an inspected line on a nettable storage unit and holds it there",
    async () => {
      const nettableUnit = `${f.prefix}-qc-nettable`;
      await seed(f, (trx) =>
        trx
          .insertInto("storageUnit")
          .values({
            id: nettableUnit,
            name: nettableUnit,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      const draftId = await draftReceiptFromPurchaseOrder(f, "nettable");
      await setLineUnit(draftId, nettableUnit);
      const result = await post(draftId);
      expect(result.error).toBeNull();
      const lots = await f.db
        .selectFrom("inspection")
        .select(["status", "storageUnitId"])
        .where("sourceDocumentId", "=", draftId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(lots).toEqual([
        { status: "Pending", storageUnitId: nettableUnit }
      ]);
      const before = await onHand(nettableUnit);
      const moved = await adjust("Negative Adjmt.", nettableUnit, 1);
      expect(refusal(moved.error)).toMatch(/held for inspection/);
      expect(await onHand(nettableUnit)).toBe(before);
    }
  );

  databaseTest(
    "refuses to post an inspected line on another location's storage unit",
    async () => {
      const draftId = await draftReceiptFromPurchaseOrder(f, "other-site");
      await setLineUnit(draftId, otherSiteUnit);
      const result = await post(draftId);
      expect(result.error?.status).toBe(400);
      await expectNothingPosted(draftId);
    }
  );

  const client = hasLocalDatabase ? localServiceRoleClient() : null;
  it.skipIf(!client)(
    "refuses a receipt line storage unit of another location or company",
    async () => {
      const draftId = await draftReceiptFromPurchaseOrder(f, "line-unit");
      const line = await f.db
        .selectFrom("receiptLine")
        .select("id")
        .where("receiptId", "=", draftId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const ctx = createServiceContext({
        actor: { type: "system", onBehalfOf: USER },
        company: { id: f.companyId, groupId: f.groupId },
        caller: client!,
        system: () => client!,
        pg: () => f.db,
        kv: () => {
          throw new Error("No operation here reads the cache");
        }
      });
      const setUnit = (value: string) =>
        inventory.updateReceiptLines(ctx, {
          ids: [line.id],
          field: "storageUnitId",
          value
        });
      const unitOfLine = async () =>
        (
          await f.db
            .selectFrom("receiptLine")
            .select("storageUnitId")
            .where("id", "=", line.id)
            .executeTakeFirstOrThrow()
        ).storageUnitId;
      const before = await unitOfLine();

      expect((await setUnit(otherSiteUnit)).error?.message).toMatch(
        /receipt's location/
      );
      expect((await setUnit("no-such-unit")).error?.message).toMatch(
        /could not be found/
      );
      expect(await unitOfLine()).toBe(before);
      expect((await setUnit(inspectionUnit)).error).toBeNull();
      expect(await unitOfLine()).toBe(inspectionUnit);
    },
    60_000
  );

  databaseTest(
    "refuses to post an inspected line at a location with no inspection storage unit",
    async () => {
      const draftId = await draftReceiptFromPurchaseOrder(f, "no-unit");
      const setInspectionUnit = (unit: string | null) =>
        seed(f, (trx) =>
          trx
            .updateTable("location")
            .set({ inspectionStorageUnitId: unit })
            .where("id", "=", f.locationId)
            .where("companyId", "=", f.companyId)
            .execute()
        );
      await setInspectionUnit(null);
      try {
        const result = await post(draftId);
        expect(result.error?.status).toBe(400);
        await expectNothingPosted(draftId);
      } finally {
        await setInspectionUnit(inspectionUnit);
      }
    }
  );

  databaseTest("voiding a receipt cancels its open lot", async () => {
    const voided = await receiveFromPurchaseOrder(f, "voided");
    const posted = await withGuard(() =>
      invokePosting(
        handlesOf(f.ctx),
        "post-receipt",
        { type: "void", receiptId: voided },
        postReceipt
      )
    );
    expect(posted.error).toBeNull();
    const lot = await f.db
      .selectFrom("inspection")
      .select("status")
      .where("sourceDocumentId", "=", voided)
      .executeTakeFirstOrThrow();
    expect(lot.status).toBe("Cancelled");
    const receipt = await f.db
      .selectFrom("receipt")
      .select("inspectionStatus")
      .where("id", "=", voided)
      .executeTakeFirstOrThrow();
    expect(receipt.inspectionStatus).toBe("Not Required");
  });

  databaseTest(
    "a voided receipt with a decided lot needs no inspection",
    async () => {
      const voided = await receiveFromPurchaseOrder(f, "voided-decided");
      await seed(f, (trx) =>
        trx
          .updateTable("inspection")
          .set({ status: "Passed" })
          .where("sourceDocumentId", "=", voided)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const posted = await withGuard(() =>
        invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "void", receiptId: voided },
          postReceipt
        )
      );
      expect(posted.error).toBeNull();
      const receipt = await f.db
        .selectFrom("receipt")
        .select("inspectionStatus")
        .where("id", "=", voided)
        .executeTakeFirstOrThrow();
      expect(receipt.inspectionStatus).toBe("Not Required");
    }
  );

  databaseTest(
    "a serial Partial needs a failed unit and complete sampling, then accepts every unit that did not fail",
    async () => {
      const item = `${f.prefix}-serial`;
      const line = `${f.prefix}-serial-line`;
      const lot = `${f.prefix}-serial-lot`;
      const units = ["a", "b", "c"].map((key) => `${f.prefix}-sn-${key}`);
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
        await trx
          .insertInto("receiptLine")
          .values({
            id: line,
            receiptId,
            itemId: item,
            locationId: f.locationId,
            storageUnitId: inspectionUnit,
            orderQuantity: 3,
            receivedQuantity: 3,
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
              sourceDocumentId: receiptId,
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
            inspectionId: `${f.prefix}-INS-SN`,
            itemId: item,
            lotSize: 3,
            samplingStandard: "ANSI_Z1_4",
            samplingPlanType: "All",
            sampleSize: 3,
            acceptanceNumber: 0,
            rejectionNumber: 1,
            sourceDocument: "Receipt",
            sourceDocumentId: receiptId,
            sourceDocumentLineId: line,
            storageUnitId: inspectionUnit,
            status: "In Progress",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("inspectionSample")
          .values({
            inspectionId: lot,
            trackedEntityId: units[0],
            status: "Failed",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const markPartial = () =>
        dispositionInspection(f.db, {
          id: lot,
          decision: "Partial",
          companyId: f.companyId,
          dispositionedBy: USER,
          requireSource: "Receipt"
        });
      const addPassedSample = (unit: string) =>
        seed(f, (trx) =>
          trx
            .insertInto("inspectionSample")
            .values({
              inspectionId: lot,
              trackedEntityId: unit,
              status: "Passed",
              companyId: f.companyId,
              createdBy: USER
            })
            .execute()
        );

      expect((await markPartial()).error?.message).toMatch(/no sample passed/);
      await addPassedSample(units[1]!);
      expect((await markPartial()).error?.message).toMatch(
        /sampling is incomplete/
      );
      await addPassedSample(units[2]!);

      const partial = await markPartial();
      expect(partial.error).toBeNull();
      expect(partial.data?.rejectedQuantity).toBeNull();

      const statuses = await f.db
        .selectFrom("trackedEntity")
        .select(["id", "status"])
        .where("id", "in", units)
        .orderBy("id")
        .execute();
      expect(statuses).toEqual([
        { id: units[0], status: "Rejected" },
        { id: units[1], status: "Available" },
        { id: units[2], status: "Available" }
      ]);
      const after = await f.db
        .selectFrom("inspection")
        .select(["status", "acceptedQuantity"])
        .where("id", "=", lot)
        .executeTakeFirstOrThrow();
      expect(after).toEqual({ status: "Partial", acceptedQuantity: 2 });
    }
  );

  databaseTest(
    "a line delivering to another location is held at that location's unit",
    async () => {
      const check = (storageUnitId: string) =>
        unheldInspectedLineRefusal(f.db, f.companyId, {
          locationId: f.locationId,
          plannedItemIds: new Set([f.partId]),
          lines: [
            {
              itemId: f.partId,
              storageUnitId,
              receivedQuantity: 1,
              locationId: f.otherLocationId
            }
          ]
        });
      await seed(f, (trx) =>
        trx
          .updateTable("location")
          .set({ inspectionStorageUnitId: otherSiteUnit })
          .where("id", "=", f.otherLocationId)
          .execute()
      );
      try {
        expect(await check(otherSiteUnit)).toBeNull();
        expect(await check(inspectionUnit)).toMatch(/needs inspection/);
      } finally {
        await seed(f, (trx) =>
          trx
            .updateTable("location")
            .set({ inspectionStorageUnitId: null })
            .where("id", "=", f.otherLocationId)
            .execute()
        );
      }
    }
  );
});
