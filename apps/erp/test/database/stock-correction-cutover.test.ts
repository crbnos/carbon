// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.
// A stock correction refuses a movement dated before the cutover: its value
// sits in the opening balance.

import {
  activationFixture,
  moveBeforeCutover,
  receiveFiveParts,
  USER
} from "./fixtures/activation";
import { STOCK_CORRECTION_BEFORE_CUTOVER_ERROR } from "~/modules/shared/shared.service";
import { databaseTest } from "./fixtures/local-database";
import { sql } from "kysely";
import { expect } from "vitest";
import { postStockMovementCorrection } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";

databaseTest(
  "a stock correction of a movement dated before the cutover is refused",
  async () => {
    const f = await activationFixture();
    try {
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await moveBeforeCutover(f);
      // The company has a cutover; the receipt is dated the day before it.
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .updateTable("companySettings")
          .set({ accountingCutoverDate: f.cutoverDate })
          .where("id", "=", f.companyId)
          .execute();
      });
      const movement = await f.db
        .selectFrom("itemLedger")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", f.partId)
        .where("quantity", ">", 0)
        .executeTakeFirstOrThrow();

      const result = await invokePosting(
        { db: f.db, companyId: f.companyId, userId: USER },
        "correct-stock-movement",
        { itemLedgerId: movement.id, correctedQuantity: 4 },
        postStockMovementCorrection
      );

      expect(result.error?.message).toBe(STOCK_CORRECTION_BEFORE_CUTOVER_ERROR);
      // Nothing was written: the movement has no correction.
      const corrections = await f.db
        .selectFrom("itemLedger")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("correctionOfItemLedgerId", "=", movement.id)
        .execute();
      expect(corrections).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
