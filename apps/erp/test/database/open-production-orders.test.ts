// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Planning reads an open job as incoming supply. Its scrap allowance is
// expected to be lost, so only its good units count: MRP, available-to-promise,
// the buildable check and the item planning chart all read this one column.

import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

async function openJob(
  f: Fixture,
  key: string,
  quantities: {
    quantity: number;
    scrapQuantity: number;
    quantityReceivedToInventory: number;
  }
) {
  const id = `${f.prefix}-job-${key}`;
  await seed(f, (trx) =>
    trx
      .insertInto("job")
      .values({
        id,
        jobId: `J-${key}`,
        itemId: f.assemblyId,
        status: "Ready",
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER,
        ...quantities
      })
      .execute()
  );
  return id;
}

databaseTest(
  "an open job's supply is its good units less what it received",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const fresh = await openJob(f, "fresh", {
        quantity: 100,
        scrapQuantity: 5,
        quantityReceivedToInventory: 0
      });
      const partly = await openJob(f, "partly", {
        quantity: 10,
        scrapQuantity: 1,
        quantityReceivedToInventory: 4
      });
      // Made more than asked: the extra good units owe no further supply.
      const over = await openJob(f, "over", {
        quantity: 10,
        scrapQuantity: 2,
        quantityReceivedToInventory: 11
      });

      const supply = await f.db
        .selectFrom("openProductionOrders")
        .select(["id", "quantityToReceive"])
        .where("companyId", "=", f.companyId)
        .execute();
      const byId = Object.fromEntries(
        supply.map((row) => [row.id, Number(row.quantityToReceive)])
      );
      expect(byId).toEqual({ [fresh]: 100, [partly]: 6, [over]: 0 });
    } finally {
      await f.cleanup();
    }
  }
);
