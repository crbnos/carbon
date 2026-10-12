// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Contract revenue posting (plan D5/D6): the invoice moves its contract line's
// position, the recognition run synthesizes Deferral / Accrual rows from the
// revenue plan, and a VOID negates and normalizes. The pure planner is pinned
// first; the rest runs against the live database on `paymentFixture`'s company.

import { EMPTY_POSITION } from "@carbon/database/contract-position";
import type { SalesPostingAccount } from "@carbon/database/sales-posting-amounts";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { paymentFixture } from "../post-payment/payment-test-fixture";
import proposeRevenueRecognitionRun from "../propose-revenue-recognition-run";
import { dropRecognitionRuns } from "../propose-revenue-recognition-run/run-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import { planContractInvoiceLine } from "./contract-posting";
import postSalesInvoice from "./index";

const leaf = (id: string, accountClass: string): SalesPostingAccount => ({
  id,
  class: accountClass,
  active: true,
  isGroup: false,
  companyGroupId: "g"
});
const accounts = {
  deferredRevenue: leaf("deferred", "Liability"),
  contractAsset: leaf("asset", "Asset"),
  fxGain: leaf("gain", "Revenue"),
  fxLoss: leaf("loss", "Expense")
};

describe("planContractInvoiceLine", () => {
  it("defers a line billed ahead, with no reclass", () => {
    const plan = planContractInvoiceLine({
      position: EMPTY_POSITION,
      revenueBase: 3000,
      rate: 1,
      accounts,
      customerContractId: "c"
    });
    expect(
      plan.revenueLegs.map((leg) => [leg.account?.id, leg.amount])
    ).toEqual([
      ["asset", 0],
      ["deferred", undefined]
    ]);
    expect(plan.reclass).toEqual([]);
    expect(plan.movement).toMatchObject({
      deferredAmount: 3000,
      assetAmount: 0
    });
  });

  it("clears an accrual first, defers the rest (spec acceptance)", () => {
    const plan = planContractInvoiceLine({
      position: { ...EMPTY_POSITION, assetAmount: 20_000, assetBase: 20_000 },
      revenueBase: 30_000,
      rate: 1,
      accounts,
      customerContractId: "c"
    });
    expect(plan.revenueLegs[0]).toMatchObject({
      account: accounts.contractAsset,
      amount: 20_000,
      documentType: "Contract",
      documentId: "c"
    });
    expect(plan.reclass).toEqual([]);
  });

  it("books the FX difference of clearing an accrual carried at another rate", () => {
    // 1,000 EUR accrued at 0.8 (1,250 USD), invoiced at 1.0 (1,000 USD): the
    // Contract Assets leg cannot exceed the line, so the rest is reclassed.
    const plan = planContractInvoiceLine({
      position: { ...EMPTY_POSITION, assetAmount: 1000, assetBase: 1250 },
      revenueBase: 1000,
      rate: 1,
      accounts,
      customerContractId: "c"
    });
    expect(plan.revenueLegs[0]!.amount).toBe(1000);
    expect(plan.reclass.map((line) => [line.account.id, line.credit])).toEqual([
      ["asset", 250],
      ["loss", -250]
    ]);
  });

  it("releases Deferred Revenue first for a negative adjustment line", () => {
    const plan = planContractInvoiceLine({
      position: { ...EMPTY_POSITION, deferredAmount: 300, deferredBase: 300 },
      revenueBase: -500,
      rate: 1,
      accounts,
      customerContractId: "c"
    });
    expect(
      plan.revenueLegs.map((leg) => [leg.account?.id, leg.amount])
    ).toEqual([
      ["deferred", -300],
      ["asset", undefined]
    ]);
    expect(plan.movement).toMatchObject({
      deferredAmount: -300,
      assetAmount: 200
    });
  });
});

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;

/** An Active contract with one Recurring line, its revenue plan, and helpers
 *  to draft and post contract invoices against it. */
