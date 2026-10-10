// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";
import { sql } from "kysely";
import { expect } from "vitest";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import { buildAdjustmentJournalLines } from "../lib/plan-adjustment";
import { createAdjustmentJournal } from "../lib/post-adjustment";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import postProjectStockTransfer from "./index";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;

/** An Approved transfer with one line, for the fixture's company. */
async function addTransfer(
  f: Fixture,
  key: string,
  header: {
    type: "Transfer" | "Borrow" | "Payback";
    locationId: string;
    fromProjectId?: string | null;
    toProjectId?: string | null;
    paybackDueDate?: string | null;
    settlesBorrowId?: string | null;
  },
  line: { itemId: string; quantity: number }
) {
  const id = `${f.prefix}-pst-${key}`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("projectStockTransfer")
      .values({
        id,
        projectStockTransferId: `${f.prefix}-PST-${key}`,
        type: header.type,
        status: "Approved",
        fromProjectId: header.fromProjectId ?? null,
        toProjectId: header.toProjectId ?? null,
        locationId: header.locationId,
        reason: "Test",
        paybackDueDate: header.paybackDueDate ?? null,
        settlesBorrowId: header.settlesBorrowId ?? null,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("projectStockTransferLine")
      .values({
        projectStockTransferId: id,
        itemId: line.itemId,
        quantity: line.quantity,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
  });
  return id;
}

async function stock(f: Fixture, itemId: string) {
  const rows = await f.db
    .selectFrom("itemStockQuantities")
    .select(["projectId", "quantityOnHand"])
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", itemId)
    .orderBy("projectId")
    .execute();
  return rows.map((row) => [row.projectId, Number(row.quantityOnHand)]);
}

/** The value of the item's open base layers, per stripe ('' is common). */
async function layerValue(f: Fixture, itemId: string) {
  const rows = await f.db
    .selectFrom("costLedger")
    .select(["projectId", "quantity", "cost", "remainingQuantity"])
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", itemId)
    .where("remainingQuantity", ">", 0)
    .execute();
  const value = new Map<string, number>();
  for (const row of rows) {
    const key = row.projectId ?? "";
    value.set(
      key,
      (value.get(key) ?? 0) +
        (Number(row.cost) * Number(row.remainingQuantity)) /
          Number(row.quantity)
    );
  }
  return value;
}

databaseTest(
  "a Transfer moves stock from common stock to a project at cost",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      const { itemId, locationId } = await f.addStockedItem("move", {
        quantity: 10,
        unitCost: 10
      });
      const transferId = await addTransfer(
        f,
        "move",
        { type: "Transfer", locationId, toProjectId: f.projectId },
        { itemId, quantity: 3 }
      );

      const posted = await postProjectStockTransfer(f.ctx, {
        projectStockTransferId: transferId
      });
      expect(posted.error).toBeNull();
      expect(posted.data?.journalId).toBeNull();

      expect(await stock(f, itemId)).toEqual([
        ["", 7],
        [f.projectId, 3]
      ]);
      const value = await layerValue(f, itemId);
      expect(value.get("")).toEqual(70);
      expect(value.get(f.projectId)).toEqual(30);

      const pair = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "projectId", "entryType"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Project Transfer")
        .where("documentId", "=", transferId)
        .orderBy("quantity")
        .execute();
      expect(
        pair.map((row) => [Number(row.quantity), row.projectId, row.entryType])
      ).toEqual([
        [-3, null, "Transfer"],
        [3, f.projectId, "Transfer"]
      ]);

      const header = await f.db
        .selectFrom("projectStockTransfer")
        .select(["status", "postedAt"])
        .where("id", "=", transferId)
        .executeTakeFirstOrThrow();
      expect(header.status).toEqual("Posted");
      expect(header.postedAt).not.toBeNull();
      const line = await f.db
        .selectFrom("projectStockTransferLine")
        .select("unitCost")
        .where("projectStockTransferId", "=", transferId)
        .executeTakeFirstOrThrow();
      expect(Number(line.unitCost)).toEqual(10);

      // Posted once: a second post is refused.
      const again = await postProjectStockTransfer(f.ctx, {
        projectStockTransferId: transferId
      });
      expect(again.error?.message).toMatch(/Only an approved transfer/);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Borrow then a dearer Payback charges the borrower the variance",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      const { itemId, locationId } = await f.addStockedItem("lend", {
        quantity: 1,
        unitCost: 1
      });
      const borrowerId = `${f.prefix}-project-borrower`;
      await f.db
        .insertInto("project")
        .values({
          id: borrowerId,
          name: "Borrower",
          identifier: "BR",
          status: "Released",
          costTreatment: "Expense",
          projectStock: true,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      // The lender holds 5 at 10.00.
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 5,
        unitCost: 10
      });

      const borrowId = await addTransfer(
        f,
        "borrow",
        {
          type: "Borrow",
          locationId,
          fromProjectId: f.projectId,
          toProjectId: borrowerId,
          paybackDueDate: "2026-12-31"
        },
        { itemId, quantity: 5 }
      );
      const borrowed = await postProjectStockTransfer(f.ctx, {
        projectStockTransferId: borrowId
      });
      expect(borrowed.error).toBeNull();

      const borrow = await f.db
        .selectFrom("projectBorrow")
        .select(["id", "quantity", "borrowedUnitCost", "status"])
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect([
        Number(borrow.quantity),
        Number(borrow.borrowedUnitCost),
        borrow.status
      ]).toEqual([5, 10, "Open"]);
      const borrowedLayer = await f.db
        .selectFrom("costLedger")
        .select(["projectId", "projectBorrowId", "cost"])
        .where("companyId", "=", f.companyId)
        .where("projectBorrowId", "=", borrow.id)
        .executeTakeFirstOrThrow();
      expect(borrowedLayer.projectId).toEqual(borrowerId);
      expect(Number(borrowedLayer.cost)).toEqual(50);

      // The borrower's own stock, older and dearer: 5 at 11.00. FIFO pays
      // back from it.
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: borrowerId,
        quantity: 5,
        unitCost: 11,
        postingDate: "2025-01-01"
      });

      const paybackId = await addTransfer(
        f,
        "payback",
        {
          type: "Payback",
          locationId,
          fromProjectId: borrowerId,
          toProjectId: f.projectId,
          settlesBorrowId: borrow.id
        },
        { itemId, quantity: 5 }
      );
      const paid = await postProjectStockTransfer(f.ctx, {
        projectStockTransferId: paybackId
      });
      expect(paid.error).toBeNull();

      const settled = await f.db
        .selectFrom("projectBorrow")
        .select(["quantityPaidBack", "status"])
        .where("id", "=", borrow.id)
        .executeTakeFirstOrThrow();
      expect([Number(settled.quantityPaidBack), settled.status]).toEqual([
        5,
        "Paid Back"
      ]);

      // The lender is made whole at the borrowed cost.
      expect(await stock(f, itemId)).toEqual([
        ["", 1],
        [f.projectId, 5],
        [borrowerId, 5]
      ]);
      const value = await layerValue(f, itemId);
      expect(value.get(f.projectId)).toEqual(50);
      expect(value.get(borrowerId)).toEqual(50);

      // The borrower takes the 5.00 difference.
      const variance = await f.db
        .selectFrom("projectLedger")
        .select([
          "projectId",
          "costType",
          "amount",
          "quantity",
          "journalLineId"
        ])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        variance.map((row) => [
          row.projectId,
          row.costType,
          Number(row.amount),
          Number(row.quantity)
        ])
      ).toEqual([[borrowerId, "Payback Variance", 5, 5]]);

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount"])
        .where("journalId", "=", paid.data!.journalId!)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("adjustment-variance"), 5],
        [f.account("inventory"), -5]
      ]);
      expect(variance[0]!.journalLineId).toEqual(lines[0]!.id);
      const tags = await f.db
        .selectFrom("journalLineDimension")
        .select(["journalLineId", "valueId"])
        .where("companyId", "=", f.companyId)
        .where("dimensionId", "=", f.dimension("Project"))
        .execute();
      expect(tags.map((tag) => tag.valueId)).toEqual([borrowerId, borrowerId]);
    } finally {
      await f.cleanup();
    }
  }
);

