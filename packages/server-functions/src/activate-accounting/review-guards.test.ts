// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Two refusals at the edge of the cutover: the trial balance save takes only
// active posting accounts, and a stock correction refuses a movement dated
// before the cutover (its value sits in the opening balance).

import { saveOpeningTrialBalance } from "@carbon/database/accounting-cutover-reads";
import { sql } from "kysely";
import { expect } from "vitest";
import correctStockMovement from "../correct-stock-movement";
import { STOCK_CORRECTION_BEFORE_CUTOVER_ERROR } from "../lib/cutover-void";
import { databaseTest } from "../local-database-test-fixture";
import {
  activationFixture,
  moveBeforeCutover,
  receiveFiveParts,
  USER
} from "./activation-test-fixture";

databaseTest(
  "the trial balance save refuses a group account and an inactive account",
  async () => {
    const f = await activationFixture();
    try {
      await f.db
        .insertInto("account")
        .values([
          {
            id: `${f.prefix}-group-account`,
            name: "Group account",
            class: "Asset",
            incomeBalance: "Balance Sheet",
            isGroup: true,
            companyGroupId: f.groupId,
            createdBy: USER
          },
          {
            id: `${f.prefix}-inactive-account`,
            name: "Inactive account",
            class: "Asset",
            incomeBalance: "Balance Sheet",
            active: false,
            companyGroupId: f.groupId,
            createdBy: USER
          }
        ])
        .execute();
      const save = (accountId: string) =>
        saveOpeningTrialBalance(f.db, {
          companyId: f.companyId,
          cutoverDate: f.cutoverDate,
          userId: USER,
          lines: [
            { accountId, debit: 10, credit: 0 },
            { accountId: f.account("retained-earnings"), debit: 0, credit: 10 }
          ]
        });

      await expect(save(`${f.prefix}-group-account`)).rejects.toThrow(
        "Account Group account must be an active posting account"
      );
      await expect(save(`${f.prefix}-inactive-account`)).rejects.toThrow(
        "Account Inactive account must be an active posting account"
      );
      // A posting account still saves.
      await expect(save(f.account("bank"))).resolves.toMatchObject({
        journalId: expect.any(String)
      });
    } finally {
      await f.cleanup();
    }
  }
);

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

      const result = await correctStockMovement(f.ctx, {
        itemLedgerId: movement.id,
        correctedQuantity: 4
      });

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
