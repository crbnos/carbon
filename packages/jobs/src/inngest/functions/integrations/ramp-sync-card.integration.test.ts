import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { createMappingService } from "@carbon/ee/accounting";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getJobDatabaseClient } from "../../../db";
import { stageOrResumeRampCardTransaction } from "./ramp-sync-card-stage";
import type { RampSyncContext } from "./ramp-sync-shared";

const runDatabaseTests = process.env.RUN_RAMP_DB_TESTS === "true";

describe.skipIf(!runDatabaseTests)("Ramp card staging (Postgres)", () => {
  let db: Kysely<KyselyDatabase>;
  let fixture: {
    companyId: string;
    companyGroupId: string;
    baseCurrency: string;
    actorId: string;
    liabilityAccountId: string;
    expenseAccountId: string;
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
    if (!liabilityAccountId || !expenseAccountId) {
      throw new Error("Card staging fixture accounts are incomplete");
    }
    fixture = {
      ...company,
      companyGroupId: company.companyGroupId,
      baseCurrency: company.baseCurrency,
      liabilityAccountId,
      expenseAccountId
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
    const retried = await createAndPostTransaction(ctx, args);
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
      .select("id")
      .where("companyId", "=", fixture.companyId)
      .where("id", "=", mappings[0]?.entityId ?? "")
      .execute();
    expect(headers).toHaveLength(1);
  });
});
