// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A refusal at the edge of the cutover: the trial balance save takes only
// active posting accounts.

import { saveOpeningTrialBalance } from "@carbon/database/accounting-cutover-reads";
import { expect } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import { activationFixture, USER } from "../fixtures/activation";

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
