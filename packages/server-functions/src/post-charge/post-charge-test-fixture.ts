// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { connectLocalTestDatabase } from "../local-database-test-fixture";

export async function chargeFixture(options: { chargeId?: string } = {}) {
  const db = await connectLocalTestDatabase();
  const prefix = `cardtest-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const chargeId = options.chargeId ?? `${prefix}-charge`;
  const lineId = `${prefix}-line`;
  const costCenterId = `${prefix}-cost-center`;
  const dimensionId = `${prefix}-dimension`;
  const account = (name: string) => `${prefix}-${name}`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({
        id: groupId,
        name: prefix,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("currency")
      .values({
        code: "USD",
        decimalPlaces: 2,
        companyGroupId: groupId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("account")
      .values([
        {
          id: account("card"),
          name: "Card liability",
          class: "Liability",
          incomeBalance: "Balance Sheet",
          companyGroupId: groupId,
          createdBy: "system"
        },
        {
          id: account("expense"),
          name: "Card expense",
          class: "Expense",
          incomeBalance: "Income Statement",
          companyGroupId: groupId,
          createdBy: "system"
        },
        {
          id: account("bank"),
          name: "Bank",
          class: "Asset",
          incomeBalance: "Balance Sheet",
          companyGroupId: groupId,
          createdBy: "system"
        },
        {
          id: account("income"),
          name: "Cashback income",
          class: "Revenue",
          incomeBalance: "Income Statement",
          companyGroupId: groupId,
          createdBy: "system"
        }
      ])
      .execute();
    await trx
      .insertInto("companySettings")
      .values({
        id: companyId,
        accountingCutoverDate: "2000-01-01"
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          accountingCutoverDate: "2000-01-01"
        })
      )
      .execute();
    await trx
      .insertInto("accountingPeriod")
      .values({
        id: `${prefix}-period`,
        startDate: "2000-01-01",
        endDate: "2099-12-31",
        fiscalYear: 2099,
        periodNumber: 1,
        status: "Active",
        closeStatus: "Open",
        companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("sequence")
      .values({
        table: "journalEntry",
        name: "Charge journals",
        prefix: "CARDTEST-",
        companyId
      })
      .execute();
    await trx
      .insertInto("dimension")
      .values({
        id: dimensionId,
        name: "Cost Center",
        entityType: "CostCenter",
        companyGroupId: groupId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("costCenter")
      .values({
        id: costCenterId,
        name: "Card project",
        companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("charge")
      .values({
        id: chargeId,
        chargeId: `${prefix}-readable`,
        type: "Charge",
        status: "Draft",
        cardAccountId: account("card"),
        transactionDate: "2026-09-11",
        currencyCode: "USD",
        exchangeRate: 1,
        amount: 100,
        companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("chargeLine")
      .values({
        id: lineId,
        chargeId,
        accountId: account("expense"),
        costCenterId,
        description: "Card expense",
        amount: 100,
        sequence: 0,
        companyId,
        createdBy: "system"
      })
      .execute();
  });

  const args = {
    type: "post" as const,
    chargeId,
    companyId,
    userId: "system"
  };

  return {
    db,
    args,
    account,
    chargeId,
    companyId,
    costCenterId,
    dimensionId,
    groupId,
    lineId,
    connect: connectLocalTestDatabase,
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("charge")
          .set({
            status: "Draft",
            journalId: null,
            postedAt: null,
            postedBy: null,
            voidedAt: null,
            voidedBy: null
          })
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .updateTable("journal")
          .set({ status: "Draft" })
          .where("companyId", "=", companyId)
          .execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}
