// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL); skipped without one. With
// companySettings.holdUnitsWithOpenIssues on, a serial unit with an open
// quality issue is not received to stock when its job is completed: the other
// units are, and it follows once its issue is closed. A completion names no
// unit (a finish by hand, the ERP's Complete), so the receipt itself decides.

import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  stockPart,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";

async function completeToInventory(
  f: Fixture,
  jobId: string,
  quantityComplete: number
) {
  await sql`
    SELECT complete_job_to_inventory(
      p_job_id := ${jobId},
      p_quantity_complete := ${quantityComplete}::numeric,
      p_company_id := ${f.companyId},
      p_user_id := ${USER}
    )
  `.execute(f.db);
}

/**
 * A job of serial units SN-001…, each its own row and Available, as after an
 * earlier operation: the receipt ranks them by serial number alone.
 */
async function serialJob(f: Fixture, quantity: number) {
  const job = await jobFixture(f, "hold");
  const makeMethod = await f.db
    .selectFrom("jobMakeMethod")
    .select("id")
    .where("jobId", "=", job.jobId)
    .where("parentMaterialId", "is", null)
    .executeTakeFirstOrThrow();
  await seed(f, async (trx) => {
    await trx
      .updateTable("item")
      .set({ itemTrackingType: "Serial" })
      .where("id", "=", f.assemblyId)
      .execute();
    await trx
      .updateTable("job")
      .set({ status: "In Progress", quantity })
      .where("id", "=", job.jobId)
      .execute();
    await trx
      .updateTable("jobMakeMethod")
      .set({ requiresSerialTracking: true })
      .where("id", "=", makeMethod.id)
      .execute();
    await trx
      .deleteFrom("trackedEntity")
      .where("companyId", "=", f.companyId)
      .where(sql<boolean>`attributes->>'Job Make Method' = ${makeMethod.id}`)
      .execute();
    await trx
      .insertInto("trackedEntity")
      .values(
        Array.from({ length: quantity }, (_, index) => ({
          id: `${f.prefix}-unit-${index + 1}`,
          readableId: `SN-00${index + 1}`,
          quantity: 1,
          status: "Available" as const,
          sourceDocument: "Job",
          sourceDocumentId: job.jobId,
          sourceDocumentReadableId: "J-hold",
          itemId: f.assemblyId,
          attributes: { Job: job.jobId, "Job Make Method": makeMethod.id },
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return job;
}

async function holdUnits(f: Fixture, on: boolean) {
  await seed(f, async (trx) => {
    await trx
      .updateTable("companySettings")
      .set({ holdUnitsWithOpenIssues: on })
      .where("id", "=", f.companyId)
      .execute();
  });
}

/** An open issue linked to unit `number` (SN-00<number>). */
async function raiseIssue(f: Fixture, number: number) {
  const issueId = `${f.prefix}-issue-${number}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("nonConformanceType")
      .values({
        id: `${f.prefix}-issue-type-${number}`,
        name: `Defect ${number}`,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("nonConformance")
      .values({
        id: issueId,
        nonConformanceId: `NCR-${number}`,
        name: "Cracked housing",
        source: "Internal",
        locationId: f.locationId,
        nonConformanceTypeId: `${f.prefix}-issue-type-${number}`,
        openDate: "2026-11-23",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("nonConformanceTrackedEntity")
      .values({
        nonConformanceId: issueId,
        trackedEntityId: `${f.prefix}-unit-${number}`,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return issueId;
}

async function closeIssue(f: Fixture, issueId: string) {
  await seed(f, async (trx) => {
    await trx
      .updateTable("nonConformance")
      .set({ status: "Closed" })
      .where("id", "=", issueId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
}

/** The serial numbers this job received to stock, in order. */
async function received(f: Fixture, jobId: string) {
  const rows = await f.db
    .selectFrom("itemLedger")
    .innerJoin("trackedEntity", "trackedEntity.id", "itemLedger.trackedEntityId")
    .select("trackedEntity.readableId")
    .where("itemLedger.companyId", "=", f.companyId)
    .where("itemLedger.documentType", "=", "Job Receipt")
    .where("itemLedger.documentId", "=", jobId)
    .orderBy("trackedEntity.readableId")
    .execute();
  return rows.map((row) => row.readableId);
}

async function jobQuantities(f: Fixture, jobId: string) {
  const job = await f.db
    .selectFrom("job")
    .select(["status", "quantityComplete", "quantityReceivedToInventory"])
    .where("id", "=", jobId)
    .executeTakeFirstOrThrow();
  return {
    status: job.status,
    quantityComplete: Number(job.quantityComplete),
    quantityReceivedToInventory: Number(job.quantityReceivedToInventory)
  };
}

describe.skipIf(!hasLocalDatabase)("job receipt with a unit on hold", () => {
  it("receives the finished units and leaves the unit on hold out", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      const job = await serialJob(f, 4);
      await holdUnits(f, true);
      // The lowest serial number: by number alone it would be received first.
      await raiseIssue(f, 1);

      // Three units finished; the last operation was finished by hand.
      await completeToInventory(f, job.jobId, 3);

      expect(await received(f, job.jobId)).toEqual([
        "SN-002",
        "SN-003",
        "SN-004"
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("stops a completion of every unit short of the unit on hold, then receives it once its issue is closed", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      const job = await serialJob(f, 4);
      await holdUnits(f, true);
      const issueId = await raiseIssue(f, 2);

      await completeToInventory(f, job.jobId, 4);
      expect(await received(f, job.jobId)).toEqual([
        "SN-001",
        "SN-003",
        "SN-004"
      ]);
      expect(await jobQuantities(f, job.jobId)).toEqual({
        status: "Completed",
        quantityComplete: 3,
        quantityReceivedToInventory: 3
      });

      await closeIssue(f, issueId);
      await completeToInventory(f, job.jobId, 4);
      expect(await received(f, job.jobId)).toEqual([
        "SN-001",
        "SN-002",
        "SN-003",
        "SN-004"
      ]);
      expect(await jobQuantities(f, job.jobId)).toEqual({
        status: "Completed",
        quantityComplete: 4,
        quantityReceivedToInventory: 4
      });
    } finally {
      await f.cleanup();
    }
  });

  it("refuses a completion when every unit left is on hold", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      const job = await serialJob(f, 1);
      await holdUnits(f, true);
      await raiseIssue(f, 1);

      await expect(completeToInventory(f, job.jobId, 1)).rejects.toThrow(
        /on hold for an open quality issue/
      );
      expect(await received(f, job.jobId)).toEqual([]);
      expect((await jobQuantities(f, job.jobId)).status).toBe("In Progress");
    } finally {
      await f.cleanup();
    }
  });

  it("receives by serial number as before when the company does not hold units", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      const job = await serialJob(f, 4);
      await raiseIssue(f, 1);

      await completeToInventory(f, job.jobId, 3);

      expect(await received(f, job.jobId)).toEqual([
        "SN-001",
        "SN-002",
        "SN-003"
      ]);
    } finally {
      await f.cleanup();
    }
  });
});
