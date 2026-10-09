// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import postProjectIssue from "./index";

databaseTest(
  "issuing stock to an Expense project relieves FIFO cost to the project, and a return reverses it at current cost",
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

      const issued = await postProjectIssue(f.ctx, {
        projectId: f.projectId,
        projectElementId: f.elementId,
        itemId,
        locationId,
        quantity: 5,
        direction: "Issue"
      });
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

      const returned = await postProjectIssue(f.ctx, {
        projectId: f.projectId,
        projectElementId: f.elementId,
        itemId,
        locationId,
        quantity: 2,
        direction: "Return"
      });
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

      // More than is on hand is refused.
      const tooMany = await postProjectIssue(f.ctx, {
        projectId: f.projectId,
        itemId,
        locationId,
        quantity: 100,
        direction: "Issue"
      });
      expect(tooMany.error?.status).toEqual(400);
    } finally {
      await f.cleanup();
    }
  }
);
