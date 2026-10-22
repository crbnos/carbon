// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { expect } from "vitest";
import { postProjectIssue } from "../../../app/modules/projects/projects.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

databaseTest(
  "issuing stock to an Expense project relieves FIFO cost to the project, and a return reverses it at the issue's cost",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId } = await f.addStockedItem("bolt", {
        quantity: 10,
        unitCost: 10
      });
      await f.db
        .insertInto("projectElementMaterial")
        .values({
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId,
          quantity: 8,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();

      const issued = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId,
          locationId,
          quantity: 5,
          direction: "Issue"
        },
        postProjectIssue
      );
      expect(issued.error).toBeNull();
      expect(issued.data?.cost).toEqual(50);

      const itemLedger = await f.db
        .selectFrom("itemLedger")
        .select(["id", "quantity", "entryType", "documentType", "documentId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Project Issue")
        .execute();
      expect(itemLedger).toHaveLength(1);
      expect(Number(itemLedger[0]!.quantity)).toEqual(-5);
      expect(itemLedger[0]).toMatchObject({
        entryType: "Negative Adjmt.",
        documentId: f.projectId
      });

      const consumption = await f.db
        .selectFrom("costLedger")
        .select(["quantity", "cost"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Project Issue")
        .execute();
      expect(consumption.map((row) => Number(row.cost))).toEqual([-50]);

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount", "documentType"])
        .where("journalId", "=", issued.data!.journalId!)
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("project-expense"), 50],
        [f.account("inventory"), -50]
      ]);
      expect(lines.every((line) => line.documentType === "Project Issue")).toBe(
        true
      );
      const tags = await f.db
        .selectFrom("journalLineDimension")
        .select(["dimensionId", "valueId"])
        .where("journalLineId", "=", lines[0]!.id)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(tags).toEqual(
        expect.arrayContaining([
          { dimensionId: f.dimension("Project"), valueId: f.projectId },
          {
            dimensionId: f.dimension("ProjectElement"),
            valueId: f.elementId
          }
        ])
      );

      const returned = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId,
          locationId,
          quantity: 2,
          direction: "Return"
        },
        postProjectIssue
      );
      expect(returned.error).toBeNull();

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["costType", "documentId", "quantity", "amount"])
        .where("companyId", "=", f.companyId)
        .orderBy("createdAt")
        .orderBy("amount", "desc")
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          row.documentId,
          Number(row.quantity),
          Number(row.amount)
        ])
      ).toEqual([
        ["Material", itemLedger[0]!.id, 5, 50],
        ["Material", returned.data!.itemLedgerId, -2, -20]
      ]);

      const plan = await f.db
        .selectFrom("projectElementMaterial")
        .select("quantityIssued")
        .where("projectElementId", "=", f.elementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(plan.quantityIssued)).toEqual(3);

      const element = await f.db
        .selectFrom("projectElement")
        .select("stateId")
        .where("id", "=", f.elementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(element.stateId).toEqual(f.state("doing"));

      const issue = (quantity: number, item = itemId) =>
        invokePosting(
          handlesOf(f.ctx),
          "post-project-issue",
          {
            projectId: f.projectId,
            itemId: item,
            locationId,
            quantity,
            direction: "Issue"
          },
          postProjectIssue
        );
      const onHand = async (item = itemId) =>
        Number(
          (
            await f.db
              .selectFrom("itemLedger")
              .select((eb) => eb.fn.sum<string>("quantity").as("quantity"))
              .where("itemId", "=", item)
              .where("companyId", "=", f.companyId)
              .executeTakeFirstOrThrow()
          ).quantity ?? 0
        );

      // More than is on hand goes below zero while the company does not
      // prevent negative stock, and still charges the project a cost.
      expect(await onHand()).toEqual(7);
      const short = await issue(9);
      expect(short.error).toBeNull();
      expect(await onHand()).toEqual(-2);
      const shortCharge = await f.db
        .selectFrom("projectLedger")
        .select("amount")
        .where("documentId", "=", short.data!.itemLedgerId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(shortCharge.amount)).toBeGreaterThan(0);

      // A unit with no cost is refused, and nothing is booked.
      const free = await f.addStockedItem("washer", {
        quantity: 0,
        unitCost: 0
      });
      const noCost = await issue(1, free.itemId);
      expect(noCost.error?.status).toEqual(400);
      expect(noCost.error?.message).toContain("has no cost");
      expect(await onHand(free.itemId)).toEqual(0);

      // Strict backflush with Prevent negative stock refuses the shortfall.
      await f.db
        .updateTable("companySettings")
        .set({ requireBackflushStorageUnit: true, preventNegativeBackflush: true })
        .where("id", "=", f.companyId)
        .execute();
      const prevented = await issue(1);
      expect(prevented.error?.status).toEqual(400);
      expect(prevented.error?.message).toContain("Prevent negative stock");
      expect(await onHand()).toEqual(-2);
    } finally {
      await f.cleanup();
    }
  }
);