/** Posts an opening entry, Dr inventory / Cr misc, so the GL inventory
 *  balance starts equal to the fixture's unjournaled seed layers. */
async function postOpeningBalance(f: Fixture, value: number) {
  await f.db.transaction().execute(async (trx) => {
    const period = await resolveAccountingPeriod(
      trx,
      f.companyId,
      "2026-01-01",
      "current"
    );
    const journalId = await createAdjustmentJournal(trx, {
      companyId: f.companyId,
      accountingPeriodId: period.id,
      description: "Opening stock",
      postingDate: "2026-01-01",
      userId: "system",
      sourceType: "Opening Balance"
    });
    await trx
      .insertInto("journalLine")
      .values(
        buildAdjustmentJournalLines({
          journalId,
          documentId: `${f.prefix}-opening`,
          journalLineReference: `${f.prefix}-opening`,
          isGain: true,
          cost: value,
          quantity: 0,
          replenishmentSystem: "Buy",
          accountDefaults: {
            rawMaterialsAccount: f.account("inventory"),
            finishedGoodsAccount: f.account("inventory"),
            inventoryAdjustmentVarianceAccount: f.account("adjustment-variance")
          },
          offsetAccount: f.account("misc"),
          offsetDescription: "Opening stock",
          companyId: f.companyId
        })
      )
      .execute();
  });
}

