// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { postInventoryAdjustment as postInventoryAdjustmentBody } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

type Ctx = Parameters<typeof handlesOf>[0];

const postInventoryAdjustment = (
  ctx: Ctx,
  input: Parameters<typeof postInventoryAdjustmentBody>[1]
) =>
  invokePosting(
    handlesOf(ctx),
    "post-inventory-adjustment",
    input,
    postInventoryAdjustmentBody
  );

// Project stock (Projects Phase 2a): an untracked adjustment names the stripe
// it adjusts (the quantities page passes the row's owner), and reads the
// on-hand of that stripe only.
databaseTest(
  "an untracked adjustment adjusts the stripe it names",
  async () => {
    const f = await projectPostingFixture();
    try {
      await f.enableProjectStock();
      // 10 in common stock at 10.00, then 4 in the project's stock at 12.00.
      const { itemId, locationId } = await f.addStockedItem("adjusted", {
        quantity: 10,
        unitCost: 10
      });
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 4,
        unitCost: 12,
        postingDate: "2026-02-01"
      });

      // Set the project's stock to 3: a negative adjustment of 1 in its
      // stripe, relieved from its own layer at 12.00.
      const result = await postInventoryAdjustment(f.ctx, {
        adjustmentType: "Set Quantity",
        itemId,
        locationId,
        quantity: 3,
        projectId: f.projectId
      });
      expect(result.error).toBeNull();

      const stock = await f.db
        .selectFrom("itemStockQuantities")
        .select(["projectId", "quantityOnHand"])
        .where("itemId", "=", itemId)
        .where("companyId", "=", f.companyId)
        .orderBy("projectId")
        .execute();
      expect(
        stock.map((row) => [row.projectId, Number(row.quantityOnHand)])
      ).toEqual([
        ["", 10],
        [f.projectId, 3]
      ]);

      const relief = await f.db
        .selectFrom("costLedger")
        .select(["cost", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", itemId)
        .where("quantity", "<", 0)
        .executeTakeFirstOrThrow();
      expect(Number(relief.cost)).toEqual(-12);
      expect(relief.projectId).toEqual(f.projectId);
    } finally {
      await f.cleanup();
    }
  }
);
