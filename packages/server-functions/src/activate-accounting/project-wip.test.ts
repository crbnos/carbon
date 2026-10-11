// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Project and service cost on the WIP control account that no job holds gets
// one opening item: its lines before the cutover, less the Cost Relief rows
// before it that credit the account (the enable posts those with no journal).

import {
  getMigrationClearing,
  saveOpeningTrialBalance
} from "@carbon/database/accounting-cutover-reads";
import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import activateAccounting from ".";
import {
  activationFixture,
  type Fixture,
  glBalance,
  USER,
  unwrap
} from "./activation-test-fixture";

/** A Contract project whose Project WIP is the WIP account, charged 100.00
 *  before the cutover, with 30.00 of it relieved by a Cost Relief row the
 *  revenue run planned before the cutover. */
async function projectCostBeforeCutover(f: Fixture) {
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .updateTable("accountDefault")
      .set({
        projectWorkInProgressAccount: f.account("wip"),
        scrapAccount: f.account("scrap")
      })
      .where("companyId", "=", f.companyId)
      .execute();
    const project = await trx
      .insertInto("project")
      .values({
        name: "Contract",
        costTreatment: "Contract",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId: `${f.prefix}-JE-PI`,
        description: "Project Issue",
        postingDate: f.beforeCutover,
        sourceType: "Project Issue",
        status: "Provisional",
        accountingPeriodId: null,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const line = {
      journalId: journal.id,
      quantity: 0,
      documentType: "Project Issue" as const,
      documentId: project.id,
      companyId: f.companyId,
      createdBy: USER
    };
    await trx
      .insertInto("journalLine")
      .values([
        {
          ...line,
          accountId: f.account("wip"),
          description: "Project WIP",
          amount: 100,
          journalLineReference: `${f.prefix}-pi-wip`
        },
        {
          ...line,
          accountId: f.account("inventory"),
          description: "Inventory",
          amount: -100,
          journalLineReference: `${f.prefix}-pi-inv`
        }
      ])
      .execute();
    await trx
      .insertInto("revenueRecognitionSchedule")
      .values({
        type: "Cost Relief",
        status: "Planned",
        periodStart: f.beforeCutover,
        periodEnd: f.beforeCutover,
        scheduledDate: f.beforeCutover,
        amount: 30,
        debitAccountId: f.account("cogs"),
        creditAccountId: f.account("wip"),
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
}

databaseTest(
  "project cost on the WIP account before the cutover opens as one WIP item",
  async () => {
    const f = await activationFixture();
    try {
      await projectCostBeforeCutover(f);
      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };

      // The prior system holds the 70.00 still in WIP.
      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("wip"), debit: 70, credit: 0 },
          { accountId: f.account("retained-earnings"), debit: 0, credit: 70 }
        ]
      });
      const clearing = await getMigrationClearing(f.db, args);
      expect(
        clearing.items
          .filter((item) => item.accountId === f.account("wip"))
          .map((item) => [item.documentId, item.amount])
      ).toEqual([[null, 70]]);
      expect(clearing.total).toBe(0);
      expect(
        clearing.rows.find((row) => row.accountId === f.account("wip"))
          ?.difference
      ).toBe(0);

      unwrap(
        await activateAccounting(f.ctx, {
          ...args,
          confirmation: f.companyName
        })
      );
      expect(await glBalance(f, "wip")).toBe(70);

      // The revenue run after the cutover relieves the remaining 70.00 (its
      // Cost Relief journal: Dr cost of goods sold / Cr WIP). WIP ends at
      // zero, not below it.
      const period = await f.db
        .selectFrom("accountingPeriod")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("startDate", "<=", f.today)
        .where("endDate", ">=", f.today)
        .executeTakeFirstOrThrow();
      const relief = await f.db
        .insertInto("journal")
        .values({
          journalEntryId: `${f.prefix}-JE-CR`,
          description: "Cost Relief",
          postingDate: f.today,
          sourceType: "Revenue Recognition",
          status: "Posted",
          accountingPeriodId: period.id,
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await f.db
        .insertInto("journalLine")
        .values([
          {
            journalId: relief.id,
            accountId: f.account("cogs"),
            description: "Cost Relief",
            amount: 70,
            quantity: 0,
            journalLineReference: `${f.prefix}-cr-cogs`,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            journalId: relief.id,
            accountId: f.account("wip"),
            description: "Cost Relief",
            amount: -70,
            quantity: 0,
            journalLineReference: `${f.prefix}-cr-wip`,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
      expect(await glBalance(f, "wip")).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);