/** The GL inventory balance, the open layer value and the valuation report
 *  total of the company, and the out-of-balance journals. */
async function tieOut(f: Fixture, itemId: string) {
  const gl = await f.db
    .selectFrom("journalLine")
    .select((eb) => eb.fn.sum<number>("amount").as("amount"))
    .where("companyId", "=", f.companyId)
    .where("accountId", "=", f.account("inventory"))
    .executeTakeFirstOrThrow();
  const layers = [...(await layerValue(f, itemId)).values()].reduce(
    (sum, value) => sum + value,
    0
  );
  const valuation = await sql<{ totalValue: number }>`
    SELECT COALESCE(SUM("totalValue"), 0) AS "totalValue"
    FROM get_inventory_valuation(${f.companyId})
    WHERE "itemId" = ${itemId}
  `.execute(f.db);
  const unbalanced = await f.db
    .selectFrom("journalLine")
    .select(["journalId", (eb) => eb.fn.sum<number>("amount").as("amount")])
    .where("companyId", "=", f.companyId)
    .groupBy("journalId")
    .having((eb) => eb.fn.sum("amount"), "<>", 0)
    .execute();
  return {
    gl: round(Number(gl.amount ?? 0)),
    layers: round(layers),
    valuation: round(Number(valuation.rows[0]?.totalValue ?? 0)),
    unbalanced: unbalanced.length
  };
}

/**
 * A Borrow of 5 at 10.00, then a Payback of `paybackQuantity` from the
 * borrower's older own stock at `paybackUnitCost`. Returns what the checks
 * read.
 */
