// Isolated local fixtures shared by transaction and concurrency regressions.
import { sql } from "kysely";
import { type DB, getDatabaseClient } from "../lib/database.ts";
import { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/types.ts";

export async function connectPaymentTestDatabase() {
  const url = new URL(Deno.env.get("SUPABASE_DB_URL") ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Payment regressions require an existing local database");
  }
  const db = getDatabaseClient<DB>(
    new Pool({
      hostname: url.hostname,
      port: Number(url.port),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      controls: { decoders: { 1700: Number } },
      tls: { enabled: false },
    }, 1),
  );
  // The fixture uses the pool's single connection; requests in the real seam
  // therefore inherit trigger suppression even when they open a new transaction.
  await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
    db,
  );
  return db;
}

export async function paymentFixture() {
  const db = await connectPaymentTestDatabase();
  const prefix = `accttest-${
    crypto.randomUUID().replaceAll("-", "").slice(0, 12)
  }`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const customerId = `${prefix}-customer`;
  const invoiceId = `${prefix}-invoice`;
  const periodId = `${prefix}-period`;
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
    await trx.insertInto("currency").values(
      ["USD", "EUR"].map((code) => ({
        code,
        decimalPlaces: 2,
        companyGroupId: groupId,
        createdBy: "system",
      })),
    ).execute();
    await trx.insertInto("account").values([
      { name: "bank", class: "Asset" as const },
      { name: "control", class: "Asset" as const },
      { name: "sales", class: "Revenue" as const },
      { name: "gain", class: "Revenue" as const },
      { name: "loss", class: "Expense" as const },
      { name: "discount", class: "Expense" as const },
      { name: "writeoff", class: "Expense" as const },
    ].map((row) => ({
      id: account(row.name),
      name: row.name,
      class: row.class,
      incomeBalance: row.class === "Asset"
        ? "Balance Sheet" as const
        : "Income Statement" as const,
      companyGroupId: groupId,
      createdBy: "system",
    }))).execute();
    await sql`INSERT INTO "accountDefault" SELECT (jsonb_populate_record(NULL::"accountDefault",
      (SELECT jsonb_object_agg(attname, to_jsonb(${
      account("control")
    }::text)) FROM pg_attribute
       WHERE attrelid='"accountDefault"'::regclass AND attnum>0 AND NOT attisdropped AND attnotnull AND attname<>'companyId')
      || jsonb_build_object('companyId', ${companyId}::text, 'receivablesAccount', ${
      account("control")
    }::text,
         'salesAccount', ${account("sales")}::text, 'bankCashAccount', ${
      account("bank")
    }::text,
         'realizedExchangeGainAccount', ${
      account("gain")
    }::text, 'realizedExchangeLossAccount', ${account("loss")}::text,
         'customerPaymentDiscountAccount', ${
      account("discount")
    }::text, 'customerWriteOffAccount', ${account("writeoff")}::text))).*`
      .execute(trx);
    await trx.insertInto("companySettings").values({
      id: companyId,
      accountingEnabled: true,
    }).onConflict((oc) =>
      oc.column("id").doUpdateSet({ accountingEnabled: true })
    ).execute();
    await trx.insertInto("accountingPeriod").values({
      id: periodId,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      status: "Active",
      closeStatus: "Open",
      companyId,
      createdBy: "system",
    }).execute();
    await trx.insertInto("sequence").values({
      table: "journalEntry",
      name: "Test journals",
      prefix: "TEST-",
      companyId,
    }).execute();
    await trx.insertInto("customer").values({
      id: customerId,
      name: prefix,
      companyId,
    }).execute();
    await trx.insertInto("salesInvoice").values({
      id: invoiceId,
      invoiceId: "TEST-INVOICE",
      customerId,
      currencyCode: "EUR",
      exchangeRate: 1.1,
      status: "Submitted",
      companyId,
      createdBy: "system",
    }).execute();
    await trx.insertInto("salesInvoiceLine").values({
      invoiceId,
      invoiceLineType: "Service",
      quantity: 1,
      unitPrice: 100,
      unitOfMeasureCode: "EA",
      companyId,
      createdBy: "system",
    }).execute();
    const journal = await trx.insertInto("journal").values({
      journalEntryId: "TEST-ORIGINAL",
      accountingPeriodId: periodId,
      companyId,
      sourceType: "Sales Invoice",
      status: "Posted",
      postingDate: "2026-09-01",
      createdBy: "system",
    }).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("journalLine").values([
      { accountId: account("control"), description: "Accounts Receivable" },
      { accountId: account("sales"), description: "Sales" },
    ].map((row) => ({
      ...row,
      amount: 100,
      quantity: 1,
      documentType: "Invoice" as const,
      documentId: invoiceId,
      journalLineReference: `${prefix}-reference`,
      journalId: journal.id,
      companyId,
    }))).execute();
  });
  const client = {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        lte: () => query,
        single: async () => ({
          data: { id: periodId, status: "Active", closeStatus: "Open" },
          error: null,
        }),
      };
      return query;
    },
  } as unknown as SupabaseClient<Database>;
  const args = {
    type: "post" as const,
    companyId,
    userId: "system",
    today: "2026-09-07",
    client,
  };
  return {
    db,
    args,
    companyId,
    groupId,
    invoiceId,
    customerId,
    account,
    connect: connectPaymentTestDatabase,
    async payment(
      input: {
        amount?: number;
        rate?: number;
        status?: "Draft" | "Posted";
        sourceAmount?: number;
        appliedAmount?: number;
        targetRate?: number;
        noApplication?: boolean;
        sourcePaymentId?: string;
        invoiceId?: string;
      } = {},
    ) {
      const id = `${prefix}-payment-${crypto.randomUUID()}`;
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.insertInto("payment").values({
          id,
          paymentId: id,
          paymentType: "Receipt",
          customerId,
          paymentDate: "2026-09-01",
          postingDate: "2026-09-01",
          currencyCode: "EUR",
          totalAmount: input.amount ?? 110,
          exchangeRate: input.rate ?? 1.1,
          bankAccount: account("bank"),
          status: input.status ?? "Draft",
          companyId,
          createdBy: "system",
        }).execute();
        if (!input.noApplication) {
          await trx.insertInto("invoiceSettlement").values({
            paymentId: id,
            targetSalesInvoiceId: input.invoiceId ?? invoiceId,
            sourceAmount: input.sourceAmount ?? 110,
            appliedAmount: input.appliedAmount ?? 100,
            sourcePaymentId: input.sourcePaymentId,
            sourceExchangeRate: 99,
            targetExchangeRate: input.targetRate ?? 99,
            appliedDate: "2026-09-01",
            companyId,
            createdBy: "system",
          }).execute();
        }
      });
      return id;
    },
    async invoice(input: { amount?: number; rate?: number } = {}) {
      const id = `${prefix}-invoice-${crypto.randomUUID()}`;
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.insertInto("salesInvoice").values({
          id,
          invoiceId: id,
          customerId,
          currencyCode: "EUR",
          exchangeRate: input.rate ?? 1.1,
          status: "Submitted",
          companyId,
          createdBy: "system",
        }).execute();
        await trx.insertInto("salesInvoiceLine").values({
          invoiceId: id,
          invoiceLineType: "Service",
          quantity: 1,
          unitPrice: input.amount ?? 100,
          unitOfMeasureCode: "EA",
          companyId,
          createdBy: "system",
        }).execute();
        const journal = await trx.insertInto("journal").values({
          journalEntryId: id,
          accountingPeriodId: periodId,
          companyId,
          sourceType: "Sales Invoice",
          status: "Posted",
          postingDate: "2026-09-01",
          createdBy: "system",
        }).returning("id").executeTakeFirstOrThrow();
        await trx.insertInto("journalLine").values([
          { accountId: account("control"), description: "Accounts Receivable" },
          { accountId: account("sales"), description: "Sales" },
        ].map((row) => ({
          ...row,
          amount: input.amount ?? 100,
          quantity: 1,
          documentType: "Invoice" as const,
          documentId: id,
          journalLineReference: id,
          journalId: journal.id,
          companyId,
        }))).execute();
      });
      return id;
    },
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        // Test-owned committed journals are immutable. Temporarily bypass only
        // for their cleanup status update; restore normal FK cascades immediately.
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx.updateTable("journal").set({ status: "Draft" }).where(
          "companyId",
          "=",
          companyId,
        ).execute();
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
