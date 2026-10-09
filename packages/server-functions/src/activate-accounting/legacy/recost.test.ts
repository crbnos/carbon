// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What the enable's re-cost and the repair's relief take as a layer and as a
// relief (spec section 5, step 3). A company receives 5 parts at 8 and 5 at
// 12 before the cutover, so its opening layer holds 10 at 10; the movements
// after it are re-costed against that layer.

import { sql } from "kysely";
import { expect } from "vitest";
import issue from "../../issue";
import journalLegacyDocuments from "../../journal-legacy-documents";
import { databaseTest } from "../../local-database-test-fixture";
import activateAccounting from "..";
import {
  activationFixture,
  enableWithStockAtTen,
  type Fixture,
  glBalance,
  jobFixture,
  moveBeforeCutover,
  receiveFiveParts,
  shipFiveParts,
  USER,
  unwrap
} from "../activation-test-fixture";

databaseTest(
  "the enable's re-cost leaves a job return out of the layers",
  async () => {
    const f = await activationFixture();
    try {
      await stockBeforeCutover(f);
      // After it: 2 issued to a job, 1 of them returned.
      const job = await jobFixture(f);
      for (const adjustmentType of [
        "Negative Adjmt.",
        "Positive Adjmt."
      ] as const) {
        unwrap(
          await issue(f.ctx, {
            type: "partToOperation",
            id: job.operationId,
            itemId: f.partId,
            materialId: job.materialId,
            quantity: adjustmentType === "Negative Adjmt." ? 2 : 1,
            adjustmentType
          })
        );
      }

      await enableWithStockAtTen(f);

      // The issue re-costs from the opening layer. The return stays a
      // relief with nothing remaining: it opened no layer.
      expect(await costRows(f, job.jobId)).toEqual([
        { quantity: -2, cost: -20, remainingQuantity: 0 },
        { quantity: 1, cost: expect.any(Number), remainingQuantity: 0 }
      ]);
      expect(await openingRemaining(f)).toBe(8);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a serial recost after the cutover keeps its cost and does not block the enable",
  async () => {
    const f = await activationFixture();
    try {
      await stockBeforeCutover(f);
      // After it, `recost-serial-unit` relieved a unit at 8 and booked it
      // again at 15, on a layer of its own.
      const unit = await f.db
        .insertInto("trackedEntity")
        .values({
          itemId: f.partId,
          quantity: 1,
          sourceDocument: "Item",
          sourceDocumentId: f.partId,
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const revaluation = (quantity: number, cost: number) => ({
        itemLedgerType:
          quantity < 0
            ? ("Negative Adjmt." as const)
            : ("Positive Adjmt." as const),
        costLedgerType: "Revaluation" as const,
        adjustment: false,
        documentType: null,
        documentId: unit.id,
        itemId: f.partId,
        quantity,
        cost,
        remainingQuantity: quantity > 0 ? quantity : 0,
        trackedEntityId: unit.id,
        postingDate: f.today,
        companyId: f.companyId
      });
      await f.db
        .insertInto("costLedger")
        .values([revaluation(-1, -8), revaluation(1, 15)])
        .execute();

      await enableWithStockAtTen(f);

      // Not re-costed: the account its difference was booked against is not
      // stored. It still took its unit from the opening layer.
      expect(await costRows(f, unit.id)).toEqual([
        { quantity: -1, cost: -8, remainingQuantity: 0 },
        { quantity: 1, cost: 15, remainingQuantity: 1 }
      ]);
      expect(await openingRemaining(f)).toBe(9);
      expect(await recostJournals(f)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a legacy purchase return carried at no cost gets its pair, and the re-cost adjusts it",
  async () => {
    const f = await activationFixture();
    try {
      await stockBeforeCutover(f);
      // After it: 1 part returned to the supplier at no cost, with no
      // journal.
      const shipmentId = `${f.prefix}-return`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("shipment")
          .values({
            id: shipmentId,
            shipmentId: "RTN-1",
            sourceDocument: "Purchase Return Order",
            sourceDocumentId: `${f.prefix}-purchase-return`,
            locationId: f.locationId,
            status: "Posted",
            postingDate: f.today,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("costLedger")
          .values({
            itemLedgerType: "Purchase",
            costLedgerType: "Direct Cost",
            adjustment: false,
            documentType: "Purchase Return Shipment",
            documentId: shipmentId,
            itemId: f.partId,
            quantity: -1,
            cost: 0,
            remainingQuantity: 0,
            postingDate: f.today,
            companyId: f.companyId
          })
          .execute();
      });

      const result = await enableWithStockAtTen(f);
      expect(result.legacyJournals.returnShipments).toBe(1);

      // The re-cost found the pair written at zero and moved the part's 10
      // from inventory to GR/IR, signed by the GR/IR account's class.
      expect(await costRows(f, shipmentId)).toEqual([
        { quantity: -1, cost: -10, remainingQuantity: 0 }
      ]);
      expect(await recostJournals(f)).toEqual(["Purchase Return Shipment"]);
      expect(await glBalance(f, "grni")).toBeCloseTo(90, 6);
      expect(await glBalance(f, "inventory")).toBeCloseTo(90, 6);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the enable re-costs a LIFO item's legacy shipment from the newest layer",
  async () => {
    const f = await activationFixture();
    try {
      await setCostingMethod(f, "LIFO");
      await stockBeforeCutover(f);
      // After it: 5 received at 14, then 5 shipped, as a company with
      // accounting off left it (no "Sale" row, no relief, no journal).
      const lastIn = await receiveFiveParts(f, { id: "po-3", unitPrice: 14 });
      const shipmentId = await shipFiveParts(f);
      await forgetSale(f);

      await enableWithStockAtTen(f);

      // LIFO takes the 14s received after the cutover, not the opening 10s.
      expect(await costRows(f, shipmentId)).toEqual([
        { quantity: -5, cost: -70, remainingQuantity: 0 }
      ]);
      expect(await openingRemaining(f)).toBe(10);
      expect(await layerRemaining(f, lastIn)).toBe(0);
      expect(await glBalance(f, "cogs")).toBeCloseTo(70, 6);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the repair relieves a LIFO item's open layers newest first",
  async () => {
    const f = await activationFixture();
    try {
      await setCostingMethod(f, "LIFO");
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: f.account("scrap") })
        .where("companyId", "=", f.companyId)
        .execute();
      unwrap(
        await activateAccounting(f.ctx, {
          cutoverDate: f.cutoverDate,
          confirmation: f.companyName
        })
      );
      // After the enable: 5 received at 8, 5 at 12, 5 shipped; then the
      // shipment's "Sale" row, its relief and its journal are taken away.
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      const shipmentId = await shipFiveParts(f);
      await forgetSale(f);

      unwrap(await journalLegacyDocuments(f.ctx, {}));

      expect(await costRows(f, shipmentId)).toEqual([
        { quantity: -5, cost: -60, remainingQuantity: 0 }
      ]);
      expect(await glBalance(f, "cogs")).toBeCloseTo(60, 6);
      expect(await glBalance(f, "inventory")).toBeCloseTo(40, 6);
    } finally {
      await f.cleanup();
    }
  }
);

/** 5 parts at 8 and 5 at 12, received the day before the cutover. */
async function stockBeforeCutover(f: Fixture) {
  await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
  await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
  await moveBeforeCutover(f);
}

async function setCostingMethod(f: Fixture, costingMethod: "FIFO" | "LIFO") {
  await f.db
    .updateTable("itemCost")
    .set({ costingMethod })
    .where("itemId", "=", f.partId)
    .where("companyId", "=", f.companyId)
    .execute();
}

/** Takes away the shipment's "Sale" row, its relief of the layers and its
 *  journal, past the posted journal's immutability. */
async function forgetSale(f: Fixture) {
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .deleteFrom("costLedger")
      .where("companyId", "=", f.companyId)
      .where("itemLedgerType", "=", "Sale")
      .execute();
    await trx
      .updateTable("costLedger")
      .set({ remainingQuantity: sql`"quantity"` })
      .where("companyId", "=", f.companyId)
      .where("itemLedgerType", "=", "Purchase")
      .where("quantity", ">", 0)
      .execute();
    const journalIds = trx
      .selectFrom("journal")
      .select("id")
      .where("companyId", "=", f.companyId)
      .where("sourceType", "=", "Sales Shipment");
    await trx
      .deleteFrom("journalLineDimension")
      .where("companyId", "=", f.companyId)
      .where(
        "journalLineId",
        "in",
        trx
          .selectFrom("journalLine")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("journalId", "in", journalIds)
      )
      .execute();
    await trx
      .deleteFrom("journalLine")
      .where("companyId", "=", f.companyId)
      .where("journalId", "in", journalIds)
      .execute();
    await trx
      .deleteFrom("journal")
      .where("companyId", "=", f.companyId)
      .where("sourceType", "=", "Sales Shipment")
      .execute();
  });
}

/** A document's cost rows, in the order they were written. */
async function costRows(f: Fixture, documentId: string) {
  const rows = await f.db
    .selectFrom("costLedger")
    .select(["quantity", "cost", "remainingQuantity"])
    .where("companyId", "=", f.companyId)
    .where("documentId", "=", documentId)
    .orderBy("entryNumber")
    .execute();
  return rows.map((row) => ({
    quantity: Number(row.quantity),
    cost: Number(row.cost),
    remainingQuantity: Number(row.remainingQuantity)
  }));
}

/** What the opening layer still holds. */
async function openingRemaining(f: Fixture) {
  const row = await f.db
    .selectFrom("costLedger")
    .select("remainingQuantity")
    .where("companyId", "=", f.companyId)
    .where("postingDate", "=", f.cutoverDate)
    .where("documentId", "is", null)
    .where("documentType", "=", "Purchase Receipt")
    .executeTakeFirstOrThrow();
  return Number(row.remainingQuantity);
}

/** What the layer of a purchase order line's receipt still holds. */
async function layerRemaining(f: Fixture, purchaseOrderLineId: string) {
  const row = await f.db
    .selectFrom("costLedger")
    .innerJoin("receiptLine", "receiptLine.receiptId", "costLedger.documentId")
    .select("costLedger.remainingQuantity")
    .where("costLedger.companyId", "=", f.companyId)
    .where("receiptLine.lineId", "=", purchaseOrderLineId)
    .where("costLedger.quantity", ">", 0)
    .executeTakeFirstOrThrow();
  return Number(row.remainingQuantity);
}

/** The source types of the re-cost's journals. */
async function recostJournals(f: Fixture) {
  const rows = await f.db
    .selectFrom("journal")
    .select("sourceType")
    .where("companyId", "=", f.companyId)
    .where("description", "=", "Cutover recost")
    .execute();
  return rows.map((row) => row.sourceType);
}
