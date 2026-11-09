// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { idsWithLiveStockHistory } from "@carbon/database/receipt-serials";
import { createServiceContext } from "@carbon/api/service-fn.server";
import {
  dispositionInspection,
  heldStockStripes,
  setInspectionRelease,
  upsertInspectionSample
} from "@carbon/database/quality";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getReceiptPutAwayLines,
  postInventoryAdjustment,
  postReceipt,
  refuseShippingOpenLotStock
} from "../../app/modules/inventory/inventory.service";
import * as quality from "../../app/modules/quality/quality.server";
import { postNonconformance } from "../../app/modules/quality/quality.service";
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

describe.skipIf(!hasLocalDatabase)("goods-in inspection hold worst cases", () => {
  let f: Fixture;
  let rejectedUnit: string;
  let projectId: string;
  const unitOf = (key: string) => `${f.prefix}-qc-${key}`;
  const UNIT_KEYS = [
    "acc",
    "spn",
    "del",
    "vs",
    "a",
    "b",
    "c",
    "c2",
    "d",
    "e",
    "e2",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "k2"
  ];

  beforeAll(async () => {
    f = await alwaysPostFixture();
    rejectedUnit = `${f.prefix}-mrb`;
    projectId = `${f.prefix}-project`;
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
        .updateTable("location")
        .set({
          inspectionStorageUnitId: unitOf("a"),
          rejectedStorageUnitId: rejectedUnit
        })
        .where("id", "=", f.locationId)
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .insertInto("sequence")
        .values({
          table: "inspection",
          name: "Inspection",
          prefix: "INS-",
          companyId: f.companyId
        })
        .execute();
      await trx
        .insertInto("project")
        .values({
          id: projectId,
          name: projectId,
          companyId: f.companyId,
          createdBy: USER
        })
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

  const decide = (
    lotId: string,
    decision: "Accept" | "Reject" | "Partial",
    acceptedQuantity?: number
  ) =>
    withGuard(() =>
      dispositionInspection(f.db, {
        id: lotId,
        decision,
        reason: decision === "Reject" ? "Suspected counterfeit" : undefined,
        acceptedQuantity,
        companyId: f.companyId,
        dispositionedBy: USER,
        requireSource: "Receipt"
      })
    );

  const statusOf = async (lotId: string) =>
    (
      await f.db
        .selectFrom("inspection")
        .select("status")
        .where("id", "=", lotId)
        .executeTakeFirstOrThrow()
    ).status;

  const stripesAt = async (storageUnitId: string) => {
    const rows = await f.db
      .selectFrom("itemLedger")
      .select(["projectId", sql<number>`SUM("quantity")`.as("quantity")])
      .where("itemId", "=", f.partId)
      .where("storageUnitId", "=", storageUnitId)
      .where("trackedEntityId", "is", null)
      .where("companyId", "=", f.companyId)
      .groupBy("projectId")
      .execute();
    return Object.fromEntries(
      rows.map((row) => [row.projectId ?? "", Number(row.quantity)])
    );
  };

  const lotMoves = (lotId: string) =>
    f.db
      .selectFrom("itemLedger")
      .select(["storageUnitId", "projectId", "quantity"])
      .where("documentId", "=", lotId)
      .where("documentType", "=", "Direct Transfer")
      .where("companyId", "=", f.companyId)
      .orderBy("storageUnitId")
      .orderBy("quantity")
      .execute();

  const takeOut = (storageUnitId: string, quantity: number) =>
    withGuard(() =>
      invokePosting(
        handlesOf(f.ctx),
        "post-inventory-adjustment",
        {
          adjustmentType: "Negative Adjmt.",
          itemId: f.partId,
          locationId: f.locationId,
          storageUnitId,
          quantity
        },
        postInventoryAdjustment
      )
    );

  const postWriteOff = (
    lotId: string,
    writeOff: NonNullable<
      Awaited<ReturnType<typeof dispositionInspection>>["data"]
    >["writeOff"]
  ) =>
    withGuard(() =>
      invokePosting(
        handlesOf(f.ctx),
        "post-nonconformance",
        {
          documentType: "Inbound Inspection",
          documentId: lotId,
          movements: (writeOff?.stripes ?? []).map((stripe) => ({
            itemId: writeOff!.itemId,
            locationId: writeOff!.locationId,
            storageUnitId: writeOff!.storageUnitId,
            trackedEntityId: null,
            projectId: stripe.projectId,
            quantity: stripe.quantity
          }))
        },
        postNonconformance
      )
    );

  databaseTest(
    "a rejected lot is decided once; repeating Reject moves no stock",
    async () => {
      const { lotId } = await receiveInto("a");
      const rejected = await decide(lotId, "Reject");
      expect(rejected.error).toBeNull();
      expect(rejected.data?.writeOff).toEqual({
        itemId: f.partId,
        quantity: -10,
        locationId: f.locationId,
        storageUnitId: unitOf("a"),
        stripes: [{ projectId: null, quantity: -10 }]
      });

      expect((await decide(lotId, "Partial", 4)).error).not.toBeNull();
      expect((await decide(lotId, "Accept")).error).not.toBeNull();
      expect(await statusOf(lotId)).toBe("Failed");

      const retry = await decide(lotId, "Reject");
      expect(retry.error).toBeNull();
      expect(retry.data?.writeOff).toBeNull();
      expect(await lotMoves(lotId)).toEqual([]);
      expect(await stripesAt(unitOf("a"))).toEqual({ "": 10 });
    }
  );

  databaseTest(
    "an accepted lot refuses a later Partial or Reject and keeps its stock",
    async () => {
      const { lotId } = await receiveInto("b");
      expect((await decide(lotId, "Accept")).error).toBeNull();
      expect((await decide(lotId, "Partial", 4)).error).not.toBeNull();
      expect((await decide(lotId, "Reject")).error).not.toBeNull();
      expect(await statusOf(lotId)).toBe("Passed");
      expect(await stripesAt(unitOf("b"))).toEqual({ "": 10 });
      expect(await lotMoves(lotId)).toEqual([]);
    }
  );

  databaseTest(
    "a rejected untracked lot's write-off posts with its decision, or neither does",
    async () => {
      const { lotId } = await receiveInto("j");
      const reject = () =>
        withGuard(() =>
          quality.rejectInspection(f.service, {
            id: lotId,
            createNcr: false,
            reason: "Suspected counterfeit"
          })
        );

      const defaults = await f.db
        .selectFrom("accountDefault")
        .selectAll()
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await seed(f, (trx) =>
        trx
          .deleteFrom("accountDefault")
          .where("companyId", "=", f.companyId)
          .execute()
      );
      try {
        expect((await reject()).error).not.toBeNull();
        expect(await statusOf(lotId)).toBe("Pending");
        expect(await stripesAt(unitOf("j"))).toEqual({ "": 10 });
      } finally {
        await seed(f, (trx) =>
          trx.insertInto("accountDefault").values(defaults).execute()
        );
      }
      expect((await takeOut(unitOf("j"), 1)).error?.message).toMatch(
        /held for inspection/
      );

      expect((await reject()).error).toBeNull();
      expect(await statusOf(lotId)).toBe("Failed");
      expect(await stripesAt(unitOf("j"))).toEqual({ "": 0 });
    }
  );

  const shortLot = async (key: string) => {
    const lot = await receiveInto(key);
    await seed(f, (trx) =>
      trx
        .insertInto("itemLedger")
        .values({
          entryType: "Negative Adjmt.",
          documentType: "Inventory Count",
          itemId: f.partId,
          locationId: f.locationId,
          storageUnitId: unitOf(key),
          quantity: -6,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );
    return lot;
  };

  databaseTest(
    "an untracked Reject whose held unit is short writes off only what is there",
    async () => {
      const { lotId } = await shortLot("c");
      const rejected = await decide(lotId, "Reject");
      expect(rejected.error).toBeNull();
      expect(rejected.data?.writeOff).toEqual({
        itemId: f.partId,
        quantity: -4,
        locationId: f.locationId,
        storageUnitId: unitOf("c"),
        stripes: [{ projectId: null, quantity: -4 }]
      });
      expect(await statusOf(lotId)).toBe("Failed");
      expect((await postWriteOff(lotId, rejected.data!.writeOff)).error).toBeNull();
      expect(await stripesAt(unitOf("c"))).toEqual({ "": 0 });
    }
  );

  databaseTest(
    "a short Reject leaves another open lot's stock in the unit",
    async () => {
      const first = await shortLot("c2");
      const secondReceipt = await draftReceiptFromPurchaseOrder(f, "c2-second");
      await seed(f, (trx) =>
        trx
          .updateTable("receiptLine")
          .set({ storageUnitId: unitOf("c2") })
          .where("receiptId", "=", secondReceipt)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      expect(
        (
          await invokePosting(
            handlesOf(f.ctx),
            "post-receipt",
            { type: "post", receiptId: secondReceipt },
            postReceipt
          )
        ).error
      ).toBeNull();
      const rejected = await decide(first.lotId, "Reject");
      expect(rejected.error).toBeNull();
      expect(rejected.data?.writeOff?.quantity).toBe(-4);
    }
  );

  databaseTest(
    "with no rejected unit set, refuses a short untracked Partial",
    async () => {
      const { lotId } = await shortLot("d");
      const setRejectedUnit = (unit: string | null) =>
        seed(f, (trx) =>
          trx
            .updateTable("location")
            .set({ rejectedStorageUnitId: unit })
            .where("id", "=", f.locationId)
            .where("companyId", "=", f.companyId)
            .execute()
        );
      await setRejectedUnit(null);
      try {
        expect((await decide(lotId, "Partial", 2)).error?.message).toMatch(
          /Only 4 of the 8 rejected/
        );
        expect(await statusOf(lotId)).toBe("Pending");
        expect((await decide(lotId, "Partial", 7)).error).toBeNull();
        expect(await statusOf(lotId)).toBe("Partial");
        expect(await lotMoves(lotId)).toEqual([]);
      } finally {
        await setRejectedUnit(rejectedUnit);
      }
    }
  );

  databaseTest(
    "moves and writes off project stock on the stripe it was received on",
    async () => {
      const { receiptId, lotId } = await receiveInto("e");
      await seed(f, async (trx) => {
        await trx
          .updateTable("itemLedger")
          .set({ quantity: 4 })
          .where("documentId", "=", receiptId)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .insertInto("itemLedger")
          .values({
            entryType: "Positive Adjmt.",
            documentType: "Purchase Receipt",
            documentId: receiptId,
            itemId: f.partId,
            locationId: f.locationId,
            storageUnitId: unitOf("e"),
            projectId,
            quantity: 6,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const partial = await decide(lotId, "Partial", 2);
      expect(partial.error).toBeNull();
      expect(
        (await lotMoves(lotId)).map((row) => ({
          ...row,
          quantity: Number(row.quantity)
        }))
      ).toEqual(
        expect.arrayContaining([
          { storageUnitId: unitOf("e"), projectId, quantity: -6 },
          { storageUnitId: unitOf("e"), projectId: null, quantity: -2 },
          { storageUnitId: rejectedUnit, projectId: null, quantity: 2 },
          { storageUnitId: rejectedUnit, projectId, quantity: 6 }
        ])
      );
      expect(await stripesAt(unitOf("e"))).toEqual({ "": 2, [projectId]: 0 });
      expect(
        await heldStockStripes(f.db, {
          companyId: f.companyId,
          itemId: f.partId,
          storageUnitId: rejectedUnit,
          documentIds: [lotId, receiptId]
        })
      ).toEqual([
        { projectId, quantity: 6 },
        { projectId: null, quantity: 2 }
      ]);

      const other = await receiveInto("e2");
      await seed(f, (trx) =>
        trx
          .updateTable("itemLedger")
          .set({ projectId })
          .where("documentId", "=", other.receiptId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      const rejected = await decide(other.lotId, "Reject");
      expect(rejected.error).toBeNull();
      expect(rejected.data?.writeOff?.stripes).toEqual([
        { projectId, quantity: -10 }
      ]);
      expect(
        (await postWriteOff(other.lotId, rejected.data!.writeOff)).error
      ).toBeNull();
      expect(await stripesAt(unitOf("e2"))).toEqual({ [projectId]: 0 });
    }
  );

  databaseTest(
    "Put Away offers no more than is still in the unit",
    async () => {
      const { receiptId, lotId } = await receiveInto("f");
      expect((await decide(lotId, "Accept")).error).toBeNull();
      expect((await takeOut(unitOf("f"), 4)).error).toBeNull();
      const lines = await getReceiptPutAwayLines(
        f.db,
        f.companyId,
        receiptId
      );
      expect(lines.map((line) => line.quantity)).toEqual([6]);
    }
  );

  databaseTest(
    "rounds the rejected quantity of a fractional Partial",
    async () => {
      const { lotId } = await receiveInto("g");
      const partial = await decide(lotId, "Partial", 9.7);
      expect(partial.error).toBeNull();
      expect(partial.data?.rejectedQuantity).toBe(0.3);
      expect(
        (await lotMoves(lotId))
          .map((row) => Number(row.quantity))
          .sort((a, b) => a - b)
      ).toEqual([-0.3, 0.3]);
    }
  );

  const serialLot = async (
    key: string,
    units: string[],
    lotFields: { status: "Pending" | "Partial"; acceptedQuantity?: number }
  ) => {
    const item = `${f.prefix}-serial-${key}`;
    const line = `${f.prefix}-serial-line-${key}`;
    const lot = `${f.prefix}-serial-lot-${key}`;
    const { receiptId } = await receiveInto(key);
    await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: item,
            readableId: `${f.prefix}-SERIAL-${key}`,
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
            storageUnitId: unitOf(key),
            orderQuantity: units.length,
            receivedQuantity: units.length,
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
            inspectionId: `${f.prefix}-INS-SN-${key}`,
            itemId: item,
            lotSize: units.length,
            samplingStandard: "ANSI_Z1_4",
            samplingPlanType: "All",
            sampleSize: units.length,
            acceptanceNumber: 0,
            rejectionNumber: 1,
            sourceDocument: "Receipt",
            sourceDocumentId: receiptId,
            sourceDocumentLineId: line,
            storageUnitId: unitOf(key),
            status: lotFields.status,
            acceptedQuantity: lotFields.acceptedQuantity ?? null,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
    return lot;
  };

  databaseTest(
    "a sample verdict keeps a receipt unit On Hold until the lot is decided",
    async () => {
      const [passed, failed] = ["h1", "h2"].map((k) => `${f.prefix}-sn-${k}`);
      const lot = await serialLot("h", [passed!, failed!], {
        status: "Pending"
      });
      const statuses = async () =>
        f.db
          .selectFrom("trackedEntity")
          .select(["id", "status"])
          .where("id", "in", [passed!, failed!])
          .orderBy("id")
          .execute();

      for (const [unit, status] of [
        [passed!, "Passed"],
        [failed!, "Failed"]
      ] as const) {
        const sample = await withGuard(() =>
          upsertInspectionSample(f.db, {
            inspectionId: lot,
            trackedEntityId: unit,
            status,
            companyId: f.companyId,
            inspectedBy: USER
          })
        );
        expect(sample.error).toBeNull();
      }
      expect(await statusOf(lot)).toBe("In Progress");
      expect(await statuses()).toEqual([
        { id: passed, status: "On Hold" },
        { id: failed, status: "On Hold" }
      ]);
      await expect(
        withGuard(() =>
          f.db
            .updateTable("trackedEntity")
            .set({ status: "Available" })
            .where("id", "=", passed!)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/held for inspection/);

      expect((await decide(lot, "Accept")).error).toBeNull();
      expect(await statuses()).toEqual([
        { id: passed, status: "Available" },
        { id: failed, status: "Rejected" }
      ]);
    }
  );

  const settleOtherLots = (keepLot: string, receiptId: string) =>
    seed(f, (trx) =>
      trx
        .updateTable("inspection")
        .set({ status: "Cancelled" })
        .where("sourceDocumentId", "=", receiptId)
        .where("id", "!=", keepLot)
        .where("companyId", "=", f.companyId)
        .execute()
    );

  const receiptOf = async (lotId: string) =>
    (
      await f.db
        .selectFrom("inspection")
        .select("sourceDocumentId")
        .where("id", "=", lotId)
        .executeTakeFirstOrThrow()
    ).sourceDocumentId as string;

  databaseTest(
    "a serial lot accepted with a failed unit reaches Put Away on its passed units",
    async () => {
      const [passed, failed] = ["a1", "a2"].map((k) => `${f.prefix}-sn-${k}`);
      const lot = await serialLot("acc", [passed!, failed!], {
        status: "Pending"
      });
      const receiptId = await receiptOf(lot);
      await settleOtherLots(lot, receiptId);
      await seed(f, (trx) =>
        trx
          .insertInto("inspectionSample")
          .values({
            inspectionId: lot,
            trackedEntityId: failed,
            status: "Failed",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      expect((await decide(lot, "Accept")).error).toBeNull();
      const line = await f.db
        .selectFrom("inspection")
        .select(["sourceDocumentLineId", "itemId", "acceptedQuantity"])
        .where("id", "=", lot)
        .executeTakeFirstOrThrow();
      expect(Number(line.acceptedQuantity)).toBe(1);

      await seed(f, async (trx) => {
        const transfer = await trx
          .insertInto("stockTransfer")
          .values({
            stockTransferId: `${f.prefix}-ST-acc`,
            locationId: f.locationId,
            receiptId,
            status: "Completed",
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("stockTransferLine")
          .values({
            stockTransferId: transfer.id,
            receiptLineId: line.sourceDocumentLineId,
            itemId: line.itemId,
            quantity: 1,
            pickedQuantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      await sql`SELECT public.refresh_receipt_inspection_status(${receiptId})`.execute(
        f.db
      );
      const receipt = await f.db
        .selectFrom("receipt")
        .select("inspectionStatus")
        .where("id", "=", receiptId)
        .executeTakeFirstOrThrow();
      expect(receipt.inspectionStatus).toBe("Put Away");
    }
  );

  databaseTest(
    "a decided serial Partial lot with no NCR frees its storage unit",
    async () => {
      const [passed, failed] = ["p1", "p2"].map((k) => `${f.prefix}-sn-${k}`);
      const lot = await serialLot("spn", [passed!, failed!], {
        status: "Partial",
        acceptedQuantity: 1
      });
      await settleOtherLots(lot, await receiptOf(lot));
      await expect(
        withGuard(() =>
          f.db
            .updateTable("storageUnit")
            .set({ active: false })
            .where("id", "=", unitOf("spn"))
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).resolves.toBeDefined();
      const unit = await f.db
        .selectFrom("storageUnit")
        .select("active")
        .where("id", "=", unitOf("spn"))
        .executeTakeFirstOrThrow();
      expect(unit.active).toBe(false);
    }
  );

  databaseTest(
    "a receipt voids after Reject moved its serial units to the rejected unit",
    async () => {
      const unit = `${f.prefix}-sn-vs`;
      const lot = await serialLot("vs", [unit], { status: "Pending" });
      const receiptId = await receiptOf(lot);
      await seed(f, (trx) =>
        trx
          .insertInto("itemLedger")
          .values({
            entryType: "Purchase",
            documentType: "Purchase Receipt",
            documentId: receiptId,
            itemId: `${f.prefix}-serial-vs`,
            locationId: f.locationId,
            storageUnitId: unitOf("vs"),
            trackedEntityId: unit,
            quantity: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      expect((await decide(lot, "Reject")).error).toBeNull();
      const voided = await withGuard(() =>
        invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "void", receiptId },
          postReceipt
        )
      );
      expect(voided.error).toBeNull();
      const onHand = await f.db
        .selectFrom("itemLedger")
        .select(["storageUnitId", sql<number>`SUM("quantity")`.as("quantity")])
        .where("trackedEntityId", "=", unit)
        .groupBy("storageUnitId")
        .execute();
      expect(onHand.every((row) => Number(row.quantity) === 0)).toBe(true);
      expect(await idsWithLiveStockHistory(f.db, f.companyId, [unit])).toEqual(
        new Set()
      );
    }
  );

  databaseTest(
    "deleting a serial unit held under an open lot is refused",
    async () => {
      const held = `${f.prefix}-sn-del`;
      const lot = await serialLot("del", [held], { status: "Pending" });
      await expect(
        withGuard(() =>
          f.db
            .deleteFrom("trackedEntity")
            .where("id", "=", held)
            .where("companyId", "=", f.companyId)
            .execute()
        )
      ).rejects.toThrow(/held for inspection/);
      expect(await statusOf(lot)).toBe("Pending");
    }
  );

  const client = hasLocalDatabase ? localServiceRoleClient() : null;
  it.skipIf(!client)(
    "a serial Partial whose NCR did not open gets one, once",
    async () => {
      const [failedUnit, passedUnit] = ["x", "y"].map(
        (k) => `${f.prefix}-sn-${k}`
      );
      const lot = await serialLot("i", [failedUnit!, passedUnit!], {
        status: "Partial",
        acceptedQuantity: 1
      });
      await seed(f, async (trx) => {
        await trx
          .insertInto("inspectionSample")
          .values({
            inspectionId: lot,
            trackedEntityId: failedUnit,
            status: "Failed",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ status: "Rejected" })
          .where("id", "=", failedUnit!)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ status: "Available" })
          .where("id", "=", passedUnit!)
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .insertInto("nonConformanceType")
          .values({
            name: `${f.prefix}-type`,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("sequence")
          .values({
            table: "nonConformance",
            name: "Issue",
            prefix: "NCR",
            companyId: f.companyId
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
      });
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

      const opened = await quality.partialInspection(ctx, {
        id: lot,
        createNcr: true
      });
      expect(opened.error).toBeNull();
      const links = await f.db
        .selectFrom("nonConformanceItemTrackedEntity")
        .select("trackedEntityId")
        .where("nonConformanceId", "=", opened.data!.issueId!)
        .execute();
      expect(links).toEqual([{ trackedEntityId: failedUnit }]);
      expect(await statusOf(lot)).toBe("Partial");

      const again = await quality.partialInspection(ctx, {
        id: lot,
        createNcr: true
      });
      expect(again.error).not.toBeNull();
      expect(
        await f.db
          .selectFrom("nonConformanceInspection")
          .select("nonConformanceId")
          .where("inspectionId", "=", lot)
          .execute()
      ).toHaveLength(1);
    },
    60_000
  );
  const returnShip = (storageUnitId: string, quantity: number) =>
    withGuard(async () => {
      const rollback = new Error("rollback");
      try {
        await f.db.transaction().execute(async (trx) => {
          await setInspectionRelease(trx);
          const row = {
            entryType: "Negative Adjmt." as const,
            documentType: "Purchase Return Shipment" as const,
            itemId: f.partId,
            locationId: f.locationId,
            storageUnitId,
            quantity: -quantity,
            companyId: f.companyId,
            createdBy: USER
          };
          await trx.insertInto("itemLedger").values(row).execute();
          await refuseShippingOpenLotStock(trx, f.companyId, [row], {
            includePartial: false
          });
          throw rollback;
        });
      } catch (error) {
        if (error === rollback) return null;
        return (error as Error).message;
      }
      return null;
    });

  databaseTest(
    "a return shipment refuses stock an open lot holds and ships a Partial remainder",
    async () => {
      await receiveInto("k");
      expect(await returnShip(unitOf("k"), 1)).toMatch(
        /Decide the inspection lot first/
      );

      const partial = await receiveInto("k2");
      expect((await decide(partial.lotId, "Partial", 6)).error).toBeNull();
      expect(await returnShip(rejectedUnit, 4)).toBeNull();
      expect(await returnShip(unitOf("k2"), 6)).toBeNull();
    }
  );
});
