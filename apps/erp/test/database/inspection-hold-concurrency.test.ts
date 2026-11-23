// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { dispositionInspection } from "@carbon/database/quality";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { postReceipt } from "../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  draftReceiptFromPurchaseOrder,
  type Fixture,
  receiveFromPurchaseOrder,
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

async function connectWithTriggers() {
  const db = await connectLocalTestDatabase();
  await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
    db
  );
  return db;
}

describe.skipIf(!hasLocalDatabase)("concurrent inspection decisions", () => {
  let f: Fixture;
  let inspectionUnit: string;
  let rejectedUnit: string;

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

  const lotsOf = (receiptId: string) =>
    f.db
      .selectFrom("inspection")
      .select("id")
      .where("sourceDocumentId", "=", receiptId)
      .where("companyId", "=", f.companyId)
      .orderBy("lotSize")
      .execute();

  const partial = (
    db: Fixture["db"],
    id: string,
    acceptedQuantity: number
  ) =>
    dispositionInspection(db, {
      id,
      decision: "Partial",
      acceptedQuantity,
      companyId: f.companyId,
      dispositionedBy: USER,
      requireSource: "Receipt"
    });

  databaseTest(
    "lets one of two Partials on one lot win and refuses the other",
    async () => {
      const receiptId = await receiveFromPurchaseOrder(f, "same-lot");
      const [lot] = await lotsOf(receiptId);
      const left = await connectWithTriggers();
      const right = await connectWithTriggers();
      try {
        const results = await Promise.all([
          partial(left, lot!.id, 7),
          partial(right, lot!.id, 4)
        ]);

        const won = results.filter((result) => result.error === null);
        const refused = results.filter((result) => result.error !== null);
        expect(won.length).toBe(1);
        expect(refused.length).toBe(1);
        expect(refused[0]!.error!.message).toMatch(/already partly accepted/);
        const accepted = won[0] === results[0] ? 7 : 4;
        expect(won[0]!.data!.rejectedQuantity).toBe(10 - accepted);

        const moves = await f.db
          .selectFrom("itemLedger")
          .select(["storageUnitId", "quantity"])
          .where("companyId", "=", f.companyId)
          .where("documentType", "=", "Direct Transfer")
          .where("documentId", "=", lot!.id)
          .orderBy("quantity")
          .execute();
        expect(moves).toEqual([
          { storageUnitId: inspectionUnit, quantity: -(10 - accepted) },
          { storageUnitId: rejectedUnit, quantity: 10 - accepted }
        ]);
        expect(
          await f.db
            .selectFrom("inspection")
            .select(["status", "acceptedQuantity", "storageUnitId"])
            .where("id", "=", lot!.id)
            .executeTakeFirstOrThrow()
        ).toEqual({
          status: "Partial",
          acceptedQuantity: accepted,
          storageUnitId: rejectedUnit
        });
      } finally {
        await left.destroy();
        await right.destroy();
      }
    }
  );

  databaseTest(
    "decides two lots of one receipt at once without a deadlock",
    async () => {
      const receiptId = await draftReceiptFromPurchaseOrder(f, "two-lots");
      const line = await f.db
        .selectFrom("receiptLine")
        .select("id")
        .where("receiptId", "=", receiptId)
        .executeTakeFirstOrThrow();
      unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "receiptLineSplit",
          receiptId,
          receiptLineId: line.id,
          quantity: 4,
          locationId: f.locationId
        })
      );
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "post", receiptId },
          postReceipt
        )
      );
      const [small, large] = await lotsOf(receiptId);
      const left = await connectWithTriggers();
      const right = await connectWithTriggers();
      try {
        const results = await Promise.all([
          partial(left, small!.id, 3),
          partial(right, large!.id, 5)
        ]);
        expect(results.map((result) => result.error)).toEqual([null, null]);
        expect(
          await f.db
            .selectFrom("inspection")
            .select(["status", "acceptedQuantity"])
            .where("id", "in", [small!.id, large!.id])
            .orderBy("lotSize")
            .execute()
        ).toEqual([
          { status: "Partial", acceptedQuantity: 3 },
          { status: "Partial", acceptedQuantity: 5 }
        ]);
      } finally {
        await left.destroy();
        await right.destroy();
      }
    }
  );

  databaseTest(
    "two moves out of one held unit cannot both pass on the same on-hand",
    async () => {
      const receiptId = await draftReceiptFromPurchaseOrder(f, "race");
      await seed(f, (trx) =>
        trx
          .updateTable("receiptLine")
          .set({ storageUnitId: inspectionUnit })
          .where("receiptId", "=", receiptId)
          .where("companyId", "=", f.companyId)
          .execute()
      );
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "post", receiptId },
          postReceipt
        )
      );
      const onHandNow = async () =>
        Number(
          (
            await f.db
              .selectFrom("itemLedger")
              .select(sql<number>`COALESCE(SUM("quantity"), 0)`.as("quantity"))
              .where("storageUnitId", "=", inspectionUnit)
              .where("itemId", "=", f.partId)
              .where("trackedEntityId", "is", null)
              .executeTakeFirstOrThrow()
          ).quantity
        );
      const heldNow = Number(
        (
          await sql<{ held: number }>`
            SELECT public.inspection_held_quantity(${f.companyId}, ${f.partId}, ${inspectionUnit}) AS held
          `.execute(f.db)
        ).rows[0]!.held
      );
      const on = await onHandNow();
      await seed(f, (trx) =>
        trx
          .insertInto("itemLedger")
          .values({
            entryType: "Positive Adjmt.",
            documentType: "Direct Transfer",
            itemId: f.partId,
            locationId: f.locationId,
            storageUnitId: inspectionUnit,
            quantity: heldNow + 4 - on,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      const take = {
        entryType: "Transfer" as const,
        documentType: "Direct Transfer" as const,
        itemId: f.partId,
        locationId: f.locationId,
        storageUnitId: inspectionUnit,
        quantity: -3,
        companyId: f.companyId,
        createdBy: USER
      };
      const left = await connectWithTriggers();
      const right = await connectWithTriggers();
      try {
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        let entered!: () => void;
        const inFirst = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const first = left.transaction().execute(async (trx) => {
          await trx.insertInto("itemLedger").values(take).execute();
          entered();
          await released;
        });
        await inFirst;
        const second = right.insertInto("itemLedger").values(take).execute();
        await new Promise((resolve) => setTimeout(resolve, 300));
        release();
        await first;
        await expect(second).rejects.toThrow(/held for inspection/);
      } finally {
        await left.destroy();
        await right.destroy();
      }
    }
  );
});