/**
 * A Service project whose node links the installed serial TR-100, and the
 * replacement serial TR-200 of the same part in stock at FIFO cost 40.00.
 * The part sells for 120.00 with a 12-month parts warranty; TR-100's own
 * parts warranty runs to 2099-12-31.
 */
async function serviceReplacementFixture() {
  const f = await projectPostingFixture();
  const order = await f.addServiceOrder("replace");
  const partId = `${f.prefix}-part-tr`;
  const locationId = order.locationId;
  const installedId = `${f.prefix}-tr-100`;
  const replacementId = `${f.prefix}-tr-200`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("item")
      .values({
        id: partId,
        readableId: `${f.prefix}-TR`,
        name: "Transmitter",
        type: "Part",
        itemTrackingType: "Serial",
        replenishmentSystem: "Buy",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx.deleteFrom("itemCost").where("itemId", "=", partId).execute();
    await trx
      .insertInto("itemCost")
      .values({
        itemId: partId,
        costingMethod: "FIFO",
        unitCost: 40,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .deleteFrom("itemUnitSalePrice")
      .where("itemId", "=", partId)
      .execute();
    await trx
      .insertInto("itemUnitSalePrice")
      .values({
        itemId: partId,
        unitSalePrice: 120,
        partsWarrantyMonths: 12,
        currencyCode: "USD",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("trackedEntity")
      .values([
        {
          id: installedId,
          readableId: "TR-100",
          itemId: partId,
          quantity: 0,
          status: "Consumed",
          sourceDocument: "Item",
          sourceDocumentId: partId,
          companyId: f.companyId,
          createdBy: "system"
        },
        {
          id: replacementId,
          readableId: "TR-200",
          itemId: partId,
          quantity: 1,
          status: "Available",
          sourceDocument: "Item",
          sourceDocumentId: partId,
          companyId: f.companyId,
          createdBy: "system"
        }
      ])
      .execute();
    await trx
      .insertInto("itemLedger")
      .values({
        postingDate: "2026-01-01",
        entryType: "Positive Adjmt.",
        itemId: partId,
        locationId,
        trackedEntityId: replacementId,
        quantity: 1,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("costLedger")
      .values({
        itemLedgerType: "Positive Adjmt.",
        costLedgerType: "Direct Cost",
        adjustment: false,
        itemId: partId,
        trackedEntityId: replacementId,
        quantity: 1,
        cost: 40,
        remainingQuantity: 1,
        postingDate: "2026-01-01",
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("customerAssetComponent")
      .values({
        id: `${f.prefix}-cac-tr-100`,
        customerAssetId: order.customerAssetId,
        itemId: partId,
        trackedEntityId: installedId,
        installedDate: "2025-01-01",
        partsWarrantyEndDate: "2099-12-31",
        serviceOrderId: order.serviceOrderId,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .updateTable("projectElement")
      .set({ itemId: partId, trackedEntityId: installedId })
      .where("id", "=", f.elementId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
  const today = datetime.today("America/New_York").toString();
  return { f, order, partId, locationId, installedId, replacementId, today };
}

databaseTest(
  "issuing serial TR-200 to a node that links the installed TR-100 installs TR-200, removes TR-100 and writes the Service activity",
  async () => {
    const { f, order, partId, locationId, replacementId, today } =
      await serviceReplacementFixture();
    try {
      const issued = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId: partId,
          locationId,
          trackedEntityId: replacementId,
          quantity: 1,
          direction: "Issue"
        },
        postProjectIssue
      );
      expect(issued.error).toBeNull();
      expect(issued.data?.cost).toEqual(40);

      // TR-100's own parts warranty covers the replacement.
      const lines = await f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount"])
        .where("journalId", "=", issued.data!.journalId!)
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("warranty"), 40],
        [f.account("inventory"), -40]
      ]);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["id", "coverage"])
        .where("id", "=", issued.data!.projectLedgerId!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(ledger.coverage).toEqual("Warranty");

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select(["unitPrice", "quantity", "status", "description"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        status: "Unbilled",
        description: "Transmitter (Covered by warranty)"
      });
      expect(Number(items[0]!.unitPrice)).toEqual(0);

      const components = await f.db
        .selectFrom("customerAssetComponent")
        .select([
          "trackedEntityId",
          "installedDate",
          "partsWarrantyEndDate",
          "projectLedgerId",
          "projectElementId",
          "removedDate",
          "removedByServiceOrderId"
        ])
        .where("companyId", "=", f.companyId)
        .orderBy("installedDate")
        .execute();
      const oneYearOn = parseDate(today).add({ months: 12 }).toString();
      expect(components).toEqual([
        {
          trackedEntityId: `${f.prefix}-tr-100`,
          installedDate: "2025-01-01",
          partsWarrantyEndDate: "2099-12-31",
          projectLedgerId: null,
          projectElementId: null,
          removedDate: today,
          removedByServiceOrderId: order.serviceOrderId
        },
        {
          trackedEntityId: replacementId,
          installedDate: today,
          partsWarrantyEndDate: oneYearOn,
          projectLedgerId: ledger.id,
          projectElementId: f.elementId,
          removedDate: null,
          removedByServiceOrderId: null
        }
      ]);

      const activity = await f.db
        .selectFrom("trackedActivity")
        .innerJoin(
          "trackedActivityInput",
          "trackedActivityInput.trackedActivityId",
          "trackedActivity.id"
        )
        .innerJoin(
          "trackedActivityOutput",
          "trackedActivityOutput.trackedActivityId",
          "trackedActivity.id"
        )
        .select([
          "trackedActivity.type",
          "trackedActivity.sourceDocument",
          "trackedActivity.sourceDocumentId",
          "trackedActivityInput.trackedEntityId as input",
          "trackedActivityOutput.trackedEntityId as output"
        ])
        .where("trackedActivity.companyId", "=", f.companyId)
        .execute();
      expect(activity).toEqual([
        {
          type: "Service",
          sourceDocument: "Service Order",
          sourceDocumentId: order.serviceOrderId,
          input: replacementId,
          output: order.subjectSerialId
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "returning TR-200 writes off its billable item, deletes its component and activity, and puts TR-100 back",
  async () => {
    const { f, partId, locationId, replacementId } =
      await serviceReplacementFixture();
    try {
      const issued = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId: partId,
          locationId,
          trackedEntityId: replacementId,
          quantity: 1,
          direction: "Issue"
        },
        postProjectIssue
      );
      expect(issued.error).toBeNull();

      const returned = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId: partId,
          locationId,
          trackedEntityId: replacementId,
          quantity: 1,
          direction: "Return"
        },
        postProjectIssue
      );
      expect(returned.error).toBeNull();

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", returned.data!.journalId!)
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("inventory"), 40],
        [f.account("warranty"), -40]
      ]);

      const returnRow = await f.db
        .selectFrom("projectLedger")
        .select(["reversalOfId", "coverage", "amount"])
        .where("id", "=", returned.data!.projectLedgerId!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(returnRow).toMatchObject({
        reversalOfId: issued.data!.projectLedgerId,
        coverage: "Warranty"
      });
      expect(Number(returnRow.amount)).toEqual(-40);

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select(["status", "statusReason"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(items).toEqual([
        { status: "Written Off", statusReason: "Reversed" }
      ]);

      const components = await f.db
        .selectFrom("customerAssetComponent")
        .select(["trackedEntityId", "removedDate", "removedByServiceOrderId"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(components).toEqual([
        {
          trackedEntityId: `${f.prefix}-tr-100`,
          removedDate: null,
          removedByServiceOrderId: null
        }
      ]);

      const activities = await f.db
        .selectFrom("trackedActivity")
        .select("id")
        .where("type", "=", "Service")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(activities).toEqual([]);

      // The issue is reversed: a second return finds nothing to reverse.
      const again = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId: partId,
          locationId,
          trackedEntityId: replacementId,
          quantity: 1,
          direction: "Return"
        },
        postProjectIssue
      );
      expect(again.error?.status).toEqual(422);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "issuing TR-200 to a Refurbishment node capitalizes it to WIP, bills and installs nothing, and records it in the unit's build",
  async () => {
    const { f, order, partId, locationId, replacementId } =
      await serviceReplacementFixture();
    try {
      // The same order as a Refurbishment of a unit the company owns: no
      // customer, no asset.
      await f.db
        .updateTable("serviceOrder")
        .set({ type: "Refurbishment", customerId: null, customerAssetId: null })
        .where("id", "=", order.serviceOrderId)
        .where("companyId", "=", f.companyId)
        .execute();

      const issued = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId: partId,
          locationId,
          trackedEntityId: replacementId,
          quantity: 1,
          direction: "Issue"
        },
        postProjectIssue
      );
      expect(issued.error).toBeNull();

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", issued.data!.journalId!)
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("wip"), 40],
        [f.account("inventory"), -40]
      ]);
      const ledger = await f.db
        .selectFrom("projectLedger")
        .select("coverage")
        .where("id", "=", issued.data!.projectLedgerId!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(ledger.coverage).toEqual("Capitalized");

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(items).toEqual([]);
      // TR-100's component row is untouched and no new one is written.
      const components = await f.db
        .selectFrom("customerAssetComponent")
        .select(["trackedEntityId", "removedDate"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(components).toEqual([
        { trackedEntityId: `${f.prefix}-tr-100`, removedDate: null }
      ]);

      const activity = await f.db
        .selectFrom("trackedActivity")
        .innerJoin(
          "trackedActivityInput",
          "trackedActivityInput.trackedActivityId",
          "trackedActivity.id"
        )
        .innerJoin(
          "trackedActivityOutput",
          "trackedActivityOutput.trackedActivityId",
          "trackedActivity.id"
        )
        .select([
          "trackedActivity.type",
          "trackedActivity.sourceDocumentId",
          "trackedActivityInput.trackedEntityId as input",
          "trackedActivityOutput.trackedEntityId as output"
        ])
        .where("trackedActivity.companyId", "=", f.companyId)
        .execute();
      expect(activity).toEqual([
        {
          type: "Service",
          sourceDocumentId: order.serviceOrderId,
          input: replacementId,
          output: order.subjectSerialId
        }
      ]);

      // The return removes the activity and credits WIP back.
      const returned = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId: partId,
          locationId,
          trackedEntityId: replacementId,
          quantity: 1,
          direction: "Return"
        },
        postProjectIssue
      );
      expect(returned.error).toBeNull();
      const returnLines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", returned.data!.journalId!)
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        returnLines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("inventory"), 40],
        [f.account("wip"), -40]
      ]);
      const activities = await f.db
        .selectFrom("trackedActivity")
        .select("id")
        .where("type", "=", "Service")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(activities).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

// Project stock (Projects Phase 2a): a project with project stock draws its
// own stock first, then common stock, and is charged the sum.
databaseTest(
  "issuing to a project with project stock draws its stock, then common stock, and charges the sum",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.enableProjectStock();
      // 10 in common stock at 10.00, 4 in the project's stock at 12.00.
      const { itemId, locationId } = await f.addStockedItem("stripe", {
        quantity: 10,
        unitCost: 10
      });
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 4,
        unitCost: 12
      });

      const issued = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId,
          locationId,
          quantity: 6,
          direction: "Issue"
        },
        postProjectIssue
      );
      expect(issued.error).toBeNull();
      // 4 x 12.00 + 2 x 10.00
      expect(issued.data?.cost).toEqual(68);

      const rows = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Project Issue")
        .orderBy("quantity")
        .execute();
      expect(rows.map((row) => [Number(row.quantity), row.projectId])).toEqual([
        [-4, f.projectId],
        [-2, null]
      ]);

      const charges = await f.db
        .selectFrom("projectLedger")
        .select(["quantity", "amount"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        charges.map((row) => [Number(row.quantity), Number(row.amount)])
      ).toEqual([[6, 68]]);

      // One journal for both stripes.
      const journals = await f.db
        .selectFrom("journalLine")
        .select(["journalId", "accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Project Issue")
        .execute();
      expect(new Set(journals.map((line) => line.journalId)).size).toEqual(1);
      expect(
        journals
          .filter((line) => line.accountId === f.account("project-expense"))
          .reduce((sum, line) => sum + Number(line.amount), 0)
      ).toEqual(68);

      // A Return goes back to the project's stock.
      const returned = await invokePosting(
        handlesOf(f.ctx),
        "post-project-issue",
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId,
          locationId,
          quantity: 1,
          direction: "Return"
        },
        postProjectIssue
      );
      expect(returned.error).toBeNull();
      const back = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "projectId"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Project Issue")
        .where("quantity", ">", 0)
        .execute();
      expect(back.map((row) => [Number(row.quantity), row.projectId])).toEqual([
        [1, f.projectId]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Return is valued at the cost the issue charged, not the item's current cost",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      const { itemId, locationId } = await f.addStockedItem("shim", {
        quantity: 10,
        unitCost: 5
      });
      const post = (direction: "Issue" | "Return") =>
        invokePosting(
          handlesOf(f.ctx),
          "post-project-issue",
          {
            projectId: f.projectId,
            projectElementId: f.elementId,
            itemId,
            locationId,
            quantity: 10,
            direction
          },
          postProjectIssue
        );

      const issued = await post("Issue");
      expect(issued.error).toBeNull();
      expect(issued.data?.cost).toEqual(50);

      // The item's carrying cost moves on after the issue.
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: null,
        quantity: 10,
        unitCost: 8,
        postingDate: "2026-01-02"
      });

      const returned = await post("Return");
      expect(returned.error).toBeNull();
      expect(returned.data?.cost).toEqual(50);

      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", returned.data!.journalId!)
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("inventory"), 50],
        [f.account("project-wip"), -50]
      ]);

      const layer = await f.db
        .selectFrom("costLedger")
        .select(["quantity", "cost"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Project Issue")
        .where("quantity", ">", 0)
        .executeTakeFirstOrThrow();
      expect([Number(layer.quantity), Number(layer.cost)]).toEqual([10, 50]);

      const net = await f.db
        .selectFrom("projectLedger")
        .select((eb) => eb.fn.sum<string>("amount").as("amount"))
        .where("projectId", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(net.amount)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);
