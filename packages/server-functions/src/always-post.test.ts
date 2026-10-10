// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A company with no accounting cutover posts every document type against the
// live database. Each posting writes its journal as Provisional with no
// accounting period, no accounting period is ever created, and the general
// ledger balances stay at zero because a Provisional journal counts nowhere.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  ACCOUNTS,
  alwaysPostFixture,
  countAccountingPeriods,
  type Fixture,
  jobFixture,
  payInvoice,
  postCreditMemo,
  postServiceInvoice,
  postSuppliesInvoice,
  receiveFromPurchaseOrder,
  shipSalesOrder,
  USER,
  unwrap
} from "./always-post-test-fixture";
import issue from "./issue";
import { databaseTest } from "./local-database-test-fixture";
import postInventoryAdjustment from "./post-inventory-adjustment";

/** Every journal the filter selects is Provisional, has no accounting period
 *  and has lines; there is at least one; the company has no period. */
async function expectProvisional(
  f: Fixture,
  filter: { sourceType: string } | { journalIds: string[] }
) {
  let query = f.db
    .selectFrom("journal")
    .select(["id", "status", "accountingPeriodId"])
    .where("companyId", "=", f.companyId);
  query =
    "sourceType" in filter
      ? query.where("sourceType", "=", filter.sourceType as never)
      : query.where("id", "in", filter.journalIds);
  const journals = await query.execute();
  expect(journals.length).toBeGreaterThan(0);
  for (const journal of journals) {
    expect(journal.status).toEqual("Provisional");
    expect(journal.accountingPeriodId).toBeNull();
  }
  const lines = await f.db
    .selectFrom("journalLine")
    .select("journalId")
    .distinct()
    .where("companyId", "=", f.companyId)
    .where(
      "journalId",
      "in",
      journals.map((journal) => journal.id)
    )
    .execute();
  expect(lines.length).toEqual(journals.length);
  expect(await countAccountingPeriods(f)).toBe(0);
}

databaseTest(
  "a company with no accounting cutover posts every document as Provisional, with no period",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // Receipt: 10 parts at 10 from a purchase order.
      await receiveFromPurchaseOrder(f);
      await expectProvisional(f, { sourceType: "Purchase Receipt" });

      // Shipment: 4 parts on a sales order, costed from the receipt's layer.
      const shipmentId = await shipSalesOrder(f);
      await expectProvisional(f, { sourceType: "Sales Shipment" });
      const sale = await f.db
        .selectFrom("costLedger")
        .select(["itemId", "quantity", "cost"])
        .where("companyId", "=", f.companyId)
        .where("itemLedgerType", "=", "Sale")
        .where("documentId", "=", shipmentId)
        .execute();
      expect(
        sale.map((row) => ({
          itemId: row.itemId,
          quantity: Number(row.quantity),
          cost: Number(row.cost)
        }))
      ).toEqual([{ itemId: f.partId, quantity: -4, cost: -40 }]);

      // Sales invoice: one service line of 100.
      const salesInvoiceId = await postServiceInvoice(f);
      await expectProvisional(f, { sourceType: "Sales Invoice" });

      // Purchase invoice: one G/L line of 60.
      await postSuppliesInvoice(f);
      await expectProvisional(f, { sourceType: "Purchase Invoice" });

      // Payment: the customer pays the sales invoice in full.
      const paymentId = await payInvoice(f, salesInvoiceId);
      const payment = await f.db
        .selectFrom("payment")
        .select(["status", "journalId"])
        .where("id", "=", paymentId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(payment.status).toEqual("Posted");
      await expectProvisional(f, { journalIds: [payment.journalId!] });

      // Memo: a standalone credit of 20.
      const memoId = await postCreditMemo(f);
      const memo = await f.db
        .selectFrom("memo")
        .select(["status", "journalId"])
        .where("id", "=", memoId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(memo.status).toEqual("Posted");
      await expectProvisional(f, { journalIds: [memo.journalId!] });

      // Inventory adjustment: remove one part.
      unwrap(
        await postInventoryAdjustment(f.ctx, {
          adjustmentType: "Negative Adjmt.",
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 1
        })
      );
      await expectProvisional(f, { sourceType: "Inventory Adjustment" });

      // Job material issue: two parts to the job's operation.
      const job = await jobFixture(f);
      unwrap(
        await issue(f.ctx, {
          type: "partToOperation",
          id: job.operationId,
          itemId: f.partId,
          materialId: job.materialId,
          quantity: 2,
          adjustmentType: "Negative Adjmt."
        })
      );
      await expectProvisional(f, { sourceType: "Job Consumption" });

      // Job completion: the assembly goes to inventory. There is no server
      // function for it; the ERP route, MCP and the finish-operation trigger
      // all call this SQL function.
      await sql`SELECT complete_job_to_inventory(${job.jobId}, ${1}::numeric, ${null}, ${f.locationId}, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      await expectProvisional(f, { sourceType: "Job Receipt" });
      const completed = await f.db
        .selectFrom("job")
        .select("status")
        .where("id", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(completed.status).toEqual("Completed");

      // Every journal of the company: Provisional, no period.
      const statuses = await f.db
        .selectFrom("journal")
        .select(["status", "accountingPeriodId"])
        .distinct()
        .where("companyId", "=", f.companyId)
        .execute();
      expect(statuses).toEqual([
        { status: "Provisional", accountingPeriodId: null }
      ]);
      expect(await countAccountingPeriods(f)).toBe(0);

      // The journals carry real amounts, yet no account has a balance.
      const moved = await f.db
        .selectFrom("journalLine")
        .select(sql<number>`sum(abs("amount"))`.as("total"))
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(moved.total)).toBeGreaterThan(0);
      const balances = await sql<{
        accountId: string;
        balance: number;
        balanceAtDate: number;
        netChange: number;
      }>`SELECT * FROM "accountTreeBalances"(${f.groupId})`.execute(f.db);
      expect(balances.rows.length).toEqual(ACCOUNTS.length);
      for (const row of balances.rows) {
        expect({
          accountId: row.accountId,
          balance: Number(row.balance),
          balanceAtDate: Number(row.balanceAtDate),
          netChange: Number(row.netChange)
        }).toEqual({
          accountId: row.accountId,
          balance: 0,
          balanceAtDate: 0,
          netChange: 0
        });
      }
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a scrap with no scrap account default posts to the inventory adjustment variance account, with no stand-in",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();

      unwrap(
        await postInventoryAdjustment(f.ctx, {
          adjustmentType: "Positive Adjmt.",
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 5
        })
      );
      unwrap(
        await postInventoryAdjustment(f.ctx, {
          adjustmentType: "Scrap",
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 2,
          scrapReasonId: scrapReason.id
        })
      );
      await expectProvisional(f, { sourceType: "Inventory Adjustment" });

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount", "accountDefaultRole"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Scrap")
        .orderBy("accountId")
        .execute();
      // An empty scrap account falls back to the variance account in every
      // company state, so the line names no role for the enable to re-point.
      expect(
        lines.map((line) => ({ ...line, amount: Number(line.amount) }))
      ).toEqual([
        {
          accountId: f.account("adjustment-variance"),
          amount: 20,
          accountDefaultRole: null
        },
        {
          accountId: f.account("inventory"),
          amount: -20,
          accountDefaultRole: null
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
