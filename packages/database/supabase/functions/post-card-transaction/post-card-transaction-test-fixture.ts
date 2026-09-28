import { sql } from "kysely";
import { Pool } from "pg";
import { type DB, getDatabaseClient } from "../lib/database.ts";

export const hasLocalDatabase: boolean = (() => {
  try {
    const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!databaseUrl) return false;
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(databaseUrl).hostname,
    );
  } catch {
    return false;
  }
})();

export function databaseTest(
  name: string,
  fn: () => void | Promise<void>,
): void {
  Deno.test({ name, ignore: !hasLocalDatabase, fn });
}

export async function connectCardTransactionTestDatabase() {
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!databaseUrl) {
    throw new Error("Card transaction regressions require SUPABASE_DB_URL");
  }
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Card transaction regressions require a local database");
  }
  const db = getDatabaseClient<DB>(
    new Pool(
      {
        hostname: url.hostname,
        port: Number(url.port),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.slice(1),
        controls: { decoders: { 1700: Number } },
        tls: { enabled: false },
      },
      1,
    ),
  );
  await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
    db,
  );
  return db;
}

export async function cardTransactionFixture(
  options: { cardTransactionId?: string } = {},
) {
  const db = await connectCardTransactionTestDatabase();
  const prefix = `cardtest-${
    crypto.randomUUID().replaceAll("-", "").slice(0, 12)
  }`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const cardTransactionId = options.cardTransactionId ??
    `${prefix}-card-transaction`;
  const lineId = `${prefix}-line`;
  const costCenterId = `${prefix}-cost-center`;
  const dimensionId = `${prefix}-dimension`;
  const account = (name: string) => `${prefix}-${name}`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx.insertInto("companyGroup").values({
      id: groupId,
      name: prefix,
      createdBy: "system",
    }).execute();
    await trx.insertInto("company").values({
      id: companyId,
      name: prefix,
      companyGroupId: groupId,
      baseCurrencyCode: "USD",
      timezone: "America/New_York",
    }).execute();
    await trx.insertInto("currency").values({
      code: "USD",
      decimalPlaces: 2,
      companyGroupId: groupId,
      createdBy: "system",
    }).execute();
    await trx.insertInto("account").values([
      {
        id: account("card"),
        name: "Card liability",
        class: "Liability",
        incomeBalance: "Balance Sheet",
        companyGroupId: groupId,
        createdBy: "system",
      },
      {
        id: account("expense"),
        name: "Card expense",
        class: "Expense",
        incomeBalance: "Income Statement",
        companyGroupId: groupId,
        createdBy: "system",
      },
      {
        id: account("bank"),
        name: "Bank",
        class: "Asset",
        incomeBalance: "Balance Sheet",
        companyGroupId: groupId,
        createdBy: "system",
      },
      {
        id: account("income"),
        name: "Cashback income",
        class: "Revenue",
        incomeBalance: "Income Statement",
        companyGroupId: groupId,
        createdBy: "system",
      },
    ]).execute();
    await trx.insertInto("companySettings").values({
      id: companyId,
      accountingEnabled: true,
    }).onConflict((oc) =>
      oc.column("id").doUpdateSet({ accountingEnabled: true })
    ).execute();
    await trx.insertInto("accountingPeriod").values({
      id: `${prefix}-period`,
      startDate: "2000-01-01",
      endDate: "2099-12-31",
      fiscalYear: 2099,
      periodNumber: 1,
      status: "Active",
      closeStatus: "Open",
      companyId,
      createdBy: "system",
    }).execute();
    await trx.insertInto("sequence").values({
      table: "journalEntry",
      name: "Card transaction journals",
      prefix: "CARDTEST-",
      companyId,
    }).execute();
    await trx.insertInto("dimension").values({
      id: dimensionId,
      name: "Cost Center",
      entityType: "CostCenter",
      companyGroupId: groupId,
      createdBy: "system",
    }).execute();
    await trx.insertInto("costCenter").values({
      id: costCenterId,
      name: "Card project",
      companyId,
      createdBy: "system",
    }).execute();
    await trx.insertInto("cardTransaction").values({
      id: cardTransactionId,
      cardTransactionId: `${prefix}-readable`,
      type: "Charge",
      status: "Draft",
      cardAccountId: account("card"),
      transactionDate: "2026-09-11",
      currencyCode: "USD",
      exchangeRate: 1,
      amount: 100,
      companyId,
      createdBy: "system",
    }).execute();
    await trx.insertInto("cardTransactionLine").values({
      id: lineId,
      cardTransactionId,
      accountId: account("expense"),
      costCenterId,
      description: "Card expense",
      amount: 100,
      sequence: 0,
      companyId,
      createdBy: "system",
    }).execute();
  });

  const args = {
    type: "post" as const,
    cardTransactionId,
    companyId,
    userId: "system",
  };

  return {
    db,
    args,
    account,
    cardTransactionId,
    companyId,
    costCenterId,
    dimensionId,
    groupId,
    lineId,
    connect: connectCardTransactionTestDatabase,
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx.updateTable("cardTransaction").set({
          status: "Draft",
          journalId: null,
          postedAt: null,
          postedBy: null,
          voidedAt: null,
          voidedBy: null,
        })
          .where("companyId", "=", companyId).execute();
        await trx.updateTable("journal").set({ status: "Draft" })
          .where("companyId", "=", companyId).execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx.deleteFrom("companyGroup").where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`
          .execute(trx);
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`
          .execute(trx);
      });
      await db.destroy();
    },
  };
}
