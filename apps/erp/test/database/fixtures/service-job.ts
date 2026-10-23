// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A scratch company for the service job posting regressions: the project
// posting fixture's company (accounts, defaults, an open period, a cutover)
// plus Cost of Service and Warranty Expense accounts, a customer, a labor
// item, and helpers for a job, its time, and an RMA line. Deleted by
// `cleanup()`.

import type { Database } from "@carbon/database";
import { sql } from "kysely";
import { postServiceJob } from "../../../app/modules/service/service.service";
import { issueMaterial } from "../../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "./handles";
import { PROJECT_TEST_USER, projectPostingFixture } from "./project-posting";

type Enums = Database["public"]["Enums"];

export async function serviceJobFixture() {
  const f = await projectPostingFixture();
  const { db, companyId, prefix, account } = f;
  const USER = PROJECT_TEST_USER;
  const customerId = `${prefix}-customer`;
  const laborItemId = `${prefix}-labor-item`;
  let jobCount = 0;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("account")
      .values(
        (
          [
            ["cost-of-service", "Cost of service"],
            ["warranty", "Warranty expense"]
          ] as const
        ).map(([key, name]) => ({
          id: account(key),
          name,
          class: "Expense" as const,
          incomeBalance: "Income Statement" as const,
          companyGroupId: f.groupId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .updateTable("accountDefault")
      .set({
        costOfServiceAccount: account("cost-of-service"),
        warrantyExpenseAccount: account("warranty")
      })
      .where("companyId", "=", companyId)
      .execute();
    await trx
      .insertInto("customer")
      .values({ id: customerId, name: "Service customer", companyId })
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: laborItemId,
        readableId: `${prefix}-BENCH`,
        name: "Bench Repair",
        type: "Service",
        itemTrackingType: "Non-Inventory",
        replenishmentSystem: "Buy",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .deleteFrom("itemCost")
      .where("itemId", "=", laborItemId)
      .execute();
    await trx
      .insertInto("itemCost")
      .values({
        itemId: laborItemId,
        costingMethod: "Standard",
        unitCost: 40,
        companyId,
        createdBy: USER
      })
      .execute();
  });

  return {
    ...f,
    customerId,
    laborItemId,
    /** A job at `locationId`. */
    async addJob(args: {
      locationId: string;
      coverage?: Enums["serviceCoverage"];
      status?: Enums["serviceJobStatus"];
      billingMethod?: Enums["serviceBillingMethod"];
      estimateStatus?: Enums["serviceEstimateStatus"] | null;
      salesReturnOrderLineId?: string | null;
    }) {
      jobCount += 1;
      const job = await db
        .insertInto("serviceJob")
        .values({
          serviceJobId: `SJ-${prefix}-${jobCount}`,
          status: args.status ?? "In Progress",
          coverage: args.coverage ?? "Billable",
          billingMethod: args.billingMethod ?? "Time and Materials",
          estimateStatus: args.estimateStatus ?? null,
          salesReturnOrderLineId: args.salesReturnOrderLineId ?? null,
          customerId,
          locationId: args.locationId,
          companyId,
          createdBy: USER
        })
        .returning(["id", "serviceJobId"])
        .executeTakeFirstOrThrow();
      return job;
    },
    /** A time entry on the fixture's labor item. */
    async addTime(
      serviceJobId: string,
      args: { hours: number; running?: boolean; laborItemId?: string }
    ) {
      return db
        .insertInto("serviceJobTime")
        .values({
          serviceJobId,
          employeeId: USER,
          laborItemId: args.laborItemId ?? laborItemId,
          entryDate: "2026-10-01",
          hours: args.hours,
          ...(args.running ? { startTime: "2026-10-01T09:00:00Z" } : {}),
          companyId,
          createdBy: USER
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();
    },
    /** A confirmed RMA with one received Return for Service line. */
    async addReturnLine(args: { itemId: string; quantityShipped?: number }) {
      const rmaId = `${prefix}-rma-${crypto.randomUUID().slice(0, 8)}`;
      await db
        .insertInto("salesReturnOrder")
        .values({
          id: rmaId,
          salesReturnOrderId: rmaId,
          customerId,
          currencyCode: "USD",
          orderDate: "2026-10-01",
          status: "In Progress",
          companyId,
          createdBy: USER
        })
        .execute();
      const line = await db
        .insertInto("salesReturnOrderLine")
        .values({
          salesReturnOrderId: rmaId,
          itemId: args.itemId,
          quantity: 1,
          quantityReceived: 1,
          quantityShipped: args.quantityShipped ?? 0,
          returnType: "Return for Service",
          companyId,
          createdBy: USER
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      return { salesReturnOrderId: rmaId, lineId: line.id };
    },
    issue(input: Parameters<typeof issueMaterial>[1]) {
      return invokePosting(handlesOf(f.ctx), "issue", input, issueMaterial);
    },
    postServiceJob(input: Parameters<typeof postServiceJob>[1]) {
      return invokePosting(
        handlesOf(f.ctx),
        "post-service-job",
        input,
        postServiceJob
      );
    },
    /** A journal's lines as [account, amount], debits first. */
    async journalLines(journalId: string) {
      const lines = await db
        .selectFrom("journalLine")
        .select(["accountId", "amount", "documentType", "documentId"])
        .where("journalId", "=", journalId)
        .where("companyId", "=", companyId)
        .orderBy("amount", "desc")
        .execute();
      return lines.map((line) => [line.accountId, Number(line.amount)]);
    }
  };
}
