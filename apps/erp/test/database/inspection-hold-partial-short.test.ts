// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// An untracked Partial is refused when the inspection unit holds less than
// its rejected part: it would hold, and its NCR scrap, stock that is not there.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { dispositionInspection } from "@carbon/database/quality";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  receiveFromPurchaseOrder,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("an untracked Partial short of stock", () => {
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
    // 10 received into the inspection unit, then 6 of them found missing.
    receiptId = await receiveFromPurchaseOrder(f, "short");
    await seed(f, async (trx) => {
      await trx
        .insertInto("itemLedger")
        .values({
          entryType: "Negative Adjmt.",
          documentType: "Inventory Count",
          itemId: f.partId,
          locationId: f.locationId,
          storageUnitId: inspectionUnit,
          quantity: -6,
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

  databaseTest(
    "refuses the Partial and leaves the lot open and the stock in place",
    async () => {
      const lot = await f.db
        .selectFrom("inspection")
        .select("id")
        .where("sourceDocumentId", "=", receiptId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();

      // 8 rejected, 4 in the inspection unit.
      const partial = await dispositionInspection(f.db, {
        id: lot.id,
        decision: "Partial",
        acceptedQuantity: 2,
        companyId: f.companyId,
        dispositionedBy: USER,
        requireSource: "Receipt"
      });

      expect(partial.error?.message).toMatch(/in the held storage unit/);
      expect(
        await f.db
          .selectFrom("inspection")
          .select(["status", "storageUnitId", "acceptedQuantity"])
          .where("id", "=", lot.id)
          .executeTakeFirstOrThrow()
      ).toEqual({
        status: "Pending",
        storageUnitId: inspectionUnit,
        acceptedQuantity: null
      });
      expect(await onHand(inspectionUnit)).toBe(4);
      expect(await onHand(rejectedUnit)).toBe(0);
    }
  );
});
