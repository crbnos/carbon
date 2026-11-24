// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// A Project Issue with no storage unit chosen takes stock from the bins that
// hold it, never "no storage unit" by default, and never a quarantine bin. A
// serial or batch is taken from the bin it is in. A Return with no bin goes
// back to the bins the issues drew from.

import { sql } from "kysely";
import { expect } from "vitest";
import { postProjectIssue } from "../../../app/modules/projects/projects.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import {
  PROJECT_TEST_USER,
  projectPostingFixture
} from "../fixtures/project-posting";

type F = Awaited<ReturnType<typeof projectPostingFixture>>;

/** An untracked item at a new location with storage units `units` (a false
 *  value: non-nettable) and `stock` per unit name (`null`: no storage unit),
 *  each at 10.00 a unit, in common stock unless a project is named. */
async function itemWithBins(
  f: F,
  key: string,
  units: Record<string, boolean>,
  stock: { unit: string | null; quantity: number; projectId?: string }[]
) {
  const { itemId, locationId } = await f.addStockedItem(key, {
    quantity: 0,
    unitCost: 10
  });
  const bin = (name: string) => `${f.prefix}-${key}-${name}`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("storageUnit")
      .values(
        Object.entries(units).map(([name, nettable]) => ({
          id: bin(name),
          name,
          locationId,
          nettable,
          effectiveNettable: nettable,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        }))
      )
      .execute();
  });
  for (const row of stock) {
    await f.addStripeStock({
      itemId,
      locationId,
      projectId: row.projectId ?? null,
      quantity: row.quantity,
      unitCost: 10,
      storageUnitId: row.unit === null ? null : bin(row.unit)
    });
  }
  return { itemId, locationId, bin };
}

const post = (
  f: F,
  input: {
    itemId: string;
    locationId: string;
    quantity: number;
    direction: "Issue" | "Return";
    storageUnitId?: string;
    trackedEntityId?: string;
  }
) =>
  invokePosting(
    handlesOf(f.ctx),
    "post-project-issue",
    { projectId: f.projectId, projectElementId: f.elementId, ...input },
    postProjectIssue
  );

/** The item's Project Issue rows in posting order: [bin, quantity, stripe]. */
async function issueRows(f: F, itemId: string) {
  const rows = await f.db
    .selectFrom("itemLedger")
    .select(["storageUnitId", "quantity", "projectId"])
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", itemId)
    .where("documentType", "=", "Project Issue")
    .orderBy("entryNumber")
    .execute();
  return rows.map((row) => [
    row.storageUnitId,
    Number(row.quantity),
    row.projectId
  ]);
}

async function onHandIn(f: F, itemId: string, storageUnitId: string | null) {
  const row = await f.db
    .selectFrom("itemLedger")
    .select((eb) => eb.fn.sum<string>("quantity").as("quantity"))
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", itemId)
    .where("storageUnitId", "is not distinct from", storageUnitId)
    .executeTakeFirstOrThrow();
  return Number(row.quantity ?? 0);
}

