// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { type Insertable, sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import postAssetTransfer from "../post-asset-transfer";
import { chargeFixture } from "../post-charge/post-charge-test-fixture";
import { FILLER_ACCOUNT_DEFAULTS } from "../post-reimbursement/post-reimbursement-test-fixture";
import previewSerialUnitCosts from "../preview-serial-unit-costs";
import recostSerialUnit from "../recost-serial-unit";
import { ServerFnContext } from "../server-fn-context";
import previewAssetCapitalization from "./index";

type Fixture = Awaited<ReturnType<typeof chargeFixture>>;

// A FIFO serial item whose unit cost (100) is NOT what either unit carries:
// one unit has its own layer at 60, the other has none and the item's unit
// cost is the fallback. The company has no accounting cutover, so every
// journal is Provisional; a Retained Earnings (Equity) account is there to
// credit an entered cost to.
async function capitalizationFixture(f: Fixture, unitCost: number) {
  const { db, companyId } = f;
  const company = await db
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  const companyGroupId = company.companyGroupId;
  if (!companyGroupId) throw new Error("Expected a company group");
  const retainedEarnings = f.account("retained-earnings");
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("account")
      .values({
        id: retainedEarnings,
        name: "Retained Earnings",
        class: "Equity",
        incomeBalance: "Balance Sheet",
        companyGroupId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("accountDefault")
      .values({
        companyId,
        ...Object.fromEntries(
          FILLER_ACCOUNT_DEFAULTS.map((column) => [column, f.account("bank")])
        ),
        payablesAccount: f.account("bank"),
        employeeReimbursementsPayableAccount: f.account("bank")
      } as unknown as Insertable<KyselyDatabase["accountDefault"]>)
      .execute();
    await trx
      .updateTable("companySettings")
      .set({ accountingCutoverDate: null })
      .where("id", "=", companyId)
      .execute();
  });

  const item = await db
    .insertInto("item")
    .values({
      readableId: `${companyId}-RW`,
      name: "Reaction Wheel",
      type: "Part",
      itemTrackingType: "Serial",
      replenishmentSystem: "Buy",
      companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.deleteFrom("itemCost").where("itemId", "=", item.id).execute();
  await db
    .insertInto("itemCost")
    .values({
      itemId: item.id,
      costingMethod: "FIFO",
      unitCost,
      companyId,
      createdBy: "system"
    })
    .execute();

  const location = await db
    .insertInto("location")
    .values({
      name: "Plant",
      addressLine1: "1 Main St",
      city: "Springfield",
      postalCode: "00000",
      timezone: "America/New_York",
      companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const assetClass = await db
    .insertInto("fixedAssetClass")
    .values({
      name: "Rental Fleet",
      assetAccountId: f.account("expense"),
      accumulatedDepreciationAccountId: f.account("expense"),
      depreciationExpenseAccountId: f.account("expense"),
      writeOffAccountId: f.account("expense"),
      writeDownAccountId: f.account("expense"),
      lossOnDisposalAccountId: f.account("expense"),
      gainOnDisposalAccountId: f.account("income"),
      companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await db
    .insertInto("sequence")
    .values([
      { table: "fixedAsset", name: "Fixed Asset", prefix: "FA", companyId },
      {
        table: "fixedAssetTransfer",
        name: "Fixed Asset Transfer",
        prefix: "FAT",
        companyId
      }
    ])
    .execute();

  const unit = async (readableId: string) => {
    const entity = await db
      .insertInto("trackedEntity")
      .values({
        readableId,
        itemId: item.id,
        quantity: 1,
        sourceDocument: "Item",
        sourceDocumentId: item.id,
        companyId,
        createdBy: "system"
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("itemLedger")
      .values({
        entryType: "Positive Adjmt.",
        itemId: item.id,
        quantity: 1,
        locationId: location.id,
        trackedEntityId: entity.id,
        postingDate: "2026-01-01",
        companyId
      })
      .execute();
    return entity.id;
  };

  return {
    itemId: item.id,
    locationId: location.id,
    assetClass,
    retainedEarnings,
    unit
  };
}

const context = (f: Fixture) =>
  ServerFnContext.system({
    db: f.db,
    companyId: f.companyId,
    userId: "system"
  });

async function preview(f: Fixture, trackedEntityId: string) {
  const result = await previewAssetCapitalization(context(f), {
    trackedEntityId
  });
  if (result.error) throw result.error;
  return result.data.cost;
}

databaseTest(
  "the preview is the cost capitalize books, and consumes nothing",
  async () => {
    const f = await chargeFixture();
    try {
      const c = await capitalizationFixture(f, 100);
      const serial = await c.unit("SN-1");
      const layer = await f.db
        .insertInto("costLedger")
        .values({
          itemLedgerType: "Positive Adjmt.",
          costLedgerType: "Direct Cost",
          itemId: c.itemId,
          quantity: 1,
          cost: 60,
          remainingQuantity: 1,
          postingDate: "2026-01-01",
          trackedEntityId: serial,
          companyId: f.companyId
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      // The unit's own layer, not the item's unit cost.
      expect(await preview(f, serial)).toEqual(60);
      const untouched = await f.db
        .selectFrom("costLedger")
        .select("remainingQuantity")
        .where("id", "=", layer.id)
        .executeTakeFirstOrThrow();
      expect(Number(untouched.remainingQuantity)).toEqual(1);

      const posted = await postAssetTransfer(context(f), {
        type: "capitalize",
        fixedAssetClassId: c.assetClass.id,
        itemId: c.itemId,
        trackedEntityId: serial,
        locationId: c.locationId,
        transferDate: "2026-01-02"
      });
      if (posted.error) throw posted.error;
      const asset = await f.db
        .selectFrom("fixedAsset")
        .select("acquisitionCost")
        .where("id", "=", posted.data.fixedAssetId)
        .executeTakeFirstOrThrow();
      expect(Number(asset.acquisitionCost)).toEqual(60);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a unit with no cost in inventory is refused, not capitalized at zero",
  async () => {
    const f = await chargeFixture();
    try {
      const c = await capitalizationFixture(f, 0);
      const serial = await c.unit("SN-2");

      expect(await preview(f, serial)).toEqual(0);

      const posted = await postAssetTransfer(context(f), {
        type: "capitalize",
        fixedAssetClassId: c.assetClass.id,
        itemId: c.itemId,
        trackedEntityId: serial,
        locationId: c.locationId,
        transferDate: "2026-01-02"
      });
      expect(posted.error?.message).toMatch(/SN-2 has no cost in inventory/);

      // Rolled back: no asset, the unit still Available and in stock.
      const assets = await f.db
        .selectFrom("fixedAsset")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(assets).toHaveLength(0);
      const entity = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", serial)
        .executeTakeFirstOrThrow();
      expect(entity.status).toEqual("Available");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a unit with no cost in inventory is capitalized at the cost entered for it",
  async () => {
    const f = await chargeFixture();
    try {
      const c = await capitalizationFixture(f, 0);
      const serial = await c.unit("SN-3");

      const posted = await postAssetTransfer(context(f), {
        type: "capitalize",
        fixedAssetClassId: c.assetClass.id,
        itemId: c.itemId,
        trackedEntityId: serial,
        locationId: c.locationId,
        transferDate: "2026-01-02",
        cost: 4200,
        offsetAccountId: c.retainedEarnings
      });
      if (posted.error) throw posted.error;

      const asset = await f.db
        .selectFrom("fixedAsset")
        .select(["acquisitionCost", "status"])
        .where("id", "=", posted.data.fixedAssetId)
        .executeTakeFirstOrThrow();
      expect(Number(asset.acquisitionCost)).toEqual(4200);
      expect(asset.status).toEqual("Active");
      const transfer = await f.db
        .selectFrom("fixedAssetTransfer")
        .select(["amount", "type", "status"])
        .where("fixedAssetId", "=", posted.data.fixedAssetId)
        .executeTakeFirstOrThrow();
      expect(Number(transfer.amount)).toEqual(4200);
      expect(transfer.type).toEqual("Capitalization");
      expect(transfer.status).toEqual("Posted");
      // Before the cutover the journal is Provisional and has no period.
      const journal = await f.db
        .selectFrom("journal")
        .innerJoin("fixedAssetTransfer", (join) =>
          join
            .onRef("fixedAssetTransfer.journalId", "=", "journal.id")
            .onRef("fixedAssetTransfer.companyId", "=", "journal.companyId")
        )
        .select(["journal.status", "journal.accountingPeriodId"])
        .where("fixedAssetTransfer.fixedAssetId", "=", posted.data.fixedAssetId)
        .executeTakeFirstOrThrow();
      expect(journal.status).toEqual("Provisional");
      expect(journal.accountingPeriodId).toBeNull();
      // The unit left stock all the same.
      const entity = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", serial)
        .executeTakeFirstOrThrow();
      expect(entity.status).toEqual("Consumed");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a cost entered for a unit that carries one is refused",
  async () => {
    const f = await chargeFixture();
    try {
      const c = await capitalizationFixture(f, 100);
      const serial = await c.unit("SN-4");

      const posted = await postAssetTransfer(context(f), {
        type: "capitalize",
        fixedAssetClassId: c.assetClass.id,
        itemId: c.itemId,
        trackedEntityId: serial,
        locationId: c.locationId,
        transferDate: "2026-01-02",
        cost: 4200,
        offsetAccountId: c.retainedEarnings
      });
      expect(posted.error?.message).toMatch(
        /SN-4 is carried in inventory at a cost/
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "adjustCost raises a zero-cost asset's cost and brings it back to Active",
  async () => {
    const f = await chargeFixture();
    try {
      const c = await capitalizationFixture(f, 0);
      // What Make to Asset leaves behind for a job with no WIP: an asset at
      // zero, which a depreciation run then marks Fully Depreciated.
      const asset = await f.db
        .insertInto("fixedAsset")
        .values({
          fixedAssetId: `${f.companyId}-FA`,
          name: "Reaction Wheel SN-5",
          fixedAssetClassId: c.assetClass.id,
          itemId: c.itemId,
          locationId: c.locationId,
          depreciationMethod: "Straight Line",
          usefulLifeMonths: 60,
          residualValuePercent: 20,
          acquisitionCost: 0,
          acquisitionDate: "2026-01-02",
          depreciationStartDate: "2026-01-02",
          status: "Fully Depreciated",
          quantity: 1,
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const adjust = (amount: number) =>
        postAssetTransfer(context(f), {
          type: "adjustCost",
          fixedAssetId: asset.id,
          amount,
          offsetAccountId: c.retainedEarnings,
          locationId: c.locationId,
          transferDate: "2026-03-01"
        });

      const first = await adjust(5000);
      if (first.error) throw first.error;
      const second = await adjust(250);
      if (second.error) throw second.error;

      const adjusted = await f.db
        .selectFrom("fixedAsset")
        .select(["acquisitionCost", "status"])
        .where("id", "=", asset.id)
        .executeTakeFirstOrThrow();
      expect(Number(adjusted.acquisitionCost)).toEqual(5250);
      expect(adjusted.status).toEqual("Active");

      const transfers = await f.db
        .selectFrom("fixedAssetTransfer")
        .select(["amount", "type", "sourceType", "status"])
        .where("fixedAssetId", "=", asset.id)
        .orderBy("transferId")
        .execute();
      expect(
        transfers.map((t) => [Number(t.amount), t.type, t.sourceType, t.status])
      ).toEqual([
        [5000, "Cost Adjustment", "Manual", "Posted"],
        [250, "Cost Adjustment", "Manual", "Posted"]
      ]);

      // A disposed asset is off the books; its cost cannot change.
      await f.db
        .updateTable("fixedAsset")
        .set({ status: "Disposed" })
        .where("id", "=", asset.id)
        .execute();
      const refused = await adjust(100);
      expect(refused.error?.message).toMatch(/is Disposed/);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "each serial's inventory cost is what capitalizing it would book",
  async () => {
    const f = await chargeFixture();
    try {
      const c = await capitalizationFixture(f, 100);
      const own = await c.unit("SN-6");
      const queued = await c.unit("SN-7");
      await f.db
        .insertInto("costLedger")
        .values([
          {
            itemLedgerType: "Positive Adjmt.",
            costLedgerType: "Direct Cost",
            itemId: c.itemId,
            quantity: 1,
            cost: 60,
            remainingQuantity: 1,
            postingDate: "2026-01-01",
            trackedEntityId: own,
            companyId: f.companyId
          },
          {
            itemLedgerType: "Positive Adjmt.",
            costLedgerType: "Direct Cost",
            itemId: c.itemId,
            quantity: 1,
            cost: 40,
            remainingQuantity: 1,
            postingDate: "2026-01-01",
            companyId: f.companyId
          }
        ])
        .execute();

      const listed = await previewSerialUnitCosts(context(f), {
        itemId: c.itemId,
        locationId: c.locationId
      });
      if (listed.error) throw listed.error;
      expect(listed.data.costs).toEqual({ [own]: 60, [queued]: 40 });
      expect(await preview(f, own)).toEqual(60);
      expect(await preview(f, queued)).toEqual(40);

      // A unit that has left stock is not listed.
      await f.db
        .insertInto("itemLedger")
        .values({
          entryType: "Negative Adjmt.",
          itemId: c.itemId,
          quantity: -1,
          locationId: c.locationId,
          trackedEntityId: queued,
          postingDate: "2026-01-03",
          companyId: f.companyId
        })
        .execute();
      const after = await previewSerialUnitCosts(context(f), {
        itemId: c.itemId
      });
      if (after.error) throw after.error;
      expect(Object.keys(after.data.costs)).toEqual([own]);
    } finally {
      await f.cleanup();
    }
  }
);

// After the accounting cutover: the journal is Posted, and must sign each
// line by its own account's class.
async function withAccounting(
  f: Fixture,
  c: Awaited<ReturnType<typeof capitalizationFixture>>
) {
  await f.db
    .updateTable("companySettings")
    .set({ accountingCutoverDate: "2000-01-01" })
    .where("id", "=", f.companyId)
    .execute();
  return { retainedEarnings: c.retainedEarnings };
}

async function journalLines(f: Fixture, journalId: string | null) {
  if (!journalId) throw new Error("Expected a journal");
  const lines = await f.db
    .selectFrom("journalLine")
    .select(["accountId", "amount"])
    .where("journalId", "=", journalId)
    .orderBy("amount", "desc")
    .orderBy("accountId")
    .execute();
  return lines.map((line) => [line.accountId, Number(line.amount)]);
}

databaseTest(
  "an entered cost and a cost adjustment credit Retained Earnings",
  async () => {
    const f = await chargeFixture();
    try {
      const c = await capitalizationFixture(f, 0);
      const { retainedEarnings } = await withAccounting(f, c);
      const serial = await c.unit("SN-8");

      const posted = await postAssetTransfer(context(f), {
        type: "capitalize",
        fixedAssetClassId: c.assetClass.id,
        itemId: c.itemId,
        trackedEntityId: serial,
        locationId: c.locationId,
        transferDate: "2026-01-02",
        cost: 4200,
        offsetAccountId: retainedEarnings
      });
      if (posted.error) throw posted.error;
      const capitalization = await f.db
        .selectFrom("fixedAssetTransfer")
        .select("journalId")
        .where("id", "=", posted.data.id!)
        .executeTakeFirstOrThrow();
      // Dr the class asset account (an Expense-class account in this
      // fixture: +4200 is a debit) / Cr Retained Earnings (Equity: +4200 is
      // a credit).
      expect(await journalLines(f, capitalization.journalId)).toEqual([
        [f.account("expense"), 4200],
        [retainedEarnings, 4200]
      ]);

      const adjusted = await postAssetTransfer(context(f), {
        type: "adjustCost",
        fixedAssetId: posted.data.fixedAssetId,
        amount: 800,
        offsetAccountId: retainedEarnings,
        locationId: c.locationId,
        transferDate: "2026-01-03"
      });
      if (adjusted.error) throw adjusted.error;
      const adjustment = await f.db
        .selectFrom("fixedAssetTransfer")
        .select("journalId")
        .where("id", "=", adjusted.data.id!)
        .executeTakeFirstOrThrow();
      expect(await journalLines(f, adjustment.journalId)).toEqual([
        [f.account("expense"), 800],
        [retainedEarnings, 800]
      ]);

      // Without an offset account there is nothing to credit.
      const refused = await postAssetTransfer(context(f), {
        type: "adjustCost",
        fixedAssetId: posted.data.fixedAssetId,
        amount: 100,
        locationId: c.locationId,
        transferDate: "2026-01-03"
      });
      expect(refused.error?.message).toMatch(/Choose the account/);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "recosting a unit carried at zero gives it a layer of its own, booked from the offset",
  async () => {
    const f = await chargeFixture();
    try {
      const c = await capitalizationFixture(f, 0);
      const { retainedEarnings } = await withAccounting(f, c);
      const serial = await c.unit("SN-9");
      // Completed by a job that recorded nothing: a layer at zero.
      await f.db
        .insertInto("costLedger")
        .values({
          itemLedgerType: "Output",
          costLedgerType: "Direct Cost",
          itemId: c.itemId,
          quantity: 1,
          cost: 0,
          remainingQuantity: 1,
          postingDate: "2026-01-01",
          companyId: f.companyId
        })
        .execute();

      const recost = (unitCost: number) =>
        recostSerialUnit(context(f), {
          trackedEntityId: serial,
          unitCost,
          offsetAccountId: retainedEarnings,
          postingDate: "2026-01-02"
        });

      const raised = await recost(500);
      if (raised.error) throw raised.error;
      expect(raised.data.previousCost).toEqual(0);
      // Dr inventory (Raw Materials, Asset) / Cr Retained Earnings (Equity).
      expect(await journalLines(f, raised.data.journalId)).toEqual([
        [f.account("bank"), 500],
        [retainedEarnings, 500]
      ]);

      const costs = await previewSerialUnitCosts(context(f), {
        itemId: c.itemId
      });
      if (costs.error) throw costs.error;
      expect(costs.data.costs).toEqual({ [serial]: 500 });

      // A write-down reverses the sides.
      const lowered = await recost(400);
      if (lowered.error) throw lowered.error;
      expect(lowered.data.previousCost).toEqual(500);
      expect(await journalLines(f, lowered.data.journalId)).toEqual([
        [f.account("bank"), -100],
        [retainedEarnings, -100]
      ]);
      expect((await recost(400)).error?.message).toMatch(
        /already carried at that cost/
      );

      // Capitalizing now moves the recosted value out of inventory.
      expect(await preview(f, serial)).toEqual(400);
      const posted = await postAssetTransfer(context(f), {
        type: "capitalize",
        fixedAssetClassId: c.assetClass.id,
        itemId: c.itemId,
        trackedEntityId: serial,
        locationId: c.locationId,
        transferDate: "2026-01-03"
      });
      if (posted.error) throw posted.error;
      const asset = await f.db
        .selectFrom("fixedAsset")
        .select("acquisitionCost")
        .where("id", "=", posted.data.fixedAssetId)
        .executeTakeFirstOrThrow();
      expect(Number(asset.acquisitionCost)).toEqual(400);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("an Average item's unit cannot be recosted", async () => {
  const f = await chargeFixture();
  try {
    const c = await capitalizationFixture(f, 0);
    await f.db
      .updateTable("itemCost")
      .set({ costingMethod: "Average" })
      .where("itemId", "=", c.itemId)
      .execute();
    const serial = await c.unit("SN-10");
    const result = await recostSerialUnit(context(f), {
      trackedEntityId: serial,
      unitCost: 500,
      postingDate: "2026-01-02"
    });
    expect(result.error?.message).toMatch(/uses Average costing/);
  } finally {
    await f.cleanup();
  }
});