async function contractFixture(
  f: Fixture,
  input: {
    currencyCode?: "USD" | "EUR";
    revenue: { month: string; amount: number }[];
  }
) {
  const currencyCode = input.currencyCode ?? "USD";
  const contractId = `${f.companyId}-contract`;
  const lineId = `${f.companyId}-contract-line`;
  const itemId = `${f.companyId}-service`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("account")
      .values(
        [
          { name: "deferred", class: "Liability" as const },
          { name: "contract-asset", class: "Asset" as const }
        ].map((row) => ({
          id: f.account(row.name),
          name: row.name,
          class: row.class,
          incomeBalance: "Balance Sheet" as const,
          companyGroupId: f.groupId,
          createdBy: "system"
        }))
      )
      .execute();
    await trx
      .insertInto("sequence")
      .values({
        table: "revenueRecognitionRun",
        name: "Revenue Recognition Run",
        prefix: "RR-",
        companyId: f.companyId
      })
      .execute();
    await trx
      .updateTable("accountDefault")
      .set({
        deferredRevenueAccount: f.account("deferred"),
        contractAssetAccount: f.account("contract-asset")
      })
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: itemId,
        readableId: `${f.companyId}-SVC`,
        name: "Platform subscription",
        type: "Service",
        itemTrackingType: "Non-Inventory",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("customerContract")
      .values({
        id: contractId,
        customerContractId: "CON-TEST",
        name: "Test contract",
        status: "Active",
        customerId: f.customerId,
        closeDate: "2026-09-01",
        startDate: "2026-09-01",
        endDate: "2026-11-30",
        currencyCode,
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("customerContractLine")
      .values({
        id: lineId,
        customerContractId: contractId,
        revenueType: "Recurring",
        rateUnit: "Month",
        itemId,
        rate: 1000,
        startDate: "2026-09-01",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("customerContractRevenue")
      .values(
        input.revenue.map(({ month, amount }) => ({
          customerContractId: contractId,
          customerContractLineId: lineId,
          periodStart: `${month}-01`,
          periodEnd: `${month}-${month.endsWith("-09") || month.endsWith("-11") ? "30" : "31"}`,
          amount,
          companyId: f.companyId,
          createdBy: "system"
        }))
      )
      .execute();
  });

  const ctx = ServerFnContext.system({
    db: f.db,
    companyId: f.companyId,
    userId: "system"
  });
  let invoices = 0;

  return {
    contractId,
    lineId,
    ctx,
    /** A Draft contract invoice with one line of `amount` (contract currency)
     *  at `rate`, posted. Returns the invoice id. */
    async postInvoice(amount: number, rate = 1) {
      invoices += 1;
      const invoiceId = `${f.companyId}-contract-invoice-${invoices}`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("salesInvoice")
          .values({
            id: invoiceId,
            invoiceId: `INV-CON-${invoices}`,
            customerId: f.customerId,
            currencyCode,
            exchangeRate: rate,
            customerContractId: contractId,
            status: "Draft",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("salesInvoiceShipment")
          .values({
            id: invoiceId,
            shippingCost: 0,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("salesInvoiceLine")
          .values({
            invoiceId,
            invoiceLineType: "Service",
            itemId,
            quantity: 1,
            unitPrice: amount / rate,
            exchangeRate: rate,
            customerContractId: contractId,
            customerContractLineId: lineId,
            unitOfMeasureCode: "EA",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });
      const result = await postSalesInvoice(ctx, { type: "post", invoiceId });
      if (result.error) throw result.error;
      return invoiceId;
    },
    async voidInvoice(invoiceId: string) {
      const result = await postSalesInvoice(ctx, { type: "void", invoiceId });
      if (result.error) throw result.error;
    },
    async propose(periodEnd: string) {
      const result = await proposeRevenueRecognitionRun(ctx, { periodEnd });
      if (result.error) throw result.error;
      return result.data;
    },
    /** Each account's net movement on the invoice's posting journal(s),
     *  natural-balance signed (as stored). */
    async journalByAccount(journalId: string) {
      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", sql<number>`SUM("amount")`.as("amount")])
        .where("journalId", "=", journalId)
        .groupBy("accountId")
        .execute();
      return Object.fromEntries(
        lines
          .map((line) => [line.accountId, Number(line.amount)] as const)
          .filter(([, amount]) => amount !== 0)
      );
    },
    async invoiceJournalId(invoiceId: string, description = "Sales Invoice") {
      const journal = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where(
          "description",
          "=",
          `${description} INV-CON-${invoiceId.split("-").at(-1)}`
        )
        .executeTakeFirstOrThrow();
      return journal.id;
    },
    async ledger() {
      return (
        f.db
          .selectFrom("customerContractLedgerEntry")
          .select([
            "entryType",
            "deferredAmount",
            "deferredBase",
            "assetAmount",
            "assetBase",
            "journalId",
            "revenueRecognitionScheduleId"
          ])
          .where("companyId", "=", f.companyId)
          // Rows of one transaction share createdAt; postingDate breaks the tie.
          .orderBy("createdAt")
          .orderBy("postingDate")
          .orderBy("id")
          .execute()
      );
    },
    async schedule() {
      return f.db
        .selectFrom("revenueRecognitionSchedule")
        .select([
          "type",
          "status",
          "amount",
          "contractAmount",
          "debitAccountId",
          "creditAccountId",
          sql<string>`"scheduledDate"::text`.as("scheduledDate"),
          "customerContractLineId",
          "customerContractRevenueId",
          "runLineId"
        ])
        .where("companyId", "=", f.companyId)
        .orderBy("scheduledDate")
        .orderBy("type")
        .execute();
    }
  };
}

databaseTest(
  "a contract invoice billed ahead credits Deferred Revenue and the run releases it month by month",
  async () => {
    const f = await paymentFixture();
    try {
      const c = await contractFixture(f, {
        revenue: [
          { month: "2026-09", amount: 1000 },
          { month: "2026-10", amount: 1000 },
          { month: "2026-11", amount: 1000 }
        ]
      });
      const invoiceId = await c.postInvoice(3000);
      expect(
        await c.journalByAccount(await c.invoiceJournalId(invoiceId))
      ).toEqual({
        [f.account("control")]: 3000,
        [f.account("deferred")]: 3000
      });
      expect(await c.ledger()).toMatchObject([
        { entryType: "Invoice", deferredAmount: 3000, assetAmount: 0 }
      ]);
      // No Service deferral rows: the line posted to its position.
      expect(await c.schedule()).toEqual([]);

      const run = await c.propose("2026-10-31");
      expect(run?.lineCount).toBe(2);
      const schedule = await c.schedule();
      expect(schedule).toMatchObject([
        {
          type: "Deferral",
          status: "Planned",
          amount: 1000,
          contractAmount: 1000,
          debitAccountId: f.account("deferred"),
          creditAccountId: f.account("sales"),
          scheduledDate: "2026-09-30",
          customerContractLineId: c.lineId
        },
        { type: "Deferral", amount: 1000, scheduledDate: "2026-10-31" }
      ]);
      expect(schedule.every((row) => row.runLineId)).toBe(true);
      const ledger = await c.ledger();
      expect(ledger.slice(1)).toMatchObject([
        { entryType: "Recognition", deferredAmount: -1000, assetAmount: 0 },
        { entryType: "Recognition", deferredAmount: -1000, assetAmount: 0 }
      ]);
      // Proposing the same period again synthesizes nothing new.
      expect(await c.propose("2026-10-31")).toBeNull();
      expect((await c.schedule()).length).toBe(2);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "earned before billed: the run accrues Contract Assets and the invoice relieves them, deferring the rest",
  async () => {
    const f = await paymentFixture();
    try {
      const c = await contractFixture(f, {
        revenue: [
          { month: "2026-09", amount: 10_000 },
          { month: "2026-10", amount: 10_000 },
          { month: "2026-11", amount: 10_000 }
        ]
      });
      await c.propose("2026-10-31");
      expect(await c.schedule()).toMatchObject([
        {
          type: "Accrual",
          amount: 10_000,
          debitAccountId: f.account("contract-asset"),
          creditAccountId: f.account("sales")
        },
        { type: "Accrual", amount: 10_000 }
      ]);

      const invoiceId = await c.postInvoice(30_000);
      // Spec acceptance: 2 × 10,000 accrued, a 30,000 invoice → Cr Contract
      // Assets 20,000 / Cr Deferred Revenue 10,000.
      expect(
        await c.journalByAccount(await c.invoiceJournalId(invoiceId))
      ).toEqual({
        [f.account("control")]: 30_000,
        [f.account("contract-asset")]: -20_000,
        [f.account("deferred")]: 10_000
      });
      expect((await c.ledger()).at(-1)).toMatchObject({
        entryType: "Invoice",
        assetAmount: -20_000,
        deferredAmount: 10_000
      });
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "voiding a contract invoice after a recognition reclasses the negative deferred pool to Contract Assets",
  async () => {
    const f = await paymentFixture();
    try {
      const c = await contractFixture(f, {
        revenue: [
          { month: "2026-09", amount: 10_000 },
          { month: "2026-10", amount: 10_000 },
          { month: "2026-11", amount: 10_000 }
        ]
      });
      const invoiceId = await c.postInvoice(30_000);
      await c.propose("2026-09-30");
      await c.voidInvoice(invoiceId);

      const voidJournal = await c.invoiceJournalId(
        invoiceId,
        "VOID Sales Invoice"
      );
      // The original legs reversed (AR −30,000, Deferred −30,000), then the
      // −10,000 left on Deferred Revenue reclassed to Contract Assets.
      expect(await c.journalByAccount(voidJournal)).toEqual({
        [f.account("control")]: -30_000,
        [f.account("deferred")]: -20_000,
        [f.account("contract-asset")]: 10_000
      });
      const voidEntry = (await c.ledger()).at(-1)!;
      expect(voidEntry).toMatchObject({
        entryType: "Void",
        deferredAmount: -20_000,
        assetAmount: 10_000,
        journalId: voidJournal
      });
      // Position: 0 invoiced − 10,000 recognized = 10,000 of Contract Assets.
      const position = await f.db
        .selectFrom("customerContractLedgerEntry")
        .select([
          sql<number>`SUM("deferredAmount")`.as("deferred"),
          sql<number>`SUM("assetAmount")`.as("asset")
        ])
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect({
        deferred: Number(position.deferred),
        asset: Number(position.asset)
      }).toEqual({ deferred: 0, asset: 10_000 });
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "a EUR contract accrued at one rate and invoiced at another books realized FX, never revenue",
  async () => {
    const f = await paymentFixture();
    try {
      const c = await contractFixture(f, {
        currencyCode: "EUR",
        revenue: [{ month: "2026-09", amount: 1000 }]
      });
      // 0.8 EUR per USD at the run: 1,000 EUR accrues 1,250 USD.
      await f.db
        .insertInto("exchangeRateOverride")
        .values({
          companyId: f.companyId,
          currencyCode: "EUR",
          rate: 0.8,
          createdBy: "system"
        })
        .execute();
      await c.propose("2026-09-30");
      expect(await c.schedule()).toMatchObject([
        { type: "Accrual", amount: 1250, contractAmount: 1000 }
      ]);

      // Invoiced at 1.0: the receivable is 1,000 USD, the asset it clears
      // was carried at 1,250 — a 250 realized loss.
      const invoiceId = await c.postInvoice(1000, 1);
      expect(
        await c.journalByAccount(await c.invoiceJournalId(invoiceId))
      ).toEqual({
        [f.account("control")]: 1000,
        [f.account("contract-asset")]: -1250,
        [f.account("loss")]: 250
      });
      expect((await c.ledger()).at(-1)).toMatchObject({
        entryType: "Invoice",
        assetAmount: -1000,
        assetBase: -1250,
        deferredAmount: 0
      });
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "a negative catch-up month raises the position, so its schedule row comes out negative",
  async () => {
    const f = await paymentFixture();
    try {
      // September was recognized before a cancellation took it back.
      const c = await contractFixture(f, {
        revenue: [
          { month: "2026-09", amount: 1000 },
          { month: "2026-10", amount: -1000 }
        ]
      });
      await c.propose("2026-10-31");
      expect(await c.schedule()).toMatchObject([
        { type: "Accrual", amount: 1000, scheduledDate: "2026-09-30" },
        { type: "Accrual", amount: -1000, scheduledDate: "2026-10-31" }
      ]);
      expect(
        (await c.ledger()).map((entry) => Number(entry.assetAmount))
      ).toEqual([1000, -1000]);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);
