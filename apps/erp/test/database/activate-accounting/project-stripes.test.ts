// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The enable's inventory reset and re-cost keep project stock on its stripe
// (`calculateCOGS` relieves a stripe from its own layers only), and a
// project stock transfer after the cutover moves its re-costed cost at cost.

import { round } from "@carbon/utils";
import { sql } from "kysely";
import { expect } from "vitest";
import { paybackRecostRefusal } from "../../../app/modules/accounting/accounting.service";
import {
  buildCostLedgerRow,
  buildItemLedgerRow
} from "../../../app/modules/shared/shared.service";
import {
  activationFixture,
  enableWithStockAtTen,
  type Fixture,
  moveBeforeCutover,
  receiveFiveParts,
  USER
} from "../fixtures/activation";
import { databaseTest } from "../fixtures/local-database";

async function addProject(f: Fixture) {
  const project = await f.db
    .insertInto("project")
    .values({ name: "Stripe", companyId: f.companyId, createdBy: USER })
    .returning("id")
    .executeTakeFirstOrThrow();
  return project.id;
}

/** Moves `quantity` parts from common stock to `projectId` at `cost`. A
 *  Payback names a borrow that is not there: only its type matters to the
 *  re-cost, so its foreign keys are not checked. */
async function transferToProject(
  f: Fixture,
  args: {
    projectId: string;
    quantity: number;
    cost: number;
    date: string;
    type?: "Transfer" | "Payback";
  }
) {
  const type = args.type ?? "Transfer";
  return f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    if (type === "Payback") {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    }
    const transfer = await trx
      .insertInto("projectStockTransfer")
      .values({
        projectStockTransferId: `${f.prefix}-PST`,
        type,
        status: "Posted",
        fromProjectId: null,
        toProjectId: args.projectId,
        settlesBorrowId: type === "Payback" ? `${f.prefix}-borrow` : null,
        locationId: f.locationId,
        reason: "Test",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await sql`SET LOCAL session_replication_role = origin`.execute(trx);
    const base = {
      postingDate: args.date,
      entryType: "Transfer" as const,
      documentType: "Project Transfer" as const,
      documentId: transfer.id,
      itemId: f.partId,
      locationId: f.locationId,
      storageUnitId: null,
      trackedEntityId: null,
      companyId: f.companyId,
      createdBy: USER
    };
    await trx
      .insertInto("itemLedger")
      .values([
        buildItemLedgerRow({ ...base, quantity: -args.quantity }),
        buildItemLedgerRow({
          ...base,
          quantity: args.quantity,
          projectId: args.projectId
        })
      ])
      .execute();
    const layer = {
      entryType: "Transfer" as const,
      documentType: "Project Transfer" as const,
      documentId: transfer.id,
      itemId: f.partId,
      postingDate: args.date,
      trackedEntityId: null,
      companyId: f.companyId
    };
    await trx
      .insertInto("costLedger")
      .values(
        buildCostLedgerRow({
          ...layer,
          quantity: -args.quantity,
          cost: -args.cost
        })
      )
      .execute();
    await trx
      .insertInto("costLedger")
      .values(
        buildCostLedgerRow({
          ...layer,
          quantity: args.quantity,
          cost: args.cost,
          projectId: args.projectId
        })
      )
      .execute();
    return transfer.id;
  });
}

function openLayers(f: Fixture) {
  return (
    f.db
      .selectFrom("costLedger")
      .select([
        "projectId",
        sql<number>`sum("remainingQuantity")`.as("remaining"),
        sql<number>`sum("cost" * "remainingQuantity" / "quantity")`.as("value")
      ])
      .where("companyId", "=", f.companyId)
      .where("remainingQuantity", ">", 0)
      .where("adjustment", "=", false)
      .groupBy("projectId")
      // The project's stripe first, then common stock.
      .orderBy(sql`"projectId" IS NULL`)
      .execute()
      .then((rows) =>
        rows.map((row) => ({
          projectId: row.projectId,
          remaining: Number(row.remaining),
          value: round(Number(row.value))
        }))
      )
  );
}

databaseTest(
  "the inventory reset opens project stock on its own stripe",
  async () => {
    const f = await activationFixture();
    try {
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      const projectId = await addProject(f);
      await transferToProject(f, {
        projectId,
        quantity: 3,
        cost: 24,
        date: f.today
      });
      await moveBeforeCutover(f);

      await enableWithStockAtTen(f);

      // 10 on hand at 10.00: 3 on the project's stripe, 7 in common stock.
      expect(await openLayers(f)).toEqual([
        { projectId, remaining: 3, value: 30 },
        { projectId: null, remaining: 7, value: 70 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a project stock transfer after the cutover is re-costed at cost, with no journal",
  async () => {
    const f = await activationFixture();
    try {
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      await moveBeforeCutover(f);
      const projectId = await addProject(f);
      // Posted after the cutover from the first receipt's layer, at 8.00.
      const transferId = await transferToProject(f, {
        projectId,
        quantity: 3,
        cost: 24,
        date: f.today
      });

      await enableWithStockAtTen(f);

      // The opening layer is 10 at 10.00, so the 3 drawn cost 30.00, and the
      // layer they opened on the stripe holds 30.00.
      const rows = await f.db
        .selectFrom("costLedger")
        .select(["projectId", "quantity", "cost"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", transferId)
        .orderBy("quantity")
        .execute();
      expect(
        rows.map((row) => [
          row.projectId,
          Number(row.quantity),
          Number(row.cost)
        ])
      ).toEqual([
        [null, -3, -30],
        [projectId, 3, 30]
      ]);
      expect(await openLayers(f)).toEqual([
        { projectId, remaining: 3, value: 30 },
        { projectId: null, remaining: 7, value: 70 }
      ]);
      const recost = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("description", "=", "Cutover recost")
        .execute();
      expect(recost).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the enable refuses a payback after the cutover whose cost the re-cost changes, and names it",
  async () => {
    const f = await activationFixture();
    try {
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      await moveBeforeCutover(f);
      const projectId = await addProject(f);
      // Posted after the cutover from the first receipt's layer, at 8.00;
      // against the opening layer at 10.00 its cost changes.
      await transferToProject(f, {
        projectId,
        quantity: 3,
        cost: 24,
        date: f.today,
        type: "Payback"
      });

      await expect(enableWithStockAtTen(f)).rejects.toThrow(
        paybackRecostRefusal(`${f.prefix}-PST`, f.today)
      );
      // Nothing was written: the company still has no cutover.
      const settings = await f.db
        .selectFrom("companySettings")
        .select("accountingCutoverDate")
        .where("id", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(settings.accountingCutoverDate).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);
