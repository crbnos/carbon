// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { postSalesInvoice } from "../../../app/modules/invoicing/invoicing.service";
import { createServiceInvoice } from "../../../app/modules/service/service.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { PROJECT_TEST_USER } from "../fixtures/project-posting";
import { serviceJobFixture } from "../fixtures/service-job";

/**
 * The service job fixture with AR, Sales, Service Revenue and Contract
 * Assets accounts, a sales invoice sequence, and a Completed Time and
 * Materials job: 3 hours at 95 (one labor line of 285: a Service line with
 * no item) and, when `charge` is set, a 95 charge line, for an invoice of 380.
 */
async function servicePostingFixture(args: {
  serviceRevenueAccount: boolean;
  charge: boolean;
}) {
  const f = await serviceJobFixture();
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("account")
      .values(
        (
          [
            ["receivables", "Accounts receivable", "Asset"],
            ["contract-asset", "Contract assets", "Asset"],
            ["sales", "Sales", "Revenue"],
            ["service-revenue", "Service revenue", "Revenue"]
          ] as const
        ).map(([key, name, accountClass]) => ({
          id: f.account(key),
          name,
          class: accountClass,
          incomeBalance:
            accountClass === "Asset"
              ? ("Balance Sheet" as const)
              : ("Income Statement" as const),
          companyGroupId: f.groupId,
          createdBy: PROJECT_TEST_USER
        }))
      )
      .execute();
    await trx
      .updateTable("accountDefault")
      .set({
        receivablesAccount: f.account("receivables"),
        salesAccount: f.account("sales"),
        contractAssetAccount: f.account("contract-asset"),
        serviceRevenueAccount: args.serviceRevenueAccount
          ? f.account("service-revenue")
          : null
      })
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("sequence")
      .values({
        table: "salesInvoice",
        name: "Sales Invoice",
        prefix: "INV",
        companyId: f.companyId
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  });

  const { locationId } = await f.addStockedItem("unit", {
    quantity: 1,
    unitCost: 10
  });
  const job = await f.addJob({
    locationId,
    status: "Completed",
    laborBillRate: 95
  });
  await f.addTime(job.id, { hours: 3 });
  if (args.charge) {
    await f.db
      .insertInto("serviceJobItem")
      .values({
        serviceJobId: job.id,
        lineType: "Charge",
        itemId: f.serviceItemId,
        description: "Travel",
        quantity: 1,
        unitPrice: 95,
        companyId: f.companyId,
        createdBy: PROJECT_TEST_USER
      })
      .execute();
  }

  const post = (invoiceId: string, type: "post" | "void") =>
    invokePosting(
      handlesOf(f.ctx),
      "post-sales-invoice",
      { type, invoiceId },
      postSalesInvoice
    );

  return {
    ...f,
    job,
    /** A Planned Accrual row of the job, as the recognition run writes it. */
    async accrue(amount: number) {
      const row = await f.db
        .insertInto("revenueRecognitionSchedule")
        .values({
          type: "Accrual",
          status: "Planned",
          serviceJobId: job.id,
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          scheduledDate: "2026-10-31",
          amount,
          debitAccountId: f.account("contract-asset"),
          creditAccountId: f.account("service-revenue"),
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    },
    /** Invoices the job and posts the invoice. */
    async invoiceAndPost() {
      const created = await invokePosting(
        handlesOf(f.ctx),
        "create-service-invoice",
        { serviceJobId: job.id },
        createServiceInvoice
      );
      expect(created.error).toBeNull();
      const invoiceId = created.data!.salesInvoiceId;
      const posted = await post(invoiceId, "post");
      expect(posted.error).toBeNull();
      const lines = await f.db
        .selectFrom("salesInvoiceLine")
        .select(["id", "invoiceLineType", "itemId"])
        .where("invoiceId", "=", invoiceId)
        .where("companyId", "=", f.companyId)
        .orderBy("sortOrder")
        .execute();
      return { invoiceId, lines };
    },
    void(invoiceId: string) {
      return post(invoiceId, "void");
    },
    /** The posting journal's amounts by account, natural-balance signed. */
    async postedByAccount() {
      const journal = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Sales Invoice")
        .orderBy("createdAt")
        .executeTakeFirstOrThrow();
      const rows = await f.db
        .selectFrom("journalLine")
        .select(["accountId", sql<number>`SUM("amount")`.as("amount")])
        .where("journalId", "=", journal.id)
        .where("companyId", "=", f.companyId)
        .groupBy("accountId")
        .execute();
      return Object.fromEntries(
        rows.map((row) => [row.accountId, Number(row.amount)])
      );
    },
    /** What the invoice moved in stock: shipments, item and cost ledger
     *  rows. */
    async stockMoved(invoiceId: string) {
      const [shipments, itemLedger, costLedger] = await Promise.all([
        f.db
          .selectFrom("shipment")
          .select("id")
          .where("sourceDocumentId", "=", invoiceId)
          .where("companyId", "=", f.companyId)
          .execute(),
        f.db
          .selectFrom("itemLedger")
          .select("id")
          .where("documentId", "=", invoiceId)
          .where("companyId", "=", f.companyId)
          .execute(),
        f.db
          .selectFrom("costLedger")
          .select("id")
          .where("documentId", "=", invoiceId)
          .where("companyId", "=", f.companyId)
          .execute()
      ]);
      return {
        shipments: shipments.length,
        itemLedger: itemLedger.length,
        costLedger: costLedger.length
      };
    },
    /** Each accrual row's stamp. */
    async stamps(ids: string[]) {
      const rows = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select(["id", "billedBySalesInvoiceLineId"])
        .where("id", "in", ids)
        .where("companyId", "=", f.companyId)
        .execute();
      return Object.fromEntries(
        rows.map((row) => [row.id, row.billedBySalesInvoiceLineId])
      );
    },
    async cleanup() {
      // A posted invoice refuses its delete.
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("salesInvoice")
          .set({ status: "Draft" })
          .where("companyId", "=", f.companyId)
          .execute();
      });
      await f.cleanup();
    }
  };
}

