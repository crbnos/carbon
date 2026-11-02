// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// An Average item's unit cost against the live database: a purchase receipt
// averages its cost into the stock on hand, and voiding it takes it out again.

import { expect } from "vitest";
import { postReceipt } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  receiveFromPurchaseOrder,
  seed,
  stockPart,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";

async function useAverageCost(f: Fixture, unitCost: number) {
  await seed(f, (trx) =>
    trx
      .updateTable("itemCost")
      .set({ costingMethod: "Average", unitCost })
      .where("itemId", "=", f.partId)
      .where("companyId", "=", f.companyId)
      .execute()
  );
}

async function unitCostOf(f: Fixture): Promise<number> {
  const row = await f.db
    .selectFrom("itemCost")
    .select("unitCost")
    .where("itemId", "=", f.partId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return Number(row.unitCost);
}

databaseTest(
  "a purchase receipt averages an Average item's cost into the stock on hand, and its void takes it out",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await useAverageCost(f, 10);
      await stockPart(f, 10);

      // 10 on hand at 10, 10 received at 20.
      const receiptId = await receiveFromPurchaseOrder(f, "1", 20);
      expect(await unitCostOf(f)).toBe(15);

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "void", receiptId },
          postReceipt
        )
      );
      expect(await unitCostOf(f)).toBe(10);
    } finally {
      await f.cleanup();
    }
  }
);
