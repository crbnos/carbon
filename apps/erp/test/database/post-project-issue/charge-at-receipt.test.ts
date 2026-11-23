// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Charge at receipt (Projects Phase 2a): the receipt charges the project
// while the goods enter its stock, so the later issue charges nothing again.
// It moves the receipt's cost from inventory to the project account with a
// zero-net pair of rows, which bills nothing and gives the revenue run a
// Project WIP row to relieve. Audit `.ai/runs/2026-10-22-project-accounting-audit.md` (C2).

import { datetime } from "@carbon/utils";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  loadProgressLines,
  selectUnrelievedCost
} from "../../../app/modules/accounting/project-revenue";
import {
  issueMaterial,
  postReceipt as postReceiptBody
} from "../../../app/modules/inventory/inventory.service";
import { postProjectIssue } from "../../../app/modules/projects/projects.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;
type Ctx = Parameters<typeof handlesOf>[0];

const postReceipt = (ctx: Ctx, input: Parameters<typeof postReceiptBody>[1]) =>
  invokePosting(handlesOf(ctx), "post-receipt", input, postReceiptBody);
const issueJobMaterial = (ctx: Ctx, input: Parameters<typeof issueMaterial>[1]) =>
  invokePosting(handlesOf(ctx), "issue", input, issueMaterial);

/**
 * A Contract project with project stock that charges at receipt, a Time &
 * Materials line on its element, and 10 units received into its stock at
 * 10.00 through a real receipt.
 */
