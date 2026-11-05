// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// An asset under construction at the cutover opens at its cost then, on its
// construction-in-progress class. Its cost and capitalization after the
// cutover reach the books through their own promoted journals, not twice.

import {
  getCutoverFixedAssets,
  getMigrationClearing,
  saveOpeningTrialBalance
} from "@carbon/database/accounting-cutover-reads";
import { GL_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  activateAccounting,
  postAssetTransfer
} from "../../../app/modules/accounting/accounting.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import {
  activationFixture,
  type Fixture,
  glBalance,
  USER,
  unwrap
} from "../fixtures/activation";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";

/** A construction-in-progress class on its own account, an in-service class,
 *  and one asset under construction since before the cutover. */
async function assetUnderConstruction(f: Fixture) {
  const cipAccountId = `${f.prefix}-cip`;
  const cipClassId = `${f.prefix}-cip-class`;
  const machineryClassId = `${f.prefix}-machinery`;
  const assetId = `${f.prefix}-asset`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .updateTable("accountDefault")
      .set({ scrapAccount: f.account("scrap") })
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("sequence")
      .values({
        table: "fixedAssetTransfer",
        name: "Fixed Asset Transfer",
        prefix: "FAT",
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("account")
      .values({
        id: cipAccountId,
        name: "cip",
        class: "Asset",
        incomeBalance: "Balance Sheet",
        companyGroupId: f.groupId,
        createdBy: USER
      })
      .execute();
    const classAccounts = {
      accumulatedDepreciationAccountId: f.account("accumulated-depreciation"),
      depreciationExpenseAccountId: f.account("depreciation"),
      lossOnDisposalAccountId: f.account("loss-on-disposal"),
      gainOnDisposalAccountId: f.account("sales"),
      writeOffAccountId: f.account("loss-on-disposal"),
      writeDownAccountId: f.account("loss-on-disposal"),
      companyId: f.companyId,
      createdBy: USER
    };
    await trx
      .insertInto("fixedAssetClass")
      .values([
        {
          ...classAccounts,
          id: cipClassId,
          name: "Construction in Progress",
          isConstructionInProgress: true,
          assetAccountId: cipAccountId
        },
        {
          ...classAccounts,
          id: machineryClassId,
          name: "Machinery",
          assetAccountId: f.account("fixed-assets")
        }
      ])
      .execute();
    await trx
      .insertInto("fixedAsset")
      .values({
        id: assetId,
        fixedAssetId: "FA-CIP",
        name: "Test cell",
        fixedAssetClassId: cipClassId,
        status: "Under Construction",
        acquisitionCost: 0,
        acquisitionDate: f.beforeCutover,
        depreciationStartDate: f.beforeCutover,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return { cipAccountId, cipClassId, machineryClassId, assetId };
}

/** A construction cost on the asset, with its Provisional journal (Dr the
 *  construction-in-progress account / Cr the filler account). */
async function addCipCost(
  f: Fixture,
  args: { assetId: string; cipAccountId: string; amount: number; date: string }
) {
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId: `${f.prefix}-JE-${args.date}`,
        description: "Construction cost",
        postingDate: args.date,
        sourceType: "Purchase Invoice",
        status: "Provisional",
        accountingPeriodId: null,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("journalLine")
      .values(
        [
          [args.cipAccountId, args.amount],
          [f.account("filler"), -args.amount]
        ].map(([accountId, amount], index) => ({
          journalId: journal.id,
          accountId: accountId as string,
          description: "Construction cost",
          amount: amount as number,
          quantity: 0,
          journalLineReference: `${f.prefix}-${args.date}-${index}`,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("fixedAssetCipCost")
      .values({
        fixedAssetId: args.assetId,
        sourceType: "Manual",
        amount: args.amount,
        costDate: args.date,
        journalId: journal.id,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("fixedAsset")
      .set({ acquisitionCost: sql`"acquisitionCost" + ${args.amount}` })
      .where("id", "=", args.assetId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
}

async function balanceOf(f: Fixture, accountId: string) {
  const row = await f.db
    .selectFrom("journalLine as line")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "line.journalId")
        .onRef("journal.companyId", "=", "line.companyId")
    )
    .select(sql<number>`coalesce(sum("line"."amount"), 0)`.as("balance"))
    .where("line.companyId", "=", f.companyId)
    .where("line.accountId", "=", accountId)
    .where("journal.status", "in", [...GL_JOURNAL_STATUSES])
    .executeTakeFirstOrThrow();
  return Number(row.balance);
}

databaseTest(
  "a construction cost and a capitalization after the cutover are not counted twice",
  async () => {
    const f = await activationFixture();
    try {
      const { cipAccountId, cipClassId, machineryClassId, assetId } =
        await assetUnderConstruction(f);
      await addCipCost(f, {
        assetId,
        cipAccountId,
        amount: 100,
        date: f.beforeCutover
      });
      // After the cutover: 40.00 more, then the asset goes into service.
      await addCipCost(f, { assetId, cipAccountId, amount: 40, date: f.today });
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-asset-transfer",
          {
            type: "capitalizeCip",
            fixedAssetId: assetId,
            toClassId: machineryClassId,
            inServiceDate: f.today
          },
          postAssetTransfer
        )
      );

      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      // At the cutover the asset held 100.00 on its construction class.
      expect(
        (await getCutoverFixedAssets(f.db, args)).map((asset) => ({
          id: asset.id,
          fixedAssetClassId: asset.fixedAssetClassId,
          cost: asset.cost,
          assetAccountId: asset.assetAccountId
        }))
      ).toEqual([
        {
          id: assetId,
          fixedAssetClassId: cipClassId,
          cost: 100,
          assetAccountId: cipAccountId
        }
      ]);

      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: cipAccountId, debit: 100, credit: 0 },
          { accountId: f.account("retained-earnings"), debit: 0, credit: 100 }
        ]
      });
      expect((await getMigrationClearing(f.db, args)).total).toBe(0);
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "activate-accounting",
          { ...args, confirmation: f.companyName },
          activateAccounting
        )
      );

      // The opening 100.00, the 40.00 after it, then the capitalization's
      // 140.00 out to the in-service class.
      expect(await balanceOf(f, cipAccountId)).toBe(0);
      expect(await glBalance(f, "fixed-assets")).toBe(140);
    } finally {
      await f.cleanup();
    }
  }
);
