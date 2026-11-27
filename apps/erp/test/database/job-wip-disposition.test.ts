// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { expect } from "vitest";
import { assignSerialNumbers } from "../../app/modules/production/production.service";
import {
  createIssueAssociation,
  deleteIssue
} from "../../app/modules/quality/quality.server";
import {
  closeIssue,
  deleteIssueAssociation,
  linkJobOperationLot
} from "../../app/modules/quality/quality.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { systemServiceOf } from "./fixtures/handles";
import {
  holdUnits,
  raiseIssueOnUnit,
  serialJob
} from "./fixtures/job-unit-hold";
import { operationContext, postgrestTest } from "./fixtures/local-supabase";

/** Puts the unit on a disposition row of the issue, and starts the issue. */
async function addDisposition(
  f: Fixture,
  issue: string,
  unit: string,
  disposition: "Scrap" | "Return to Supplier" | "Use As Is"
) {
  await seed(f, async (trx) => {
    await trx
      .updateTable("nonConformance")
      .set({ status: "In Progress" })
      .where("id", "=", issue)
      .where("companyId", "=", f.companyId)
      .execute();
    const row = await trx
      .insertInto("nonConformanceItem")
      .values({
        nonConformanceId: issue,
        itemId: f.assemblyId,
        quantity: 1,
        disposition,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("nonConformanceItemTrackedEntity")
      .values({
        nonConformanceId: issue,
        trackedEntityId: unit,
        nonConformanceItemId: row.id,
        quantity: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
}

function close(
  f: Fixture,
  client: SupabaseClient<Database>,
  nonConformanceId: string
) {
  return closeIssue(client, f.db, {
    nonConformanceId,
    companyId: f.companyId,
    userId: USER
  });
}

async function statusOf(f: Fixture, unit: string) {
  const row = await f.db
    .selectFrom("trackedEntity")
    .select("status")
    .where("id", "=", unit)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return row.status;
}

async function reject(
  f: Fixture,
  client: SupabaseClient<Database>,
  unit: string,
  issueNumber: number,
  disposition: "Scrap" | "Return to Supplier"
) {
  const issue = await raiseIssueOnUnit(f, unit, issueNumber);
  await addDisposition(f, issue, unit, disposition);
  expect((await close(f, client, issue)).error).toBeNull();
  expect(await statusOf(f, unit)).toBe("Rejected");
}

/** A received, Rejected serial of the job's item: in stock, so not job WIP. */
async function rejectedStockedSerial(f: Fixture) {
  await serialJob(f, 1);
  const unit = `${f.prefix}-unit-1`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("itemLedger")
      .values({
        entryType: "Positive Adjmt.",
        itemId: f.assemblyId,
        locationId: f.locationId,
        trackedEntityId: unit,
        quantity: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("trackedEntity")
      .set({ status: "Rejected" })
      .where("id", "=", unit)
      .where("companyId", "=", f.companyId)
      .execute();
  });
  return unit;
}

postgrestTest(
  "an issue on a serial outside the first page of job output links only that serial",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      const job = await serialJob(f, 1001);
      const page = await client
        .from("trackedEntity")
        .select("id, quantity")
        .eq("attributes->>Job Make Method", job.makeMethodId)
        .eq("companyId", f.companyId)
        .limit(1000)
        .throwOnError();
      expect(page.data).toHaveLength(1000);
      const paged = new Set(page.data.map((unit) => unit.id));
      const selected = Array.from(
        { length: 1001 },
        (_, n) => `${f.prefix}-unit-${n + 1}`
      ).find((id) => !paged.has(id))!;
      const issue = await raiseIssueOnUnit(f, selected, 1);
      await linkJobOperationLot(operationContext(f, client, USER), {
        nonConformanceId: issue,
        jobOperationId: job.operationId,
        trackedEntityIds: [selected]
      });
      for (const table of [
        "nonConformanceTrackedEntity",
        "nonConformanceItemTrackedEntity"
      ] as const) {
        const links = await f.db
          .selectFrom(table)
          .select("trackedEntityId")
          .where("companyId", "=", f.companyId)
          .where("nonConformanceId", "=", issue)
          .execute();
        expect(links).toEqual([{ trackedEntityId: selected }]);
      }
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "attaching an operation to an existing issue holds all 1,001 output serials",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await holdUnits(f, true);
      const job = await serialJob(f, 1001);
      const issue = await raiseIssueOnUnit(f, `${f.prefix}-unit-1`, 1);
      await f.db
        .deleteFrom("nonConformanceTrackedEntity")
        .where("nonConformanceId", "=", issue)
        .where("companyId", "=", f.companyId)
        .execute();

      const attached = await createIssueAssociation(
        operationContext(f, client, USER),
        {
          nonConformanceId: issue,
          type: "jobOperations",
          id: job.jobId,
          lineId: job.operationId
        }
      );
      expect(attached.error).toBeNull();
      const held = await f.db
        .selectFrom("unitQualityHold")
        .select("trackedEntityId")
        .where("issueId", "=", issue)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(held).toHaveLength(1001);
      expect(new Set(held.map((row) => row.trackedEntityId))).toEqual(
        new Set(
          Array.from({ length: 1001 }, (_, n) => `${f.prefix}-unit-${n + 1}`)
        )
      );
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "an issue naming only a component links the whole operation output for disposition",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      const job = await serialJob(f, 3);
      const component = await f.db
        .insertInto("trackedEntity")
        .values({
          itemId: f.partId,
          quantity: 1,
          companyId: f.companyId,
          createdBy: USER,
          sourceDocument: "Item",
          sourceDocumentId: f.partId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const issue = await raiseIssueOnUnit(f, component.id, 1);
      await linkJobOperationLot(operationContext(f, client, USER), {
        nonConformanceId: issue,
        jobOperationId: job.operationId,
        trackedEntityIds: [component.id]
      });
      const links = await f.db
        .selectFrom("nonConformanceItemTrackedEntity")
        .select("trackedEntityId")
        .where("companyId", "=", f.companyId)
        .where("nonConformanceId", "=", issue)
        .orderBy("trackedEntityId")
        .execute();
      expect(links.map((link) => link.trackedEntityId)).toEqual(
        [1, 2, 3].map((n) => `${f.prefix}-unit-${n}`)
      );
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "the last issue to close releases a stocked serial that an earlier close accepted",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await holdUnits(f, true);
      const unit = await rejectedStockedSerial(f);
      const accepting = await raiseIssueOnUnit(f, unit, 1);
      await addDisposition(f, accepting, unit, "Use As Is");
      const headerOnly = [
        await raiseIssueOnUnit(f, unit, 2),
        await raiseIssueOnUnit(f, unit, 3)
      ];

      // The open issues keep the unit in stock held.
      expect((await close(f, client, accepting)).error).toBeNull();
      expect(await statusOf(f, unit)).toBe("Rejected");
      expect((await close(f, client, headerOnly[0])).error).toBeNull();
      expect(await statusOf(f, unit)).toBe("Rejected");
      // The last one names the unit only at its header and still releases it.
      expect((await close(f, client, headerOnly[1])).error).toBeNull();
      expect(await statusOf(f, unit)).toBe("Available");
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "unlinking a stocked serial releases its earlier acceptance only after the last association is gone",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await holdUnits(f, true);
      const unit = await rejectedStockedSerial(f);
      const accepting = await raiseIssueOnUnit(f, unit, 1);
      await addDisposition(f, accepting, unit, "Use As Is");
      const other = await raiseIssueOnUnit(f, unit, 2);
      await addDisposition(f, other, unit, "Scrap");
      expect((await close(f, client, accepting)).error).toBeNull();
      expect(await statusOf(f, unit)).toBe("Rejected");
      const ctx = systemServiceOf(f.ctx, f.groupId);
      for (const [type, table, expected] of [
        ["items", "nonConformanceItem", "Rejected"],
        ["trackedEntities", "nonConformanceTrackedEntity", "Available"]
      ] as const) {
        const link = await f.db
          .selectFrom(table)
          .select("id")
          .where("nonConformanceId", "=", other)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow();
        expect(
          (await deleteIssueAssociation(ctx, type, link.id)).error
        ).toBeNull();
        expect(await statusOf(f, unit)).toBe(expected);
      }
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "deleting the last holding issue releases a stocked serial accepted by an earlier issue",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await holdUnits(f, true);
      const unit = await rejectedStockedSerial(f);
      const accepting = await raiseIssueOnUnit(f, unit, 1);
      await addDisposition(f, accepting, unit, "Use As Is");
      const holding = await raiseIssueOnUnit(f, unit, 2);

      expect((await close(f, client, accepting)).error).toBeNull();
      expect(await statusOf(f, unit)).toBe("Rejected");
      const deleted = await deleteIssue(operationContext(f, client, USER), {
        nonConformanceId: holding
      });
      expect(deleted.error).toBeNull();
      expect(await statusOf(f, unit)).toBe("Available");
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "an issue raised after a serial's release leaves it held when the serial was rejected again",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await holdUnits(f, true);
      const unit = await rejectedStockedSerial(f);
      const accepting = await raiseIssueOnUnit(f, unit, 1);
      await addDisposition(f, accepting, unit, "Use As Is");
      expect((await close(f, client, accepting)).error).toBeNull();
      expect(await statusOf(f, unit)).toBe("Available");

      // Shipped and returned: the return holds it, not the earlier acceptance.
      await seed(f, async (trx) => {
        await trx
          .insertInto("itemLedger")
          .values(
            [-1, 1].map((quantity) => ({
              entryType:
                quantity < 0
                  ? ("Negative Adjmt." as const)
                  : ("Positive Adjmt." as const),
              itemId: f.assemblyId,
              locationId: f.locationId,
              trackedEntityId: unit,
              quantity,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ status: "Rejected" })
          .where("id", "=", unit)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      const later = await raiseIssueOnUnit(f, unit, 2);
      expect((await close(f, client, later)).error).toBeNull();
      expect(await statusOf(f, unit)).toBe("Rejected");
    } finally {
      await f.cleanup();
    }
  }
);

for (const disposition of ["Scrap", "Return to Supplier"] as const) {
  for (const holdsEnabled of [false, true]) {
    postgrestTest(
      `${disposition} on real job WIP and stocked output, holds ${holdsEnabled}`,
      async (client) => {
        const f = await alwaysPostFixture();
        try {
          await holdUnits(f, holdsEnabled);
          await seed(f, async (trx) => {
            await trx
              .updateTable("item")
              .set({ itemTrackingType: "Serial" })
              .where("id", "=", f.assemblyId)
              .where("companyId", "=", f.companyId)
              .execute();
            await trx
              .insertInto("itemSerialSequence")
              .values({
                itemId: f.assemblyId,
                next: 0,
                size: 3,
                step: 1,
                prefix: "SN-",
                suffix: "",
                serialNumberTiming: "jobCreation",
                companyId: f.companyId,
                createdBy: USER
              })
              .execute();
          });
          const job = await jobFixture(f, "wip", 2);
          expect(
            await assignSerialNumbers(systemServiceOf(f.ctx, f.groupId), {
              jobId: job.jobId,
              at: "jobCreation"
            })
          ).toEqual({ assigned: 2 });
          const units = await f.db
            .selectFrom("trackedEntity")
            .select(["id", "sourceDocument", "sourceDocumentId", "attributes"])
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", f.assemblyId)
            .orderBy("readableId")
            .execute();
          expect(units).toHaveLength(2);
          const [bad, good] = units;
          expect(bad.sourceDocument).toBe("Item");
          await reject(f, client, bad.id, 1, disposition);

          const replacement = await f.db
            .insertInto("trackedEntity")
            .values({
              sourceDocument: good.sourceDocument,
              sourceDocumentId: good.sourceDocumentId,
              itemId: f.assemblyId,
              attributes: good.attributes,
              readableId: "SN-003",
              status: "Reserved",
              quantity: 1,
              companyId: f.companyId,
              createdBy: USER
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await sql`select complete_job_to_inventory(p_job_id := ${job.jobId},
          p_quantity_complete := 2, p_company_id := ${f.companyId}, p_user_id := ${USER})`.execute(
            f.db
          );
          const movements = () =>
            f.db
              .selectFrom("itemLedger")
              .select(["trackedEntityId", "quantity"])
              .where("companyId", "=", f.companyId)
              .where("itemId", "=", f.assemblyId)
              .execute();
          const receipts = await movements();
          expect(receipts).toEqual(
            expect.arrayContaining([
              { trackedEntityId: good.id, quantity: 1 },
              { trackedEntityId: replacement.id, quantity: 1 }
            ])
          );
          expect(
            receipts.filter((row) => row.trackedEntityId === bad.id)
          ).toEqual([]);
          expect(
            receipts.reduce((sum, row) => sum + Number(row.quantity), 0)
          ).toBe(2);

          // The same disposition of a received job serial must relieve its stock once.
          await reject(f, client, good.id, 2, disposition);
          const after = await movements();
          expect(
            after
              .filter((row) => row.trackedEntityId === good.id)
              .map((row) => row.quantity)
              .sort()
          ).toEqual([-1, 1]);
          expect(
            after.reduce((sum, row) => sum + Number(row.quantity), 0)
          ).toBe(1);
        } finally {
          await f.cleanup();
        }
      }
    );
  }
}