async function receiveIntoChargedStock(f: Fixture) {
  await f.enableProjectStock();
  await f.db
    .updateTable("project")
    .set({ chargeAtReceipt: true })
    .where("id", "=", f.projectId)
    .where("companyId", "=", f.companyId)
    .execute();
  const { locationId } = await f.addStockedItem("filler", {
    quantity: 1,
    unitCost: 1
  });
  const { itemId } = await f.addItem("part", { itemTrackingType: "Inventory" });

  const customerId = `${f.companyId}-customer`;
  const contractId = `${f.companyId}-contract`;
  const lineId = `${contractId}-line`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("customer")
      .values({ id: customerId, name: "Customer", companyId: f.companyId })
      .execute();
    await trx
      .insertInto("customerContract")
      .values({
        id: contractId,
        customerContractId: "CON-CAR",
        name: "Charge at receipt",
        customerId,
        status: "Active",
        closeDate: "2026-01-01",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        billingFrequency: "Month",
        billingAlignment: "Calendar",
        billingTiming: "Arrears",
        currencyCode: "USD",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("customerContractLine")
      .values({
        id: lineId,
        customerContractId: contractId,
        revenueType: "One-time",
        itemId,
        description: "Material T&M",
        quantity: 1,
        rate: 0,
        startDate: "2026-01-01",
        billingMethod: "Time & Materials",
        revenueMethod: "Right to Invoice",
        materialHandlingPercent: 0,
        projectId: f.projectId,
        projectElementId: f.elementId,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
  });

  const po = await f.addPurchaseOrder("stock", {
    locationId,
    lines: [{ itemId, quantity: 10, unitPrice: 10, charged: true }]
  });
  const receipt = await f.addReceipt("stock", {
    locationId,
    purchaseOrderId: po.purchaseOrderId,
    supplierId: po.supplierId,
    lines: [
      { lineId: po.lineIds[0]!, itemId, quantity: 10, unitPrice: 10 }
    ]
  });
  const received = await postReceipt(f.ctx, { receiptId: receipt.receiptId });
  expect(received.error).toBeNull();
  return { locationId, itemId, lineId };
}

const projectIssue = (
  f: Fixture,
  args: {
    itemId: string;
    locationId: string;
    quantity: number;
    direction: "Issue" | "Return";
  }
) =>
  invokePosting(
    handlesOf(f.ctx),
    "post-project-issue",
    {
      projectId: f.projectId,
      projectElementId: f.elementId,
      ...args
    },
    postProjectIssue
  );

/** Σ amount of the project's ledger rows. */
async function projectCost(f: Fixture) {
  const row = await f.db
    .selectFrom("projectLedger")
    .select((eb) => eb.fn.sum<string>("amount").as("amount"))
    .where("projectId", "=", f.projectId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return Number(row.amount ?? 0);
}

/** The project's live billable items, as [quantity, amount]. */
async function billableItems(f: Fixture) {
  const rows = await f.db
    .selectFrom("projectBillableItem")
    .select(["quantity", "amount"])
    .where("projectId", "=", f.projectId)
    .where("companyId", "=", f.companyId)
    .where("status", "<>", "Written Off")
    .orderBy("amount", "desc")
    .execute();
  return rows.map((row) => [Number(row.quantity), Number(row.amount)]);
}

/** The GL balance of an account in the fixture's company. */
async function balance(f: Fixture, account: string) {
  const row = await f.db
    .selectFrom("journalLine")
    .select((eb) => eb.fn.sum<string>("amount").as("amount"))
    .where("accountId", "=", f.account(account))
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return Number(row.amount ?? 0);
}

/** What the revenue run would relieve today, per account. */
async function relievable(f: Fixture) {
  const today = datetime.today("America/New_York").toString();
  return f.db.transaction().execute(async (trx) => {
    const lines = await loadProgressLines(trx, {
      companyId: f.companyId,
      periodEnd: today,
      revenueMethods: ["Right to Invoice"]
    });
    const groups = await selectUnrelievedCost(trx, {
      companyId: f.companyId,
      lines,
      through: today
    });
    return Object.fromEntries(
      groups
        .filter((group) => group.amount !== 0)
        .map((group) => [group.accountId, group.amount])
    );
  });
}

databaseTest(
  "an issue of stock charged at receipt charges the project once and moves its cost to Project WIP",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      const { locationId, itemId } = await receiveIntoChargedStock(f);
      expect(await projectCost(f)).toEqual(100);
      expect(await billableItems(f)).toEqual([[1, 100]]);
      // The goods are on the shelf: nothing comes out of inventory.
      expect(await relievable(f)).toEqual({});

      const issued = await projectIssue(f, {
        itemId,
        locationId,
        quantity: 10,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      expect(issued.data?.cost).toEqual(100);

      expect(await projectCost(f)).toEqual(100);
      expect(await billableItems(f)).toEqual([[1, 100]]);
      expect(await balance(f, "project-wip")).toEqual(100);
      expect(await relievable(f)).toEqual({ [f.account("project-wip")]: 100 });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a partial issue of stock charged at receipt, then its return, nets to what the issue moved",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      const { locationId, itemId } = await receiveIntoChargedStock(f);
      // 2 more units in the project's stock that the receipt never charged.
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 2,
        unitCost: 10,
        postingDate: "2026-10-23"
      });

      // 12 issued: the 10 charged at receipt move, the 2 others are charged.
      const issued = await projectIssue(f, {
        itemId,
        locationId,
        quantity: 12,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      expect(issued.data?.cost).toEqual(120);
      expect(await projectCost(f)).toEqual(120);
      expect(await billableItems(f)).toEqual([
        [1, 100],
        [1, 20]
      ]);
      expect(await balance(f, "project-wip")).toEqual(120);

      // 5 returned: they go back as stock charged at receipt, so the
      // project keeps its cost and its bill, and WIP gives back 50.
      const returned = await projectIssue(f, {
        itemId,
        locationId,
        quantity: 5,
        direction: "Return"
      });
      expect(returned.error).toBeNull();
      expect(returned.data?.cost).toEqual(50);
      expect(await projectCost(f)).toEqual(120);
      expect(await billableItems(f)).toEqual([
        [1, 100],
        [1, 20]
      ]);
      expect(await balance(f, "project-wip")).toEqual(70);
      expect(await relievable(f)).toEqual({ [f.account("project-wip")]: 70 });

      // Issued again, the 5 charge nothing more.
      const again = await projectIssue(f, {
        itemId,
        locationId,
        quantity: 5,
        direction: "Issue"
      });
      expect(again.error).toBeNull();
      expect(await projectCost(f)).toEqual(120);
      expect(await billableItems(f)).toHaveLength(2);
      expect(await balance(f, "project-wip")).toEqual(120);
      expect(await relievable(f)).toEqual({
        [f.account("project-wip")]: 120
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a job that consumes stock charged at receipt to the project charges nothing again, in the issue and in the completion backflush",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      const { locationId, itemId } = await receiveIntoChargedStock(f);

      // The issue (TypeScript) path: 4 units.
      const first = await f.addConsumeToProjectJob("ts", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 4,
        jobQuantity: 1
      });
      const backflush = await issueJobMaterial(f.ctx, {
        type: "jobOperation",
        id: first.operationId,
        quantity: 1
      });
      expect(backflush.error).toBeNull();
      expect(await projectCost(f)).toEqual(100);
      expect(await billableItems(f)).toEqual([[1, 100]]);
      expect(await balance(f, "project-wip")).toEqual(40);

      // The completion backflush (SQL) path: the other 6.
      const second = await f.addConsumeToProjectJob("sql", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 6,
        jobQuantity: 1
      });
      await sql`
        SELECT complete_job_to_inventory(
          ${second.jobId}, 1, NULL, ${locationId}, ${f.companyId}, 'system'
        )
      `.execute(f.db);

      expect(await projectCost(f)).toEqual(100);
      expect(await balance(f, "project-wip")).toEqual(100);
      expect(await balance(f, "inventory")).toEqual(0);
      expect(await relievable(f)).toEqual({
        [f.account("project-wip")]: 100
      });
    } finally {
      await f.cleanup();
    }
  }
);
