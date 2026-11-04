// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { postStockMovementCorrection } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

type Ctx = Parameters<typeof handlesOf>[0];

const correctStockMovement = (
  ctx: Ctx,
  input: Parameters<typeof postStockMovementCorrection>[1]
) =>
  invokePosting(
    handlesOf(ctx),
    "correct-stock-movement",
    input,
    postStockMovementCorrection
  );

// Project stock (Projects Phase 2a): a correction copies the stripe of the
// movement it corrects, so its ledger row and its cost relief stay in the
// project's stock.
databaseTest(
  "a correction of a project stock movement stays in the project's stripe",
  async () => {
    const f = await projectPostingFixture();
    try {
      await f.enableProjectStock();
      // 10 in common stock at 10.00, then 4 in the project's stock at 12.00.
      const { itemId, locationId } = await f.addStockedItem("striped", {
        quantity: 10,
        unitCost: 10
      });
      const striped = await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 4,
        unitCost: 12,
        postingDate: "2026-02-01"
      });

      // The movement should have been 3, not 4.
      const result = await correctStockMovement(f.ctx, {
        itemLedgerId: striped.itemLedgerId,
        correctedQuantity: 3
      });
      expect(result.error).toBeNull();

      const correction = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "projectId"])
        .where("correctionOfItemLedgerId", "=", striped.itemLedgerId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(correction.quantity)).toEqual(-1);
      expect(correction.projectId).toEqual(f.projectId);

      // The relief comes from the project's layer at 12.00, not the older
      // common layer at 10.00, and the relief row carries the stripe.
      const relief = await f.db
        .selectFrom("costLedger")
        .select(["cost", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", itemId)
        .where("quantity", "<", 0)
        .executeTakeFirstOrThrow();
      expect(Number(relief.cost)).toEqual(-12);
      expect(relief.projectId).toEqual(f.projectId);
      const projectLayer = await f.db
        .selectFrom("costLedger")
        .select("remainingQuantity")
        .where("id", "=", striped.costLedgerId)
        .executeTakeFirstOrThrow();
      expect(Number(projectLayer.remainingQuantity)).toEqual(3);

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
