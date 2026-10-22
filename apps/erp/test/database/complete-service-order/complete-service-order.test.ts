// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The spec's Phase C criteria for a refurbishment completion
// (.ai/specs/implemented/2026-10-08-field-service.md): serial SN-0050 sits in an
// unstamped layer of 10 at 100.00; labor 150.00 and parts 50.00 were charged
// to the order's WIP.

import { sql } from "kysely";
import { expect } from "vitest";
import { completeServiceOrder } from "../../../app/modules/service/service.service";
import {
  calculateCOGS,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;

const USER = "system";

class Rollback extends Error {}

/** One refurbishment: a serialized item with 10 units in one layer at
 *  100.00, serial SN-0050 On Hold, and an In Progress Refurbishment order
 *  whose Service project carries 200.00 of Capitalized charges. */
async function addRefurbishment(
  f: Fixture,
  key: string,
  args: {
    costingMethod?: "FIFO" | "LIFO" | "Average" | "Standard";
    salePrice?: number;
    expectedSellingPrice?: number;
    abnormalRework?: boolean;
  } = {}
) {
  const itemId = `${f.prefix}-refurb-item-${key}`;
  const locationId = `${f.prefix}-refurb-location-${key}`;
  const serialId = `${f.prefix}-sn0050-${key}`;
  const otherSerialId = `${f.prefix}-sn0051-${key}`;
  const projectId = `${f.prefix}-refurb-project-${key}`;
  const elementId = `${f.prefix}-refurb-element-${key}`;
  const serviceOrderId = `${f.prefix}-refurb-order-${key}`;
  const layerId = `${f.prefix}-refurb-layer-${key}`;

  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("account")
      .values({
        id: f.account("material-variance"),
        name: "Material variance",
        class: "Expense",
        incomeBalance: "Income Statement",
        companyGroupId: f.groupId,
        createdBy: USER
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await trx
      .updateTable("accountDefault")
      .set({ materialVarianceAccount: f.account("material-variance") })
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("unitOfMeasure")
      .values({
        code: "EA",
        name: "Each",
        companyId: f.companyId,
        createdBy: USER
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await trx
      .insertInto("location")
      .values({
        id: locationId,
        name: `Refurb ${key}`,
        addressLine1: "1 Main St",
        city: "Springfield",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: itemId,
        readableId: `${f.prefix}-REFURB-${key}`,
        name: `Machine ${key}`,
        type: "Part",
        itemTrackingType: "Serial",
        replenishmentSystem: "Buy",
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx.deleteFrom("itemCost").where("itemId", "=", itemId).execute();
    await trx
      .insertInto("itemCost")
      .values({
        itemId,
        costingMethod: args.costingMethod ?? "FIFO",
        unitCost: 100,
        standardCost: 100,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .deleteFrom("itemUnitSalePrice")
      .where("itemId", "=", itemId)
      .execute();
    if (args.salePrice !== undefined) {
      await trx
        .insertInto("itemUnitSalePrice")
        .values({
          itemId,
          unitSalePrice: args.salePrice,
          currencyCode: "USD",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    }
    await trx
      .insertInto("trackedEntity")
      .values(
        [serialId, otherSerialId].map((id, index) => ({
          id,
          readableId: index === 0 ? "SN-0050" : "SN-0051",
          itemId,
          quantity: 1,
          status: index === 0 ? ("On Hold" as const) : ("Available" as const),
          sourceDocument: "Item",
          sourceDocumentId: itemId,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("itemLedger")
      .values({
        postingDate: "2026-01-01",
        entryType: "Positive Adjmt.",
        itemId,
        locationId,
        quantity: 10,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("costLedger")
      .values({
        id: layerId,
        itemLedgerType: "Purchase",
        costLedgerType: "Direct Cost",
        adjustment: false,
        documentType: "Purchase Receipt",
        documentId: `${f.prefix}-receipt-${key}`,
        itemId,
        quantity: 10,
        cost: 1000,
        nominalCost: 1000,
        remainingQuantity: 10,
        postingDate: "2026-01-01",
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("project")
      .values({
        id: projectId,
        name: `Refurbishment ${key}`,
        identifier: `SVC-R-${key}`,
        status: "Released",
        projectType: "Service",
        costTreatment: "By Coverage",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("projectState")
      .values({
        id: `${projectId}-state`,
        // States are company-wide: one per test project, none the default.
        name: `Todo ${projectId}`,
        group: "Unstarted",
        color: "#000000",
        sortOrder: 0,
        isDefault: false,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("projectElement")
      .values({
        id: elementId,
        projectId,
        readableId: `R-${key}-1`,
        sequence: 1,
        type: "Task",
        name: "Overhaul",
        stateId: `${projectId}-state`,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("serviceOrder")
      .values({
        id: serviceOrderId,
        serviceOrderId: `SVC-R-${key}`,
        type: "Refurbishment",
        status: "In Progress",
        trackedEntityId: serialId,
        itemId,
        customerId: null,
        locationId,
        projectId,
        expectedSellingPrice: args.expectedSellingPrice ?? null,
        abnormalRework: args.abnormalRework ?? false,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("projectLedger")
      .values(
        (
          [
            ["Labor", 150],
            ["Material", 50]
          ] as const
        ).map(([costType, amount]) => ({
          projectId,
          projectElementId: elementId,
          postingDate: "2026-10-01",
          costType,
          documentType: costType === "Labor" ? "Timesheet" : "Project Issue",
          documentId: `${f.prefix}-${costType}-${key}`,
          amount,
          coverage: "Capitalized" as const,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });

  return {
    itemId,
    serialId,
    otherSerialId,
    projectId,
    elementId,
    serviceOrderId,
    layerId
  };
}

async function journalLines(f: Fixture, journalId: string | null) {
  if (!journalId) return [];
  return f.db
    .selectFrom("journalLine")
    .select(["accountId", "amount"])
    .where("journalId", "=", journalId)
    .where("companyId", "=", f.companyId)
    .orderBy("amount", "desc")
    .execute()
    .then((rows) =>
      rows.map((row) => ({
        accountId: row.accountId,
        amount: Number(row.amount)
      }))
    );
}

databaseTest(
  "a FIFO refurbishment gives the serial its own layer and relieves it at its new cost",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await addRefurbishment(f, "fifo");
      const result = await invokePosting(
        handlesOf(f.ctx),
        "complete-service-order",
        {
          serviceOrderId: r.serviceOrderId
        },
        completeServiceOrder
      );
      expect(result.error).toBeNull();
      expect(result.data?.capitalizedAmount).toEqual(200);
      expect(result.data?.writeDownAmount).toEqual(0);
      expect(result.data?.warnings).toEqual([
        "No sale price; the cost was not capped"
      ]);

      // The split: 9 left at 900.00, a stamped layer of 1 at 100.00 with a
      // 200.00 Revaluation child.
      const layers = await f.db
        .selectFrom("costLedger")
        .select([
          "id",
          "quantity",
          "remainingQuantity",
          "cost",
          "trackedEntityId",
          "appliesToCostLedgerId",
          "costLedgerType",
          "documentId"
        ])
        .where("itemId", "=", r.itemId)
        .where("companyId", "=", f.companyId)
        .execute();
      const source = layers.find((layer) => layer.id === r.layerId)!;
      expect(Number(source.quantity)).toEqual(9);
      expect(Number(source.remainingQuantity)).toEqual(9);
      expect(Number(source.cost)).toEqual(900);
      const stamped = layers.find(
        (layer) =>
          layer.trackedEntityId === r.serialId && !layer.appliesToCostLedgerId
      )!;
      expect(Number(stamped.quantity)).toEqual(1);
      expect(Number(stamped.cost)).toEqual(100);
      expect(stamped.documentId).toEqual(`${f.prefix}-receipt-fifo`);
      const revaluation = layers.filter(
        (layer) => layer.appliesToCostLedgerId === stamped.id
      );
      expect(revaluation).toHaveLength(1);
      expect(revaluation[0]!.costLedgerType).toEqual("Revaluation");
      expect(Number(revaluation[0]!.cost)).toEqual(200);

      // Dr inventory / Cr WIP 200.00, tagged with the project and its node.
      expect(await journalLines(f, result.data!.journalId)).toEqual([
        { accountId: f.account("inventory"), amount: 200 },
        { accountId: f.account("wip"), amount: -200 }
      ]);
      const tags = await f.db
        .selectFrom("journalLineDimension")
        .innerJoin(
          "journalLine",
          "journalLine.id",
          "journalLineDimension.journalLineId"
        )
        .select(["journalLine.accountId", "journalLineDimension.valueId"])
        .where("journalLine.journalId", "=", result.data!.journalId!)
        .execute();
      expect(tags).toEqual(
        expect.arrayContaining([
          { accountId: f.account("inventory"), valueId: r.projectId },
          { accountId: f.account("wip"), valueId: r.projectId },
          { accountId: f.account("wip"), valueId: r.elementId }
        ])
      );
      const journal = await f.db
        .selectFrom("journal")
        .select("sourceType")
        .where("id", "=", result.data!.journalId!)
        .executeTakeFirstOrThrow();
      expect(journal.sourceType).toEqual("Service Order");

      const serial = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", r.serialId)
        .executeTakeFirstOrThrow();
      expect(serial.status).toEqual("Available");
      const order = await f.db
        .selectFrom("serviceOrder")
        .select([
          "status",
          "capitalizedAmount",
          "writeDownAmount",
          "completionJournalId",
          "completionCostingMethod",
          "completedAt"
        ])
        .where("id", "=", r.serviceOrderId)
        .executeTakeFirstOrThrow();
      expect(order).toMatchObject({
        status: "Completed",
        completionJournalId: result.data!.journalId,
        completionCostingMethod: "FIFO"
      });
      expect(Number(order.capitalizedAmount)).toEqual(200);
      expect(order.completedAt).not.toBeNull();
      const project = await f.db
        .selectFrom("project")
        .select("status")
        .where("id", "=", r.projectId)
        .executeTakeFirstOrThrow();
      expect(project.status).toEqual("Technically Complete");

      // The valuation report counts 10 units, the child costed with its
      // parent: 9 × 100.00 + 1 × (100.00 + 200.00) = 1,200.00.
      const valuation = await sql<{
        quantityOnHand: number;
        unitCost: number;
        totalValue: number;
      }>`
        SELECT "quantityOnHand", "unitCost", "totalValue"
        FROM get_inventory_valuation(${f.companyId})
        WHERE "itemId" = ${r.itemId}
      `.execute(f.db);
      expect(valuation.rows).toHaveLength(1);
      expect(Number(valuation.rows[0]!.quantityOnHand)).toEqual(10);
      expect(Number(valuation.rows[0]!.unitCost)).toEqual(120);
      expect(Number(valuation.rows[0]!.totalValue)).toEqual(1200);

      // A second completion is refused.
      const again = await invokePosting(
        handlesOf(f.ctx),
        "complete-service-order",
        {
          serviceOrderId: r.serviceOrderId
        },
        completeServiceOrder
      );
      expect(again.error?.status).toEqual(422);

      // Relief: SN-0050 leaves at 300.00, another unit at 100.00.
      await f.db
        .transaction()
        .execute(async (trx) => {
          const refurbished = await calculateCOGS(trx, {
            itemId: r.itemId,
            quantity: 1,
            companyId: f.companyId,
            trackedEntityIds: [r.serialId]
          });
          expect(refurbished.totalCost).toEqual(300);
          const other = await calculateCOGS(trx, {
            itemId: r.itemId,
            quantity: 1,
            companyId: f.companyId,
            trackedEntityIds: [r.otherSerialId]
          });
          expect(other.totalCost).toEqual(100);
          throw new Rollback();
        })
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a refurbishment is capped at the sale price, or at the order's price",
  async () => {
    const f = await projectPostingFixture();
    try {
      const bySalePrice = await addRefurbishment(f, "sale", { salePrice: 250 });
      const sale = await invokePosting(
        handlesOf(f.ctx),
        "complete-service-order",
        {
          serviceOrderId: bySalePrice.serviceOrderId
        },
        completeServiceOrder
      );
      expect(sale.error).toBeNull();
      expect(sale.data?.writeDownAmount).toEqual(50);
      expect(await journalLines(f, sale.data!.journalId)).toEqual([
        { accountId: f.account("inventory"), amount: 200 },
        { accountId: f.account("adjustment-variance"), amount: 50 },
        { accountId: f.account("inventory"), amount: -50 },
        { accountId: f.account("wip"), amount: -200 }
      ]);

      const byOrderPrice = await addRefurbishment(f, "order", {
        salePrice: 250,
        expectedSellingPrice: 280
      });
      const order = await invokePosting(
        handlesOf(f.ctx),
        "complete-service-order",
        {
          serviceOrderId: byOrderPrice.serviceOrderId
        },
        completeServiceOrder
      );
      expect(order.error).toBeNull();
      expect(order.data?.writeDownAmount).toEqual(20);

      // The serial leaves at its capped cost.
      await f.db
        .transaction()
        .execute(async (trx) => {
          const relief = await calculateCOGS(trx, {
            itemId: bySalePrice.itemId,
            quantity: 1,
            companyId: f.companyId,
            trackedEntityIds: [bySalePrice.serialId]
          });
          expect(relief.totalCost).toEqual(250);
          throw new Rollback();
        })
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "abnormal rework posts to material variance and the serial keeps its cost",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await addRefurbishment(f, "abnormal", { abnormalRework: true });
      const result = await invokePosting(
        handlesOf(f.ctx),
        "complete-service-order",
        {
          serviceOrderId: r.serviceOrderId
        },
        completeServiceOrder
      );
      expect(result.error).toBeNull();
      expect(result.data?.capitalizedAmount).toEqual(0);
      expect(await journalLines(f, result.data!.journalId)).toEqual([
        { accountId: f.account("material-variance"), amount: 200 },
        { accountId: f.account("wip"), amount: -200 }
      ]);
      const children = await f.db
        .selectFrom("costLedger")
        .select("id")
        .where("itemId", "=", r.itemId)
        .where("adjustment", "=", true)
        .execute();
      expect(children).toHaveLength(0);

      await f.db
        .transaction()
        .execute(async (trx) => {
          const relief = await calculateCOGS(trx, {
            itemId: r.itemId,
            quantity: 1,
            companyId: f.companyId,
            trackedEntityIds: [r.serialId]
          });
          expect(relief.totalCost).toEqual(100);
          throw new Rollback();
        })
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("an Average refurbishment re-averages the unit cost", async () => {
  const f = await projectPostingFixture();
  try {
    const r = await addRefurbishment(f, "average", {
      costingMethod: "Average"
    });
    const result = await invokePosting(
      handlesOf(f.ctx),
      "complete-service-order",
      {
        serviceOrderId: r.serviceOrderId
      },
      completeServiceOrder
    );
    expect(result.error).toBeNull();
    const cost = await f.db
      .selectFrom("itemCost")
      .select("unitCost")
      .where("itemId", "=", r.itemId)
      .executeTakeFirstOrThrow();
    expect(Number(cost.unitCost)).toEqual(120);
    // The Revaluation child keeps the cost in the ledger, attached to nothing.
    const child = await f.db
      .selectFrom("costLedger")
      .select(["cost", "appliesToCostLedgerId", "remainingQuantity"])
      .where("itemId", "=", r.itemId)
      .where("costLedgerType", "=", "Revaluation")
      .executeTakeFirstOrThrow();
    expect(Number(child.cost)).toEqual(200);
    expect(child.appliesToCostLedgerId).toBeNull();
    expect(Number(child.remainingQuantity)).toEqual(0);
  } finally {
    await f.cleanup();
  }
});

// C2: the source layer has an open purchase price variance child of 10 units
// at 20.00. The split moves one unit of it (2.00) onto the serial's layer, so
// the serial and the other units each relieve the cost calculateCOGS gave
// them before the split.
databaseTest(
  "a split moves one unit of the source layer's open child with the serial",
  async () => {
    const f = await projectPostingFixture();
    try {
      const r = await addRefurbishment(f, "child");
      const childId = `${f.prefix}-refurb-child`;
      await f.db
        .insertInto("costLedger")
        .values({
          id: childId,
          itemLedgerType: "Purchase",
          costLedgerType: "Direct Cost",
          adjustment: true,
          appliesToCostLedgerId: r.layerId,
          itemId: r.itemId,
          quantity: 10,
          cost: 20,
          nominalCost: 20,
          remainingQuantity: 10,
          postingDate: "2026-01-02",
          companyId: f.companyId
        })
        .execute();

      const result = await invokePosting(
        handlesOf(f.ctx),
        "complete-service-order",
        {
          serviceOrderId: r.serviceOrderId
        },
        completeServiceOrder
      );
      expect(result.error).toBeNull();

      const rows = await f.db
        .selectFrom("costLedger")
        .select([
          "id",
          "quantity",
          "remainingQuantity",
          "cost",
          "trackedEntityId",
          "appliesToCostLedgerId",
          "costLedgerType"
        ])
        .where("itemId", "=", r.itemId)
        .where("companyId", "=", f.companyId)
        .execute();
      const child = rows.find((row) => row.id === childId)!;
      expect(Number(child.quantity)).toEqual(9);
      expect(Number(child.remainingQuantity)).toEqual(9);
      expect(Number(child.cost)).toEqual(18);
      const stamped = rows.find(
        (row) =>
          row.trackedEntityId === r.serialId && !row.appliesToCostLedgerId
      )!;
      const moved = rows.filter(
        (row) =>
          row.appliesToCostLedgerId === stamped.id &&
          row.costLedgerType !== "Revaluation"
      );
      expect(moved).toHaveLength(1);
      expect(Number(moved[0]!.quantity)).toEqual(1);
      expect(Number(moved[0]!.cost)).toEqual(2);

      // The serial leaves at 100.00 + 2.00 + 200.00; the other 9 units at
      // 9 × (100.00 + 2.00), as before the split.
      await f.db
        .transaction()
        .execute(async (trx) => {
          const refurbished = await calculateCOGS(trx, {
            itemId: r.itemId,
            quantity: 1,
            companyId: f.companyId,
            trackedEntityIds: [r.serialId]
          });
          expect(refurbished.totalCost).toEqual(302);
          const rest = await calculateCOGS(trx, {
            itemId: r.itemId,
            quantity: 9,
            companyId: f.companyId
          });
          expect(rest.totalCost).toEqual(918);
          throw new Rollback();
        })
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await f.cleanup();
    }
  }
);
