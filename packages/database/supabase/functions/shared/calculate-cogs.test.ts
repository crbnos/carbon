import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  cardTransactionFixture,
  databaseTest,
} from "../post-card-transaction/post-card-transaction-test-fixture.ts";
import { calculateCOGS } from "./calculate-cogs.ts";

class Rollback extends Error {}

// A FIFO serial item with a receipt of two units at 100 (the oldest layer)
// and one unit returned to stock at 60 — a fixed asset's net book value.
databaseTest(
  "a serial unit returned to stock is relieved from its own cost layer",
  async () => {
    const f = await cardTransactionFixture();
    try {
      await f.db.transaction().execute(async (trx) => {
        const item = await trx.insertInto("item").values({
          readableId: `${f.companyId}-VEH`,
          name: "Vehicle",
          type: "Part",
          itemTrackingType: "Serial",
          companyId: f.companyId,
          createdBy: "system",
        }).returning("id").executeTakeFirstOrThrow();
        // An item insert may already have created its cost row.
        await trx.deleteFrom("itemCost").where("itemId", "=", item.id)
          .execute();
        await trx.insertInto("itemCost").values({
          itemId: item.id,
          costingMethod: "FIFO",
          unitCost: 100,
          companyId: f.companyId,
          createdBy: "system",
        }).execute();
        const unit = (readableId: string) =>
          trx.insertInto("trackedEntity").values({
            readableId,
            itemId: item.id,
            quantity: 1,
            sourceDocument: "Item",
            sourceDocumentId: item.id,
            companyId: f.companyId,
            createdBy: "system",
          }).returning("id").executeTakeFirstOrThrow();
        const returned = await unit("SN-1");
        const received = await unit("SN-2");

        const layer = (
          postingDate: string,
          quantity: number,
          cost: number,
          trackedEntityId: string | null,
        ) =>
          trx.insertInto("costLedger").values({
            itemLedgerType: "Purchase",
            costLedgerType: "Direct Cost",
            adjustment: false,
            itemId: item.id,
            quantity,
            cost,
            remainingQuantity: quantity,
            postingDate,
            trackedEntityId,
            companyId: f.companyId,
          }).returning("id").executeTakeFirstOrThrow();
        const receipt = await layer("2026-01-01", 2, 200, null);
        const returnLayer = await layer("2026-06-01", 1, 60, returned.id);

        const remaining = async (id: string) =>
          Number(
            (await trx.selectFrom("costLedger").select("remainingQuantity")
              .where("id", "=", id).executeTakeFirstOrThrow())
              .remainingQuantity,
          );

        // The returned unit leaves at its own 60, not the oldest layer's 100.
        const own = await calculateCOGS(trx, {
          itemId: item.id,
          quantity: 1,
          companyId: f.companyId,
          trackedEntityIds: [returned.id],
        });
        assertEquals(own.totalCost, 60);
        assertEquals(await remaining(returnLayer.id), 0);
        assertEquals(await remaining(receipt.id), 2);

        // Put the returned layer back: another unit must not eat it.
        await trx.updateTable("costLedger").set({ remainingQuantity: 1 })
          .where("id", "=", returnLayer.id).execute();
        const other = await calculateCOGS(trx, {
          itemId: item.id,
          quantity: 1,
          companyId: f.companyId,
          trackedEntityIds: [received.id],
        });
        assertEquals(other.totalCost, 100);
        assertEquals(await remaining(returnLayer.id), 1);

        // Nor does a consumer that names no unit, until nothing else is left.
        const anonymous = await calculateCOGS(trx, {
          itemId: item.id,
          quantity: 2,
          companyId: f.companyId,
        });
        assertEquals(anonymous.totalCost, 160);
        assertEquals(await remaining(returnLayer.id), 0);

        throw new Rollback();
      }).catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    } finally {
      await f.cleanup();
    }
  },
);