async function borrowThenPayback(
  key: string,
  paybackUnitCost: number,
  paybackQuantity: number,
  check: (r: {
    f: Fixture;
    itemId: string;
    borrowerId: string;
    borrowId: string;
    paybackId: string;
    journalId: string | null;
  }) => Promise<void>
) {
  const f = await projectPostingFixture({ costTreatment: "Expense" });
  try {
    await f.enableProjectStock();
    const { itemId, locationId } = await f.addStockedItem(key, {
      quantity: 1,
      unitCost: 1
    });
    const borrowerId = `${f.prefix}-project-borrower`;
    await f.db
      .insertInto("project")
      .values({
        id: borrowerId,
        name: "Borrower",
        identifier: "BR",
        status: "Released",
        costTreatment: "Expense",
        projectStock: true,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    // The lender holds 5 at 10.00; the borrower 5 of its own, older, at the
    // payback cost. FIFO pays back from the borrower's own stock.
    await f.addStripeStock({
      itemId,
      locationId,
      projectId: f.projectId,
      quantity: 5,
      unitCost: 10
    });
    await f.addStripeStock({
      itemId,
      locationId,
      projectId: borrowerId,
      quantity: 5,
      unitCost: paybackUnitCost,
      postingDate: "2025-01-01"
    });
    await postOpeningBalance(f, 1 + 50 + 5 * paybackUnitCost);
    const opening = await tieOut(f, itemId);
    expect(opening.gl).toEqual(opening.layers);

    const borrowTransferId = await addTransfer(
      f,
      `${key}-borrow`,
      {
        type: "Borrow",
        locationId,
        fromProjectId: f.projectId,
        toProjectId: borrowerId,
        paybackDueDate: "2026-12-31"
      },
      { itemId, quantity: 5 }
    );
    const borrowed = await postProjectStockTransfer(f.ctx, {
      projectStockTransferId: borrowTransferId
    });
    expect(borrowed.error).toBeNull();
    // A Borrow posts no journal and changes no value.
    expect(borrowed.data?.journalId).toBeNull();
    expect(await tieOut(f, itemId)).toEqual(opening);
    const borrow = await f.db
      .selectFrom("projectBorrow")
      .select(["id", "borrowedUnitCost"])
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    expect(Number(borrow.borrowedUnitCost)).toEqual(10);

    const paybackId = await addTransfer(
      f,
      `${key}-payback`,
      {
        type: "Payback",
        locationId,
        fromProjectId: borrowerId,
        toProjectId: f.projectId,
        settlesBorrowId: borrow.id
      },
      { itemId, quantity: paybackQuantity }
    );
    const paid = await postProjectStockTransfer(f.ctx, {
      projectStockTransferId: paybackId
    });
    expect(paid.error).toBeNull();

    await check({
      f,
      itemId,
      borrowerId,
      borrowId: borrow.id,
      paybackId,
      journalId: paid.data?.journalId ?? null
    });

    // The tie-out holds after both steps: the GL inventory balance equals
    // the open layers and the valuation report, and every journal balances.
    const closing = await tieOut(f, itemId);
    expect(closing.gl).toEqual(closing.layers);
    expect(closing.valuation).toEqual(closing.layers);
    expect(closing.unbalanced).toEqual(0);
  } finally {
    await f.cleanup();
  }
}

/** The payback's layers in the lender's stripe, as [quantity, cost]. */
async function lenderPaybackLayers(
  f: Fixture,
  itemId: string,
  paybackId: string
) {
  const rows = await f.db
    .selectFrom("costLedger")
    .select(["quantity", "cost"])
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", itemId)
    .where("documentId", "=", paybackId)
    .where("projectId", "=", f.projectId)
    .execute();
  return rows.map((row) => [Number(row.quantity), Number(row.cost)]);
}

async function paybackVariances(f: Fixture) {
  const rows = await f.db
    .selectFrom("projectLedger")
    .select(["projectId", "costType", "amount"])
    .where("companyId", "=", f.companyId)
    .execute();
  return rows.map((row) => [row.projectId, row.costType, Number(row.amount)]);
}

databaseTest(
  "a Payback dearer than the Borrow (12.00 vs 10.00) charges the borrower and ties out",
  async () => {
    await borrowThenPayback(
      "dear",
      12,
      5,
      async ({ f, itemId, borrowerId, borrowId, paybackId, journalId }) => {
        // The lender is made whole at the borrowed 10.00.
        expect(await lenderPaybackLayers(f, itemId, paybackId)).toEqual([
          [5, 50]
        ]);
        // The borrower takes +10.00 (5 × 2.00).
        expect(await paybackVariances(f)).toEqual([
          [borrowerId, "Payback Variance", 10]
        ]);
        const lines = await f.db
          .selectFrom("journalLine")
          .select(["accountId", "amount"])
          .where("journalId", "=", journalId!)
          .orderBy("amount", "desc")
          .execute();
        expect(
          lines.map((line) => [line.accountId, Number(line.amount)])
        ).toEqual([
          [f.account("adjustment-variance"), 10],
          [f.account("inventory"), -10]
        ]);
        const settled = await f.db
          .selectFrom("projectBorrow")
          .select(["quantityPaidBack", "status"])
          .where("id", "=", borrowId)
          .executeTakeFirstOrThrow();
        expect([Number(settled.quantityPaidBack), settled.status]).toEqual([
          5,
          "Paid Back"
        ]);
      }
    );
  }
);

databaseTest(
  "a partial Payback cheaper than the Borrow (8.00 vs 10.00) credits the borrower and ties out",
  async () => {
    await borrowThenPayback(
      "cheap",
      8,
      3,
      async ({ f, itemId, borrowerId, borrowId, paybackId, journalId }) => {
        // The lender gets 3 back at the borrowed 10.00.
        expect(await lenderPaybackLayers(f, itemId, paybackId)).toEqual([
          [3, 30]
        ]);
        // The borrower takes −6.00 (3 × −2.00).
        expect(await paybackVariances(f)).toEqual([
          [borrowerId, "Payback Variance", -6]
        ]);
        const lines = await f.db
          .selectFrom("journalLine")
          .select(["accountId", "amount"])
          .where("journalId", "=", journalId!)
          .orderBy("amount", "desc")
          .execute();
        expect(
          lines.map((line) => [line.accountId, Number(line.amount)])
        ).toEqual([
          [f.account("inventory"), 6],
          [f.account("adjustment-variance"), -6]
        ]);
        // A partial payback reduces the borrow; it stays Open.
        const settled = await f.db
          .selectFrom("projectBorrow")
          .select(["quantityPaidBack", "status"])
          .where("id", "=", borrowId)
          .executeTakeFirstOrThrow();
        expect([Number(settled.quantityPaidBack), settled.status]).toEqual([
          3,
          "Open"
        ]);
      }
    );
  }
);

databaseTest(
  "government-furnished stock cannot move to common stock",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      await f.db
        .updateTable("project")
        .set({ governmentFurnished: true })
        .where("id", "=", f.projectId)
        .execute();
      const { itemId, locationId } = await f.addStockedItem("gfm", {
        quantity: 1,
        unitCost: 1
      });
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 2,
        unitCost: 4
      });
      const transferId = await addTransfer(
        f,
        "gfm",
        { type: "Transfer", locationId, fromProjectId: f.projectId },
        { itemId, quantity: 2 }
      );
      const posted = await postProjectStockTransfer(f.ctx, {
        projectStockTransferId: transferId
      });
      expect(posted.error?.message).toMatch(
        /Government-furnished stock of project TP/
      );
      expect(await stock(f, itemId)).toEqual([
        ["", 1],
        [f.projectId, 2]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
