// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
