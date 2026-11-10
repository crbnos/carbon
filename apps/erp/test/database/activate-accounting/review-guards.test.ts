// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A refusal at the edge of the cutover: the trial balance save takes only
// active posting accounts.

import { getMigrationClearing, saveOpeningTrialBalance } from "@carbon/database/accounting-cutover-reads";
import { expect } from "vitest";
import { activateAccounting } from "../../../app/modules/accounting/accounting.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
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


databaseTest("offsetting control differences cannot hide an unrecorded supplier advance during activation", async () => {
  const f = await activationFixture();
  try {
    await f.db.updateTable("accountDefault").set({supplierPrepaymentAccount: f.account("fixed-assets"), scrapAccount:f.account("scrap")})
      .where("companyId","=",f.companyId).execute();
    const args = {companyId:f.companyId,cutoverDate:f.cutoverDate};
    const saved = await saveOpeningTrialBalance(f.db,{...args,userId:USER,lines:[
      {accountId:f.account("fixed-assets"),debit:100,credit:0},
      {accountId:f.account("payables"),debit:0,credit:100}
    ]});
    const clearing = await getMigrationClearing(f.db,args);
    expect(clearing.total).toBe(0);
    expect(clearing.reconciliationBlockers).toEqual([{accountId:f.account("fixed-assets"),trialBalance:100,carbon:0,difference:100}]);
    const refused = await invokePosting(handlesOf(f.ctx),"activate-accounting",{...args,confirmation:f.companyName},activateAccounting);
    expect(refused.error?.message).toBe(
      "Reconcile supplier prepayments on the trial balance before setting up accounting."
    );
    expect(await f.db.selectFrom("companySettings").select("accountingCutoverDate").where("id","=",f.companyId).executeTakeFirstOrThrow()).toEqual({accountingCutoverDate:null});
    expect(await f.db.selectFrom("journal").select("status").where("id","=",saved.journalId).where("companyId","=",f.companyId).executeTakeFirstOrThrow()).toEqual({status:"Draft"});
    expect(await f.db.selectFrom("journal").select("id").where("companyId","=",f.companyId).where("status","=","Posted").execute()).toEqual([]);
    await saveOpeningTrialBalance(f.db,{...args,userId:USER,lines:[]});
    const enabled = await invokePosting(handlesOf(f.ctx),"activate-accounting",{...args,confirmation:f.companyName},activateAccounting);
    expect(enabled.error).toBeNull();
    expect(await f.db.selectFrom("companySettings").select("accountingCutoverDate").where("id","=",f.companyId).executeTakeFirstOrThrow()).toEqual({accountingCutoverDate:f.cutoverDate});
  } finally {await f.cleanup();}
});