databaseTest(
  "an issue with no storage unit takes the stock from the bin that holds it",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId, bin } = await itemWithBins(
        f,
        "one-bin",
        { A: true },
        [{ unit: "A", quantity: 5 }]
      );
      const issued = await post(f, {
        itemId,
        locationId,
        quantity: 3,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      expect(issued.data?.cost).toEqual(30);
      expect(await issueRows(f, itemId)).toEqual([[bin("A"), -3, null]]);
      expect(await onHandIn(f, itemId, bin("A"))).toEqual(2);
      expect(await onHandIn(f, itemId, null)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an issue split across bins takes the fullest first, and its return goes back to the newest draw first",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId, bin } = await itemWithBins(
        f,
        "split",
        { A: true, B: true },
        [
          { unit: "A", quantity: 2 },
          { unit: "B", quantity: 5 }
        ]
      );
      const issued = await post(f, {
        itemId,
        locationId,
        quantity: 6,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      expect(issued.data?.cost).toEqual(60);
      expect(await issueRows(f, itemId)).toEqual([
        [bin("B"), -5, null],
        [bin("A"), -1, null]
      ]);

      // 2 back: 1 to A (the newest draw), then 1 to B.
      const returned = await post(f, {
        itemId,
        locationId,
        quantity: 2,
        direction: "Return"
      });
      expect(returned.error).toBeNull();
      expect((await issueRows(f, itemId)).slice(2)).toEqual([
        [bin("A"), 1, null],
        [bin("B"), 1, null]
      ]);
      expect(await onHandIn(f, itemId, bin("A"))).toEqual(2);
      expect(await onHandIn(f, itemId, bin("B"))).toEqual(1);
      expect(await onHandIn(f, itemId, null)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an issue with stock nowhere books the shortfall and is not refused while negative stock is allowed",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId } = await itemWithBins(
        f,
        "none",
        { A: true },
        []
      );
      const issued = await post(f, {
        itemId,
        locationId,
        quantity: 2,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      expect(await issueRows(f, itemId)).toEqual([[null, -2, null]]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a quarantine bin is never drawn when no storage unit is chosen",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId, bin } = await itemWithBins(
        f,
        "quarantine",
        { A: true, Q: false },
        [
          { unit: "A", quantity: 2 },
          { unit: "Q", quantity: 10 }
        ]
      );
      const issued = await post(f, {
        itemId,
        locationId,
        quantity: 3,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      // A gives its 2 and carries the 1 short; Q keeps its 10.
      expect(await issueRows(f, itemId)).toEqual([[bin("A"), -3, null]]);
      expect(await onHandIn(f, itemId, bin("Q"))).toEqual(10);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a named storage unit is still used as named",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId, bin } = await itemWithBins(
        f,
        "named",
        { A: true, B: true },
        [
          { unit: "A", quantity: 1 },
          { unit: "B", quantity: 5 }
        ]
      );
      const issued = await post(f, {
        itemId,
        locationId,
        quantity: 3,
        direction: "Issue",
        storageUnitId: bin("A")
      });
      expect(issued.error).toBeNull();
      expect(await issueRows(f, itemId)).toEqual([[bin("A"), -3, null]]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a project with project stock draws its stock in every bin before common stock",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      const { itemId, locationId, bin } = await itemWithBins(
        f,
        "stripes",
        { A: true, B: true },
        [
          { unit: "A", quantity: 3, projectId: f.projectId },
          { unit: "B", quantity: 5 }
        ]
      );
      const issued = await post(f, {
        itemId,
        locationId,
        quantity: 4,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      expect(await issueRows(f, itemId)).toEqual([
        [bin("A"), -3, f.projectId],
        [bin("B"), -1, null]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "Prevent negative stock refuses an issue with no storage unit only when the bins it may draw hold too little",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId, bin } = await itemWithBins(
        f,
        "strict",
        { A: true, B: true, Q: false },
        [
          { unit: "A", quantity: 2 },
          { unit: "B", quantity: 5 },
          { unit: "Q", quantity: 10 }
        ]
      );
      await f.db
        .updateTable("companySettings")
        .set({
          requireBackflushStorageUnit: true,
          preventNegativeBackflush: true
        })
        .where("id", "=", f.companyId)
        .execute();

      // Q's 10 do not count: 7 is all that can be drawn.
      const refused = await post(f, {
        itemId,
        locationId,
        quantity: 8,
        direction: "Issue"
      });
      expect(refused.error?.status).toEqual(400);
      expect(await issueRows(f, itemId)).toEqual([]);

      const issued = await post(f, {
        itemId,
        locationId,
        quantity: 7,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      expect(await issueRows(f, itemId)).toEqual([
        [bin("B"), -5, null],
        [bin("A"), -2, null]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a batch issued with no storage unit is booked in the bin it is in, and returns there",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId, bin } = await itemWithBins(
        f,
        "batch-bins",
        { A: true, B: true },
        []
      );
      const itemId = `${f.prefix}-item-batch`;
      const lotId = `${f.prefix}-lot`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("item")
          .values({
            id: itemId,
            readableId: `${f.prefix}-batch`,
            name: "Batch part",
            type: "Part",
            itemTrackingType: "Batch",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: PROJECT_TEST_USER
          })
          .execute();
        await trx.deleteFrom("itemCost").where("itemId", "=", itemId).execute();
        await trx
          .insertInto("itemCost")
          .values({
            itemId,
            costingMethod: "FIFO",
            unitCost: 10,
            companyId: f.companyId,
            createdBy: PROJECT_TEST_USER
          })
          .execute();
        await trx
          .insertInto("trackedEntity")
          .values({
            id: lotId,
            readableId: lotId,
            quantity: 5,
            status: "Available",
            sourceDocument: "Item",
            sourceDocumentId: itemId,
            itemId,
            companyId: f.companyId,
            createdBy: PROJECT_TEST_USER
          })
          .execute();
        // Received into B, then moved to A: B nets to 0.
        const ledger = (storageUnitId: string, quantity: number) => ({
          postingDate: "2026-01-01",
          entryType: quantity > 0 ? "Positive Adjmt." : "Negative Adjmt.",
          itemId,
          locationId,
          storageUnitId,
          trackedEntityId: lotId,
          quantity,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        });
        await trx
          .insertInto("itemLedger")
          .values([
            ledger(bin("B"), 5),
            ledger(bin("B"), -5),
            ledger(bin("A"), 5)
          ] as never)
          .execute();
        await trx
          .insertInto("costLedger")
          .values({
            itemLedgerType: "Positive Adjmt.",
            costLedgerType: "Direct Cost",
            adjustment: false,
            itemId,
            trackedEntityId: lotId,
            quantity: 5,
            cost: 50,
            remainingQuantity: 5,
            postingDate: "2026-01-01",
            companyId: f.companyId
          })
          .execute();
      });

      const issued = await post(f, {
        itemId,
        locationId,
        quantity: 2,
        direction: "Issue",
        trackedEntityId: lotId
      });
      expect(issued.error).toBeNull();
      expect(await issueRows(f, itemId)).toEqual([[bin("A"), -2, null]]);

      const returned = await post(f, {
        itemId,
        locationId,
        quantity: 1,
        direction: "Return",
        trackedEntityId: lotId
      });
      expect(returned.error).toBeNull();
      expect((await issueRows(f, itemId)).slice(1)).toEqual([
        [bin("A"), 1, null]
      ]);
      expect(await onHandIn(f, itemId, bin("A"))).toEqual(4);
      expect(await onHandIn(f, itemId, bin("B"))).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);
