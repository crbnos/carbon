// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { postProductionEvent as postProductionEventBody } from "../../../app/modules/production/production.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import {
  PROJECT_TEST_USER,
  projectPostingFixture
} from "../fixtures/project-posting";

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

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;

/** One hour of Labor by `system` on a consume-to-project job, with the
 *  employee's job at the job's location in `laborCategoryId`. */
async function shopHour(
  f: Fixture,
  options: { laborCategoryId: string | null }
) {
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
  await f.db
    .insertInto("employeeJob")
    .values({
      id: PROJECT_TEST_USER,
      companyId: f.companyId,
      locationId,
      laborCategoryId: options.laborCategoryId
    })
    .execute();
  const event = await f.db
    .insertInto("productionEvent")
    .values({
      jobOperationId: job.operationId,
      type: "Labor",
      // 23:30 to 00:30 UTC: the work began on 2026-10-05 in New York.
      startTime: "2026-10-05T23:30:00Z",
      endTime: "2026-10-06T00:30:00Z",
      employeeId: PROJECT_TEST_USER,
      workCenterId: job.workCenterId,
      companyId: f.companyId,
      createdBy: PROJECT_TEST_USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { itemId, locationId, job, eventId: event.id };
}

databaseTest(
  "shop labor carries the employee's labor category on its Labor ledger row",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { eventId } = await shopHour(f, {
        laborCategoryId: f.laborCategoryId
      });
      const result = await postProductionEvent(f.ctx, {
        productionEventId: eventId
      });
      expect(result.data?.success).toBe(true);

      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["costType", "laborCategoryId", "quantity", "amount"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          row.laborCategoryId,
          Number(row.quantity),
          Number(row.amount)
        ])
      ).toEqual([["Labor", f.laborCategoryId, 1, 50]]);
      // Standard timekeeping writes no timesheet entry.
      const entries = await f.db
        .selectFrom("timesheetEntry")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(entries).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "shop labor under a Time & Materials line bills at the labor category's bill rate",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      const { itemId, eventId } = await shopHour(f, {
        laborCategoryId: f.laborCategoryId
      });
      const customerId = `${f.prefix}-customer`;
      const contractId = `${f.prefix}-contract`;
      await f.db
        .updateTable("laborCategoryRate")
        .set({ billRate: 150 })
        .where("laborCategoryId", "=", f.laborCategoryId)
        .where("companyId", "=", f.companyId)
        .execute();
      await f.db
        .insertInto("customer")
        .values({ id: customerId, name: f.prefix, companyId: f.companyId })
        .execute();
      await f.db
        .insertInto("customerContract")
        .values({
          id: contractId,
          customerContractId: "CON-TM",
          name: "T&M",
          customerId,
          status: "Active",
          closeDate: "2026-01-01",
          startDate: "2026-01-01",
          currencyCode: "USD",
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .execute();
      await f.db
        .insertInto("customerContractLine")
        .values({
          id: `${contractId}-line`,
          customerContractId: contractId,
          revenueType: "One-time",
          itemId,
          description: "Engineering T&M",
          quantity: 1,
          rate: 0,
          startDate: "2026-01-01",
          billingMethod: "Time & Materials",
          revenueMethod: "Right to Invoice",
          projectId: f.projectId,
          projectElementId: f.elementId,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .execute();

      const result = await postProductionEvent(f.ctx, {
        productionEventId: eventId
      });
      expect(result.data?.success).toBe(true);

      const items = await f.db
        .selectFrom("projectBillableItem")
        .select(["quantity", "unitPrice", "amount", "status", "statusReason"])
        .where("projectId", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        items.map((item) => [
          Number(item.quantity),
          Number(item.unitPrice),
          Number(item.amount),
          item.status,
          item.statusReason
        ])
      ).toEqual([[1, 150, 150, "Unbilled", null]]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA: shop labor writes a Draft timesheet entry with the job, and its overhead posts as before",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.db
        .updateTable("companySettings")
        .set({ timekeepingControls: "DCAA" })
        .where("id", "=", f.companyId)
        .execute();
      const { job, eventId } = await shopHour(f, {
        laborCategoryId: f.laborCategoryId
      });
      await f.db
        .updateTable("workCenter")
        .set({ overheadRate: 10 })
        .where("id", "=", job.workCenterId)
        .where("companyId", "=", f.companyId)
        .execute();

      const result = await postProductionEvent(f.ctx, {
        productionEventId: eventId
      });
      expect(result.error).toBeNull();
      expect(result.data?.success).toBe(true);

      // No Labor ledger row and no labor journal pair: only the overhead.
      const ledger = await f.db
        .selectFrom("projectLedger")
        .select(["costType", "quantity", "amount"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        ledger.map((row) => [
          row.costType,
          Number(row.quantity),
          Number(row.amount)
        ])
      ).toEqual([["Overhead", 1, 10]]);
      const lines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        lines.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("project-expense"), 10],
        [f.account("overhead-absorption"), -10]
      ]);

      // One Draft entry on the event's day in New York, for the employee to
      // certify with the week.
      const entries = await f.db
        .selectFrom("timesheetEntry")
        .select([
          "employeeId",
          "entryDate",
          "projectId",
          "projectElementId",
          "laborCategoryId",
          "jobId",
          "jobOperationId",
          "productionEventId",
          "hours",
          "status"
        ])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        entries.map((entry) => ({ ...entry, hours: Number(entry.hours) }))
      ).toEqual([
        {
          employeeId: PROJECT_TEST_USER,
          entryDate: "2026-10-05",
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          jobId: job.jobId,
          jobOperationId: job.operationId,
          productionEventId: eventId,
          hours: 1,
          status: "Draft"
        }
      ]);
      const event = await f.db
        .selectFrom("productionEvent")
        .select("postedToGL")
        .where("id", "=", eventId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(event.postedToGL).toBe(true);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA: shop labor by a person with no labor category is refused",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.db
        .updateTable("companySettings")
        .set({ timekeepingControls: "DCAA" })
        .where("id", "=", f.companyId)
        .execute();
      const { eventId } = await shopHour(f, { laborCategoryId: null });

      const result = await postProductionEvent(f.ctx, {
        productionEventId: eventId
      });
      expect(result.error?.message).toEqual(
        "Set a labor category on this person before they record project time"
      );
      const written = await f.db
        .selectFrom("timesheetEntry")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(written).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

/** The event's timesheet entries: [hours, status], oldest first. */
async function eventEntries(f: Fixture, eventId: string) {
  const rows = await f.db
    .selectFrom("timesheetEntry")
    .select(["hours", "status"])
    .where("productionEventId", "=", eventId)
    .where("companyId", "=", f.companyId)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  return rows.map((row) => [Number(row.hours), row.status]);
}

async function setEventEnd(f: Fixture, eventId: string, endTime: string) {
  await f.db
    .updateTable("productionEvent")
    .set({ endTime })
    .where("id", "=", eventId)
    .where("companyId", "=", f.companyId)
    .execute();
}

databaseTest(
  "DCAA: an edit of the event updates its Draft entry, and a reversal removes it",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.db
        .updateTable("companySettings")
        .set({ timekeepingControls: "DCAA" })
        .where("id", "=", f.companyId)
        .execute();
      const { eventId } = await shopHour(f, {
        laborCategoryId: f.laborCategoryId
      });
      const post = (reverse?: boolean) =>
        postProductionEvent(f.ctx, { productionEventId: eventId, reverse });

      expect((await post()).data?.success).toBe(true);
      expect(await eventEntries(f, eventId)).toEqual([[1, "Draft"]]);

      // Two hours instead of one: the same entry, re-posted.
      await setEventEnd(f, eventId, "2026-10-06T01:30:00Z");
      expect((await post()).data?.success).toBe(true);
      expect(await eventEntries(f, eventId)).toEqual([[2, "Draft"]]);

      // Deleting the event reverses it first: the entry goes.
      expect((await post(true)).data?.success).toBe(true);
      expect(await eventEntries(f, eventId)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA: an edit of submitted hours is refused until the timesheet is corrected",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      await f.db
        .updateTable("companySettings")
        .set({ timekeepingControls: "DCAA" })
        .where("id", "=", f.companyId)
        .execute();
      const { eventId } = await shopHour(f, {
        laborCategoryId: f.laborCategoryId
      });
      expect(
        (await postProductionEvent(f.ctx, { productionEventId: eventId })).data
          ?.success
      ).toBe(true);
      const entry = await f.db
        .updateTable("timesheetEntry")
        .set({ status: "Posted" })
        .where("productionEventId", "=", eventId)
        .where("companyId", "=", f.companyId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await setEventEnd(f, eventId, "2026-10-06T01:30:00Z");
      const refused = await postProductionEvent(f.ctx, {
        productionEventId: eventId
      });
      expect(refused.error?.message).toEqual(
        "These hours are on a submitted timesheet. Correct the timesheet entry to 2 hours first."
      );
      expect(await eventEntries(f, eventId)).toEqual([[1, "Posted"]]);

      // The correction createTimesheetCorrection writes (a reversal and a
      // replacement, both carrying the link): the event then posts.
      const { id: _id, createdAt: _createdAt, ...copy } = entry;
      await f.db
        .insertInto("timesheetEntry")
        .values([
          {
            ...copy,
            hours: -1,
            status: "Submitted",
            reversalOfId: entry.id,
            correctionReason: "Two hours, not one"
          },
          {
            ...copy,
            hours: 2,
            status: "Submitted",
            correctionOfId: entry.id,
            correctionReason: "Two hours, not one"
          }
        ])
        .execute();
      const posted = await postProductionEvent(f.ctx, {
        productionEventId: eventId
      });
      expect(posted.error).toBeNull();
      expect(posted.data?.success).toBe(true);
      // The correction pair shares one createdAt: compare the hours sorted.
      expect(
        (await eventEntries(f, eventId))
          .map(([hours]) => Number(hours))
          .sort((a, b) => a - b)
      ).toEqual([-1, 1, 2]);
    } finally {
      await f.cleanup();
    }
  }
);