databaseTest(
  "a labor line (Service, no item) with nothing accrued credits Service Revenue and moves no stock",
  async () => {
    const f = await servicePostingFixture({
      serviceRevenueAccount: true,
      charge: false
    });
    try {
      const { invoiceId, lines } = await f.invoiceAndPost();
      expect(
        lines.map((line) => [line.invoiceLineType, line.itemId])
      ).toEqual([["Service", null]]);
      expect(await f.postedByAccount()).toEqual({
        [f.account("receivables")]: 285,
        [f.account("service-revenue")]: 285
      });
      // No shipment, item ledger, cost relief or COGS for a line with no item.
      expect(await f.stockMoved(invoiceId)).toEqual({
        shipments: 0,
        itemLedger: 0,
        costLedger: 0
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a line written as Labor before the change posts like a Service line with no item",
  async () => {
    const f = await servicePostingFixture({
      serviceRevenueAccount: true,
      charge: false
    });
    try {
      const accrual = await f.accrue(100);
      const created = await invokePosting(
        handlesOf(f.ctx),
        "create-service-invoice",
        { serviceJobId: f.job.id },
        createServiceInvoice
      );
      expect(created.error).toBeNull();
      const invoiceId = created.data!.salesInvoiceId;
      // An old Draft row: the type the labor line had before 2026-11-01.
      const line = await f.db
        .updateTable("salesInvoiceLine")
        .set({ invoiceLineType: "Labor" })
        .where("invoiceId", "=", invoiceId)
        .where("companyId", "=", f.companyId)
        .returning("id")
        .executeTakeFirstOrThrow();
      const posted = await invokePosting(
        handlesOf(f.ctx),
        "post-sales-invoice",
        { type: "post", invoiceId },
        postSalesInvoice
      );
      expect(posted.error).toBeNull();
      expect(await f.postedByAccount()).toEqual({
        [f.account("receivables")]: 285,
        [f.account("contract-asset")]: -100,
        [f.account("service-revenue")]: 185
      });
      expect(await f.stockMoved(invoiceId)).toEqual({
        shipments: 0,
        itemLedger: 0,
        costLedger: 0
      });
      expect(await f.stamps([accrual])).toEqual({ [accrual]: line.id });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "accrued revenue is billed off Contract Assets, the rest credits Service Revenue, and the accrual rows are stamped with the job's first line",
  async () => {
    const f = await servicePostingFixture({
      serviceRevenueAccount: true,
      charge: true
    });
    try {
      const accruals = [await f.accrue(200), await f.accrue(85)];
      const { lines } = await f.invoiceAndPost();
      expect(
        lines.map((line) => [line.invoiceLineType, line.itemId])
      ).toEqual([
        ["Service", null],
        ["Service", f.serviceItemId]
      ]);
      // Credits are negative on an asset, positive on revenue.
      expect(await f.postedByAccount()).toEqual({
        [f.account("receivables")]: 380,
        [f.account("contract-asset")]: -285,
        [f.account("service-revenue")]: 95
      });
      expect(await f.stamps(accruals)).toEqual({
        [accruals[0]!]: lines[0]!.id,
        [accruals[1]!]: lines[0]!.id
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an accrual larger than the invoice clears Contract Assets in full and takes the difference back off Service Revenue",
  async () => {
    const f = await servicePostingFixture({
      serviceRevenueAccount: true,
      charge: true
    });
    try {
      await f.accrue(400);
      await f.invoiceAndPost();
      // Cr Contract Assets 400, Dr Service Revenue 20.
      expect(await f.postedByAccount()).toEqual({
        [f.account("receivables")]: 380,
        [f.account("contract-asset")]: -400,
        [f.account("service-revenue")]: -20
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("voiding the invoice copies each line's dimensions", async () => {
  const f = await servicePostingFixture({
    serviceRevenueAccount: true,
    charge: true
  });
  try {
    await f.db
      .insertInto("dimension")
      .values({
        id: f.dimension("Customer"),
        name: "Customer",
        entityType: "Customer",
        companyGroupId: f.groupId,
        createdBy: PROJECT_TEST_USER
      })
      .execute();
    const { invoiceId } = await f.invoiceAndPost();
    const voided = await f.void(invoiceId);
    expect(voided.error).toBeNull();

    const rows = await f.db
      .selectFrom("journalLine as line")
      .leftJoin("journalLineDimension as tag", "tag.journalLineId", "line.id")
      .select(["line.accountId", "line.amount", "tag.dimensionId", "tag.valueId"])
      .where("line.companyId", "=", f.companyId)
      .where("line.documentId", "=", invoiceId)
      .execute();
    const net = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.accountId}|${row.dimensionId}|${row.valueId}`;
      net.set(key, (net.get(key) ?? 0) + Number(row.amount));
    }
    // Every tagged balance nets to zero, so no report by dimension keeps it.
    expect(rows.every((row) => row.dimensionId !== null)).toBe(true);
    expect([...net.values()].every((value) => value === 0)).toBe(true);
  } finally {
    await f.cleanup();
  }
});

databaseTest("voiding the invoice clears the accrual stamps", async () => {
  const f = await servicePostingFixture({
    serviceRevenueAccount: true,
    charge: true
  });
  try {
    const accrual = await f.accrue(285);
    const { invoiceId, lines } = await f.invoiceAndPost();
    expect(await f.stamps([accrual])).toEqual({ [accrual]: lines[0]!.id });
    const voided = await f.void(invoiceId);
    expect(voided.error).toBeNull();
    expect(await f.stamps([accrual])).toEqual({ [accrual]: null });
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "with no Service Revenue account, a service job line credits the sales account",
  async () => {
    const f = await servicePostingFixture({
      serviceRevenueAccount: false,
      charge: false
    });
    try {
      await f.invoiceAndPost();
      expect(await f.postedByAccount()).toEqual({
        [f.account("receivables")]: 285,
        [f.account("sales")]: 285
      });
    } finally {
      await f.cleanup();
    }
  }
);
