// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The adjustment operation takes what the quantities page sends, and an API or
// MCP caller reaches the operation, not the page. Runs against the local stack
// (SUPABASE_DB_URL and its PostgREST); skipped without one.

import { expect } from "vitest";
import { adjustInventory } from "../../../app/modules/inventory/inventory.server";
import { alwaysPostFixture, seed, USER } from "../fixtures/always-post";
import { operationContext, postgrestTest } from "../fixtures/local-supabase";
import {
  PROJECT_TEST_USER,
  projectPostingFixture
} from "../fixtures/project-posting";

// The page always names a serial or lot for a Serial or Batch item, a new id
// for new stock; a caller that sends only the number must not book stock with
// no lot on a tracked item.
postgrestTest(
  "an increase of a batch item with only a batch number starts a lot with that number",
  async (serviceRole) => {
    const f = await alwaysPostFixture();
    try {
      const itemId = `${f.prefix}-batch`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: itemId,
            readableId: itemId,
            name: "Batch part",
            type: "Part",
            itemTrackingType: "Batch",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("itemCost")
          .set({ costingMethod: "FIFO", unitCost: 10 })
          .where("itemId", "=", itemId)
          .where("companyId", "=", f.companyId)
          .execute();
      });

      const result = await adjustInventory(
        operationContext(f, serviceRole, USER),
        {
          itemId,
          adjustmentType: "Positive Adjmt.",
          quantity: 5,
          locationId: f.locationId,
          readableId: "B-100"
        }
      );
      expect(result.error).toBeNull();

      const rows = await f.db
        .selectFrom("itemLedger as il")
        .leftJoin("trackedEntity as te", "te.id", "il.trackedEntityId")
        .select(["il.quantity", "te.readableId", "te.status", "te.quantity as lot"])
        .where("il.itemId", "=", itemId)
        .where("il.companyId", "=", f.companyId)
        .execute();
      expect(
        rows.map((row) => ({
          quantity: Number(row.quantity),
          readableId: row.readableId,
          status: row.status,
          lot: Number(row.lot)
        }))
      ).toEqual([
        { quantity: 5, readableId: "B-100", status: "Available", lot: 5 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

// The page sends the row's stock owner; an operation input without the field
// dropped it, and the adjustment landed on common stock.
postgrestTest(
  "an adjustment sets the stock of the owner it names",
  async (serviceRole) => {
    const f = await projectPostingFixture();
    try {
      await f.enableProjectStock();
      // 10 in common stock, 4 in the project's stock.
      const { itemId, locationId } = await f.addStockedItem("owned", {
        quantity: 10,
        unitCost: 10
      });
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 4,
        unitCost: 12
      });

      const result = await adjustInventory(
        operationContext(f, serviceRole, PROJECT_TEST_USER),
        {
          itemId,
          adjustmentType: "Set Quantity",
          quantity: 3,
          locationId,
          projectId: f.projectId
        }
      );
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
    } finally {
      await f.cleanup();
    }
  }
);
