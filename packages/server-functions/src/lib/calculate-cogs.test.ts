// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";

import { databaseTest } from "../local-database-test-fixture";
import { chargeFixture } from "../post-charge/post-charge-test-fixture";
import { calculateCOGS } from "./calculate-cogs.ts";

class Rollback extends Error {}

// A FIFO serial item with a receipt of two units at 100 (the oldest layer)
// and one unit returned to stock at 60 — a fixed asset's net book value.
databaseTest(
  "a serial unit returned to stock is relieved from its own cost layer",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db
        .transaction()
        .execute(async (trx) => {
          const item = await trx
            .insertInto("item")
            .values({
              readableId: `${f.companyId}-VEH`,
              name: "Vehicle",
              type: "Part",
              itemTrackingType: "Serial",
              companyId: f.companyId,
              createdBy: "system"
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          // An item insert may already have created its cost row.
          await trx
            .deleteFrom("itemCost")
            .where("itemId", "=", item.id)
            .execute();
          await trx
            .insertInto("itemCost")
            .values({
              itemId: item.id,
              costingMethod: "FIFO",
              unitCost: 100,
              companyId: f.companyId,
              createdBy: "system"
            })
            .execute();
          const unit = (readableId: string) =>
            trx
              .insertInto("trackedEntity")
              .values({
                readableId,
                itemId: item.id,
                quantity: 1,
                sourceDocument: "Item",
                sourceDocumentId: item.id,
                companyId: f.companyId,
                createdBy: "system"
              })
              .returning("id")
              .executeTakeFirstOrThrow();
          const returned = await unit("SN-1");
          const received = await unit("SN-2");

          const layer = (
            postingDate: string,
            quantity: number,
            cost: number,
            trackedEntityId: string | null
          ) =>
            trx
              .insertInto("costLedger")
              .values({
                itemLedgerType: "Purchase",
                costLedgerType: "Direct Cost",
                adjustment: false,
                itemId: item.id,
                quantity,
                cost,
                remainingQuantity: quantity,
                postingDate,
                trackedEntityId,
                companyId: f.companyId
              })
              .returning("id")
              .executeTakeFirstOrThrow();
          const receipt = await layer("2026-01-01", 2, 200, null);
          const returnLayer = await layer("2026-06-01", 1, 60, returned.id);

          const remaining = async (id: string) =>
            Number(
              (
                await trx
                  .selectFrom("costLedger")
                  .select("remainingQuantity")
                  .where("id", "=", id)
                  .executeTakeFirstOrThrow()
              ).remainingQuantity
            );

          // The returned unit leaves at its own 60, not the oldest layer's 100.
          const own = await calculateCOGS(trx, {
            itemId: item.id,
            quantity: 1,
            companyId: f.companyId,
            trackedEntityIds: [returned.id]
          });
          expect(own.totalCost).toEqual(60);
          expect(await remaining(returnLayer.id)).toEqual(0);
          expect(await remaining(receipt.id)).toEqual(2);

          // Put the returned layer back: another unit must not eat it.
          await trx
            .updateTable("costLedger")
            .set({ remainingQuantity: 1 })
            .where("id", "=", returnLayer.id)
            .execute();
          const other = await calculateCOGS(trx, {
            itemId: item.id,
            quantity: 1,
            companyId: f.companyId,
            trackedEntityIds: [received.id]
          });
          expect(other.totalCost).toEqual(100);
          expect(await remaining(returnLayer.id)).toEqual(1);

          // Nor does a consumer that names no unit, until nothing else is left.
          const anonymous = await calculateCOGS(trx, {
            itemId: item.id,
            quantity: 2,
            companyId: f.companyId
          });
          expect(anonymous.totalCost).toEqual(160);
          expect(await remaining(returnLayer.id)).toEqual(0);

          throw new Rollback();
        })
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await f.cleanup();
    }
  }
);

// Children of a layer cover different units of it, in order; children of a
// layer stamped for one serial all belong to that unit (a refurbishment's
// revaluation and write-down, Field Service Phase C).
databaseTest(
  "a stamped layer relieves every child; an unstamped layer one child per unit",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db
        .transaction()
        .execute(async (trx) => {
          const item = await trx
            .insertInto("item")
            .values({
              readableId: `${f.companyId}-REFURB`,
              name: "Refurbished unit",
              type: "Part",
              itemTrackingType: "Serial",
              companyId: f.companyId,
              createdBy: "system"
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await trx
            .deleteFrom("itemCost")
            .where("itemId", "=", item.id)
            .execute();
          await trx
            .insertInto("itemCost")
            .values({
              itemId: item.id,
              costingMethod: "FIFO",
              unitCost: 100,
              companyId: f.companyId,
              createdBy: "system"
            })
            .execute();
          const serial = await trx
            .insertInto("trackedEntity")
            .values({
              readableId: "SN-0050",
              itemId: item.id,
              quantity: 1,
              sourceDocument: "Item",
              sourceDocumentId: item.id,
              companyId: f.companyId,
              createdBy: "system"
            })
            .returning("id")
            .executeTakeFirstOrThrow();

          const row = (values: {
            quantity: number;
            cost: number;
            postingDate?: string;
            trackedEntityId?: string | null;
            appliesToCostLedgerId?: string | null;
          }) =>
            trx
              .insertInto("costLedger")
              .values({
                itemLedgerType: "Purchase",
                costLedgerType: values.appliesToCostLedgerId
                  ? "Revaluation"
                  : "Direct Cost",
                adjustment: Boolean(values.appliesToCostLedgerId),
                appliesToCostLedgerId: values.appliesToCostLedgerId ?? null,
                itemId: item.id,
                quantity: values.quantity,
                cost: values.cost,
                remainingQuantity: values.quantity,
                postingDate: values.postingDate ?? "2026-01-01",
                trackedEntityId: values.trackedEntityId ?? null,
                companyId: f.companyId
              })
              .returning("id")
              .executeTakeFirstOrThrow();

          // The serial's own layer at 100.00 with a 200.00 revaluation and a
          // 50.00 write-down: it leaves at 250.00.
          const own = await row({
            quantity: 1,
            cost: 100,
            trackedEntityId: serial.id
          });
          await row({ quantity: 1, cost: 200, appliesToCostLedgerId: own.id });
          await row({ quantity: 1, cost: -50, appliesToCostLedgerId: own.id });

          const refurbished = await calculateCOGS(trx, {
            itemId: item.id,
            quantity: 1,
            companyId: f.companyId,
            trackedEntityIds: [serial.id]
          });
          expect(refurbished.totalCost).toEqual(250);

          // An unstamped layer of 4 at 100.00 with two price variance children
          // of 2 units each (+4.00 and +8.00): the first two units take the
          // first child, the next two the second — unchanged.
          const receipt = await row({
            quantity: 4,
            cost: 400,
            postingDate: "2026-02-01"
          });
          await row({
            quantity: 2,
            cost: 4,
            appliesToCostLedgerId: receipt.id
          });
          await row({
            quantity: 2,
            cost: 8,
            appliesToCostLedgerId: receipt.id
          });

          const first = await calculateCOGS(trx, {
            itemId: item.id,
            quantity: 2,
            companyId: f.companyId
          });
          expect(first.totalCost).toEqual(204);
          const second = await calculateCOGS(trx, {
            itemId: item.id,
            quantity: 2,
            companyId: f.companyId
          });
          expect(second.totalCost).toEqual(208);

          throw new Rollback();
        })
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await f.cleanup();
    }
  }
);
