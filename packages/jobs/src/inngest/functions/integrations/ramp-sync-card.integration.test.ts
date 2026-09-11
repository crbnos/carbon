import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { createMappingService } from "@carbon/ee/accounting";
import type { RampClient, RampTransaction } from "@carbon/ee/ramp.server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getJobDatabaseClient } from "../../../db";
import { stageOrResumeRampCardTransaction } from "./ramp-sync-card-stage";
import type { RampSyncContext } from "./ramp-sync-shared";

const runDatabaseTests = process.env.RUN_RAMP_DB_TESTS === "true";

vi.mock("@carbon/ee/ramp.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/ee/ramp.server")>()),
  confirmSyncs: vi.fn().mockResolvedValue(undefined)
}));

describe.skipIf(!runDatabaseTests)("Ramp card staging (Postgres)", () => {
  let db: Kysely<KyselyDatabase>;
  let fixture: {
    companyId: string;
    companyGroupId: string;
    baseCurrency: string;
    actorId: string;
    liabilityAccountId: string;
    expenseAccountId: string;
    correctedAccountId: string;
  };
  const rampIds: string[] = [];

  beforeAll(async () => {
    db = getJobDatabaseClient(2);
    const company = await db
      .selectFrom("company")
      .innerJoin("employeeJob", "employeeJob.companyId", "company.id")
      .innerJoin("user", "user.id", "employeeJob.id")
      .select([
        "company.id as companyId",
        "company.companyGroupId",
        "company.baseCurrencyCode as baseCurrency",
        "employeeJob.id as actorId"
      ])
      .where("company.companyGroupId", "is not", null)
      .where("user.active", "=", true)
      .limit(1)
      .executeTakeFirstOrThrow();
    if (!company.companyGroupId || !company.baseCurrency) {
      throw new Error("Card staging fixture company is incomplete");
    }
    const accounts = await db
      .selectFrom("account")
      .select(["id", "class"])
      .where("companyGroupId", "=", company.companyGroupId)
      .where("active", "=", true)
      .where("isGroup", "=", false)
      .where("class", "in", ["Liability", "Expense"])
      .execute();
    const liabilityAccountId = accounts.find(
      (account) => account.class === "Liability"
    )?.id;
    const expenseAccountId = accounts.find(
      (account) => account.class === "Expense"
    )?.id;
    const correctedAccountId = accounts.find(
      (account) =>
        account.class === "Expense" && account.id !== expenseAccountId
    )?.id;
    if (!liabilityAccountId || !expenseAccountId || !correctedAccountId) {
      throw new Error("Card staging fixture accounts are incomplete");
    }
    fixture = {
      ...company,
      companyGroupId: company.companyGroupId,
      baseCurrency: company.baseCurrency,
      liabilityAccountId,
      expenseAccountId,
      correctedAccountId
    };
  });

  afterAll(async () => {
    if (rampIds.length === 0) return;
    await db.transaction().execute(async (tx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(tx);
      const mappings = await tx
        .selectFrom("externalIntegrationMapping")
        .select("entityId")
        .where("companyId", "=", fixture.companyId)
        .where("integration", "=", "ramp")
        .where("entityType", "=", "cardTransaction")
        .where("externalId", "in", rampIds)
        .execute();
      const ids = mappings.map((mapping) => mapping.entityId);
      await tx
        .deleteFrom("externalIntegrationMapping")
        .where("companyId", "=", fixture.companyId)
        .where("integration", "=", "ramp")
        .where("entityType", "=", "cardTransaction")
        .where("externalId", "in", rampIds)
        .execute();
      if (ids.length > 0) {
        await tx
          .deleteFrom("cardTransactionLine")
          .where("companyId", "=", fixture.companyId)
          .where("cardTransactionId", "in", ids)
          .execute();
        await tx
          .deleteFrom("cardTransaction")
          .where("companyId", "=", fixture.companyId)
          .where("id", "in", ids)
          .execute();
      }
    });
  });

  function draftArgs(rampId: string, accountId = fixture.expenseAccountId) {
    return {
      rampId,
      companyId: fixture.companyId,
      actorId: fixture.actorId,
      type: "Charge" as const,
      amount: 25,
      currencyCode: fixture.baseCurrency,
      exchangeRate: 1,
      transactionDate: "2026-09-11",
      postingDate: "2026-09-11",
      cardAccountId: fixture.liabilityAccountId,
      offsetAccountId: null,
      merchantName: "Retry-safe merchant",
      supplierId: null,
      cardHolderName: null,
      memo: rampId,
      lines: [
        {
          accountId,
          costCenterId: null,
          description: "Ramp card staging",
          amount: 25
        }
      ]
    };
  }

  it("serializes concurrent staging on the tenant-scoped Ramp source id", async () => {
    const rampId = `ramp-card-${crypto.randomUUID()}`;
    rampIds.push(rampId);
    const [first, second] = await Promise.all([
      stageOrResumeRampCardTransaction(db, draftArgs(rampId)),
      stageOrResumeRampCardTransaction(db, draftArgs(rampId))
    ]);

    expect(second.cardTransactionId).toBe(first.cardTransactionId);
    expect([first.created, second.created].sort()).toEqual([false, true]);
  });

  it("rolls back the header and mapping when a line cannot be inserted", async () => {
    const rampId = `ramp-card-${crypto.randomUUID()}`;
    rampIds.push(rampId);
    const readableId = `CARD-ROLLBACK-${crypto.randomUUID()}`;

    await expect(
      stageOrResumeRampCardTransaction(db, {
        ...draftArgs(rampId, `acct_missing_${crypto.randomUUID()}`),
        readableId
      })
    ).rejects.toThrow();

    const [headers, mappings] = await Promise.all([
      db
        .selectFrom("cardTransaction")
        .select("id")
        .where("companyId", "=", fixture.companyId)
        .where("cardTransactionId", "=", readableId)
        .execute(),
      db
        .selectFrom("externalIntegrationMapping")
        .select("id")
        .where("companyId", "=", fixture.companyId)
        .where("integration", "=", "ramp")
        .where("entityType", "=", "cardTransaction")
        .where("externalId", "=", rampId)
        .execute()
    ]);
    expect(headers).toEqual([]);
    expect(mappings).toEqual([]);
  });

  it("atomically refreshes corrected header and coding on a mapped Draft", async () => {
    const rampId = `ramp-card-${crypto.randomUUID()}`;
    rampIds.push(rampId);
    const first = await stageOrResumeRampCardTransaction(db, draftArgs(rampId));
    const corrected = {
      ...draftArgs(rampId, fixture.correctedAccountId),
      amount: 30,
      merchantName: "Corrected merchant",
      cardHolderName: "Corrected holder",
      memo: "Corrected memo",
      postingDate: "2026-09-12",
      lines: [
        {
          accountId: fixture.correctedAccountId,
          amount: 30,
          description: "Recoded",
          costCenterId: null
        }
      ]
    };
    const resumed = await stageOrResumeRampCardTransaction(db, corrected);
    expect(resumed).toEqual({ ...first, created: false });
    const header = await db
      .selectFrom("cardTransaction")
      .selectAll()
      .where("id", "=", first.cardTransactionId)
      .where("companyId", "=", fixture.companyId)
      .executeTakeFirstOrThrow();
    expect(header).toMatchObject({
      amount: 30,
      merchantName: "Corrected merchant",
      cardHolderName: "Corrected holder",
      memo: "Corrected memo",
      status: "Draft"
    });
    const lines = await db
      .selectFrom("cardTransactionLine")
      .select(["accountId", "amount", "description"])
      .where("cardTransactionId", "=", first.cardTransactionId)
      .where("companyId", "=", fixture.companyId)
      .execute();
    expect(lines).toEqual([
      {
        accountId: fixture.correctedAccountId,
        amount: 30,
        description: "Recoded"
      }
    ]);

    await expect(
      stageOrResumeRampCardTransaction(db, {
        ...corrected,
        amount: 50,
        lines: [{ ...corrected.lines[0]!, accountId: "acct_missing" }]
      })
    ).rejects.toThrow();
    const retained = await db
      .selectFrom("cardTransaction")
      .select("amount")
      .where("id", "=", first.cardTransactionId)
      .where("companyId", "=", fixture.companyId)
      .executeTakeFirstOrThrow();
    expect(retained.amount).toBe(30);
    const retainedLines = await db
      .selectFrom("cardTransactionLine")
      .select(["accountId", "amount", "description"])
      .where("cardTransactionId", "=", first.cardTransactionId)
      .where("companyId", "=", fixture.companyId)
      .execute();
    expect(retainedLines).toEqual(lines);
  });

  it("retries a mapped Draft with current Ramp coding and leaves the Posted mapping unchanged", async () => {
    const { syncRampCardTransactions } = await import("./ramp-sync-card");
    const rampId = `ramp-card-${crypto.randomUUID()}`;
    rampIds.push(rampId);
    const staged = await stageOrResumeRampCardTransaction(
      db,
      draftArgs(rampId)
    );
    const client = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const functions = client.functions;
    vi.spyOn(client, "functions", "get").mockReturnValue(functions);
    const post = vi.spyOn(functions, "invoke").mockImplementation(async () => {
      const lines = await db
        .selectFrom("cardTransactionLine")
        .select("accountId")
        .where("cardTransactionId", "=", staged.cardTransactionId)
        .where("companyId", "=", fixture.companyId)
        .execute();
      if (
        lines.length !== 1 ||
        lines[0]?.accountId !== fixture.correctedAccountId
      ) {
        return { data: null, error: new Error("Account must be recoded") };
      }
      await db
        .updateTable("cardTransaction")
        .set({
          status: "Posted",
          postingDate: "2026-09-11",
          postedAt: "2026-09-11T12:00:00.000Z",
          postedBy: fixture.actorId
        })
        .where("id", "=", staged.cardTransactionId)
        .where("companyId", "=", fixture.companyId)
        .execute();
      return { data: null, error: new Error("response lost") };
    });
    const ctx: RampSyncContext = {
      client,
      db,
      mapping: createMappingService(db, fixture.companyId),
      companyId: fixture.companyId,
      metadata: {
        credentials: {
          type: "client_credentials",
          clientId: "integration-test",
          clientSecret: "integration-test",
          environment: "sandbox"
        },
        codingAccountScope: "expense",
        sync: {
          pullTransactions: true,
          pullBills: true,
          pullReimbursements: true,
          pushPurchaseOrders: true,
          pushInvoices: true
        }
      },
      baseCurrency: fixture.baseCurrency,
      companyGroupId: fixture.companyGroupId,
      decimalsCache: new Map([[fixture.baseCurrency, 2]]),
      exchangeRateCache: new Map()
    };
    let transaction: RampTransaction = {
      id: rampId,
      entity_amount: { value: 2500, currency: fixture.baseCurrency },
      accounting_date: "2026-09-11",
      memo: "Corrected Ramp source",
      accounting_field_selections: [
        {
          external_id: fixture.correctedAccountId,
          category_info: { type: "GL_ACCOUNT" }
        }
      ]
    };
    const ramp = {
      async *listTransactions() {
        yield [transaction];
      },
      getReceipt: async () => null
    } as unknown as RampClient;
    const result = await syncRampCardTransactions(
      ctx,
      ramp,
      undefined,
      fixture.liabilityAccountId
    );
    expect(result).toMatchObject({ failed: 0, created: 0, reconfirmed: 1 });
    expect(post).toHaveBeenCalledTimes(1);
    const header = await db
      .selectFrom("cardTransaction")
      .select(["status", "memo"])
      .where("id", "=", staged.cardTransactionId)
      .where("companyId", "=", fixture.companyId)
      .executeTakeFirstOrThrow();
    expect(header).toEqual({ status: "Posted", memo: "Corrected Ramp source" });
    transaction = {
      ...transaction,
      memo: "Must not overwrite Posted",
      accounting_field_selections: []
    };
    const retried = await syncRampCardTransactions(
      ctx,
      ramp,
      undefined,
      fixture.liabilityAccountId
    );
    expect(retried).toMatchObject({ failed: 0, reconfirmed: 1 });
    expect(post).toHaveBeenCalledTimes(1);
    const unchanged = await db
      .selectFrom("cardTransaction")
      .select("memo")
      .where("id", "=", staged.cardTransactionId)
      .where("companyId", "=", fixture.companyId)
      .executeTakeFirstOrThrow();
    expect(unchanged.memo).toBe("Corrected Ramp source");
    post.mockRestore();
  });

  it("anchors the Ramp source id before an ambiguous post response", async () => {
    const { createAndPostTransaction } = await import("./ramp-sync-card");
    const rampId = `ramp-card-${crypto.randomUUID()}`;
    rampIds.push(rampId);
    let observedId = "";
    const statusQuery = {
      select: () => statusQuery,
      eq: (column: string, value: string) => {
        if (column === "id") observedId = value;
        return statusQuery;
      },
      maybeSingle: async () => ({
        data:
          (await db
            .selectFrom("cardTransaction")
            .select("status")
            .where("id", "=", observedId)
            .where("companyId", "=", fixture.companyId)
            .executeTakeFirst()) ?? null,
        error: null
      })
    };
    const ambiguousClient = {
      functions: {
        invoke: async (
          _name: string,
          options: { body: { cardTransactionId: string } }
        ) => {
          await db
            .updateTable("cardTransaction")
            .set({
              status: "Posted",
              postingDate: "2026-09-11",
              postedAt: "2026-09-11T12:00:00.000Z",
              postedBy: fixture.actorId
            })
            .where("id", "=", options.body.cardTransactionId)
            .where("companyId", "=", fixture.companyId)
            .execute();
          return { data: null, error: new Error("response lost") };
        }
      },
      from: () => statusQuery
    } as unknown as SupabaseClient<Database>;
    const ctx: RampSyncContext = {
      client: ambiguousClient,
      db,
      mapping: createMappingService(db, fixture.companyId),
      companyId: fixture.companyId,
      metadata: {
        credentials: {
          type: "client_credentials",
          clientId: "integration-test",
          clientSecret: "integration-test",
          environment: "sandbox"
        },
        codingAccountScope: "expense",
        sync: {
          pullTransactions: true,
          pullBills: true,
          pullReimbursements: true,
          pushPurchaseOrders: true,
          pushInvoices: true
        }
      },
      baseCurrency: fixture.baseCurrency,
      companyGroupId: fixture.companyGroupId,
      decimalsCache: new Map(),
      exchangeRateCache: new Map()
    };

    const args: Parameters<typeof createAndPostTransaction>[1] = {
      rampId,
      type: "Charge",
      amount: 25,
      currencyCode: fixture.baseCurrency,
      transactionDate: "2026-09-11",
      postingDate: "2026-09-11",
      cardAccountId: fixture.liabilityAccountId,
      offsetAccountId: null,
      merchantName: "Retry-safe merchant",
      supplierId: null,
      cardHolderName: null,
      memo: rampId,
      lines: [
        {
          accountId: fixture.expenseAccountId,
          costCenterId: null,
          description: "Ambiguous post response",
          amount: 25
        }
      ],
      receiptIds: [],
      getReceipt: async () => null
    };
    const outcome = await createAndPostTransaction(ctx, args);

    if ("fail" in outcome) throw new Error(outcome.fail.message);
    const retried = await createAndPostTransaction(ctx, {
      ...args,
      memo: "Must not change a Posted document",
      amount: 100,
      lines: []
    });
    if ("fail" in retried) throw new Error(retried.fail.message);
    expect(retried.ok.referenceId).toBe(outcome.ok.referenceId);
    const mappings = await db
      .selectFrom("externalIntegrationMapping")
      .select("entityId")
      .where("companyId", "=", fixture.companyId)
      .where("integration", "=", "ramp")
      .where("entityType", "=", "cardTransaction")
      .where("externalId", "=", rampId)
      .execute();
    expect(mappings).toHaveLength(1);
    const headers = await db
      .selectFrom("cardTransaction")
      .select(["id", "amount", "memo"])
      .where("companyId", "=", fixture.companyId)
      .where("id", "=", mappings[0]?.entityId ?? "")
      .execute();
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({ amount: 25, memo: rampId });
  });
});
