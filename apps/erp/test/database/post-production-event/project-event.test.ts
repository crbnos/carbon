// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { postProductionEvent as postProductionEventBody } from "../../../app/modules/production/production.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectPostingFixture } from "../fixtures/project-posting";

type Ctx = Parameters<typeof handlesOf>[0];

const postProductionEvent = (
  ctx: Ctx,
  input: Parameters<typeof postProductionEventBody>[1]
) =>
  invokePosting(
    handlesOf(ctx),
    "post-production-event",
    input,
    postProductionEventBody
  );

databaseTest(
  "labor on a consume-to-project job posts to the project, and a repost reverses the prior ledger row",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { itemId, locationId } = await f.addStockedItem("bolt", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("a", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 1,
        jobQuantity: 1
      });
      const event = await f.db
        .insertInto("productionEvent")
        .values({
          jobOperationId: job.operationId,
          type: "Labor",
          startTime: "2026-10-05T08:00:00Z",
          endTime: "2026-10-05T10:00:00Z",
          employeeId: "system",
          workCenterId: job.workCenterId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const first = await postProductionEvent(f.ctx, {
        productionEventId: event.id
      });
      expect(first.data?.success).toBe(true);

      const projectLines = () =>
        f.db
          .selectFrom("journalLine")
          .select(["id", "accountId", "amount"])
          .where("companyId", "=", f.companyId)
          .where("documentType", "=", "Production Event")
          .where("accountId", "=", f.account("project-expense"))
          .execute();
      const afterFirst = await projectLines();
      expect(afterFirst.map((line) => Number(line.amount))).toEqual([100]);
      const wipLines = await f.db
        .selectFrom("journalLine")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("accountId", "=", f.account("wip"))
        .execute();
      expect(wipLines).toEqual([]);
      const tags = await f.db
        .selectFrom("journalLineDimension")
        .select("valueId")
        .where("journalLineId", "=", afterFirst[0]!.id)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(tags.map((tag) => tag.valueId)).toEqual(
        expect.arrayContaining([f.projectId, f.elementId])
      );

      await f.db
        .updateTable("productionEvent")
        .set({ endTime: "2026-10-05T11:00:00Z" })
        .where("id", "=", event.id)
        .where("companyId", "=", f.companyId)
        .execute();
      const second = await postProductionEvent(f.ctx, {
        productionEventId: event.id
      });
      expect(second.data?.success).toBe(true);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select([
          "id",
          "costType",
          "documentType",
          "documentId",
          "quantity",
          "amount",
          "reversalOfId",
          "journalLineId"
        ])
        .where("companyId", "=", f.companyId)
        .orderBy("createdAt")
        .orderBy("amount", "desc")
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          row.documentType,
          row.documentId,
          Number(row.quantity),
          Number(row.amount)
        ])
      ).toEqual([
        ["Labor", "Production Event", event.id, 2, 100],
        ["Labor", "Production Event", event.id, 3, 150],
        ["Labor", "Production Event", event.id, -2, -100]
      ]);
      expect(ledger[0]!.journalLineId).toEqual(afterFirst[0]!.id);
      expect(ledger[2]!.reversalOfId).toEqual(ledger[0]!.id);
      // The reversal row names the repost's reversal line on the project
      // account (−100), so the revenue run can relieve it.
      const reversalLine = (await projectLines()).find(
        (line) => line.id === ledger[2]!.journalLineId
      );
      expect(Number(reversalLine?.amount)).toEqual(-100);

      const netProject = (await projectLines()).reduce(
        (sum, line) => sum + Number(line.amount),
        0
      );
      expect(netProject).toEqual(150);

      // Reversing the event (before a delete) nets the project to zero.
      const reversed = await postProductionEvent(f.ctx, {
        productionEventId: event.id,
        reverse: true
      });
      expect(reversed.data?.success).toBe(true);
      const total = await f.db
        .selectFrom("projectLedger")
        .select((eb) => eb.fn.sum<number>("amount").as("amount"))
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(total.amount)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);
