// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Goods-in inspection hold (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md):
// a purchase receipt of a part with a Receipt inspection plan lands in the
// location's inspection storage unit and stays held there until quality
// decides its lot; a Partial lot frees what passed and moves the rest to the
// rejected storage unit, still held.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { dispositionInspection } from "@carbon/database/quality";
import { describeCause, reasonText } from "@carbon/utils";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import {
  getReceiptPutAwayLines,
  postInventoryAdjustment
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  receiveFromPurchaseOrder,
  seed,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("goods-in inspection hold", () => {
  let f: Fixture;
  let inspectionUnit: string;
  let rejectedUnit: string;
  let receiptId: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    inspectionUnit = `${f.prefix}-qc`;
    rejectedUnit = `${f.prefix}-mrb`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values(
          [inspectionUnit, rejectedUnit].map((id) => ({
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
          inspectionStorageUnitId: inspectionUnit,
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
    // 10 of the part, received against a purchase order.
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

  const takeOut = (quantity: number) =>
    withGuard(() =>
      invokePosting(
        handlesOf(f.ctx),
        "post-inventory-adjustment",
        {
          adjustmentType: "Negative Adjmt.",
          itemId: f.partId,
          locationId: f.locationId,
          storageUnitId: inspectionUnit,
          quantity
        },
        postInventoryAdjustment
      )
    );

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
});
