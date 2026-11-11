// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL); skipped without one. The
// Complete dialog decides from getJobReceiptSnapshot which units a completion
// receives, so the snapshot must agree with complete_job_to_inventory.

import { sql } from "kysely";
import { expect } from "vitest";
import { getJobReceiptSnapshot } from "../../app/modules/production/production.service";
import { getSerialCompleteChoice } from "../../app/modules/production/ui/Jobs/job-complete-logic";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  stockPart,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

/** A Ready serial job with one numbered single unit per serial. */
async function numberedSerialJob(f: Fixture, key: string, serials: string[]) {
  const job = await jobFixture(f, key);
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
      .set({ status: "Ready", quantity: serials.length })
      .where("id", "=", job.jobId)
      .execute();
    await trx
      .updateTable("jobMakeMethod")
      .set({ requiresSerialTracking: true })
      .where("id", "=", makeMethod.id)
      .execute();
    await trx
      .updateTable("jobOperation")
      .set({ status: "Ready", operationQuantity: serials.length })
      .where("id", "=", job.operationId)
      .execute();
    await trx
      .deleteFrom("trackedEntity")
      .where("companyId", "=", f.companyId)
      .where(sql<boolean>`attributes->>'Job Make Method' = ${makeMethod.id}`)
      .execute();
    await trx
      .insertInto("trackedEntity")
      .values(
        serials.map((readableId) => ({
          readableId,
          quantity: 1,
          status: "Reserved" as const,
          sourceDocument: "Job",
          sourceDocumentId: job.jobId,
          sourceDocumentReadableId: `J-${key}`,
          itemId: f.assemblyId,
          attributes: { Job: job.jobId, "Job Make Method": makeMethod.id },
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return { ...job, makeMethodId: makeMethod.id };
}

async function units(f: Fixture, makeMethodId: string) {
  return f.db
    .selectFrom("trackedEntity")
    .select(["id", "readableId", "quantity", "status", "createdAt"])
    .where("companyId", "=", f.companyId)
    .where(sql<boolean>`attributes->>'Job Make Method' = ${makeMethodId}`)
    .orderBy("readableId")
    .execute();
}

async function receivedSerials(f: Fixture, jobId: string) {
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

/** What the dialog decides from the snapshot and the job's units. */
async function dialogChoice(
  f: Fixture,
  job: { jobId: string; makeMethodId: string },
  jobQuantity: number
) {
  const snapshot = await getJobReceiptSnapshot(f.db, job.jobId, f.companyId);
  const trackedEntities = (await units(f, job.makeMethodId)).map((unit) => ({
    ...unit,
    quantity: Number(unit.quantity),
    createdAt: String(unit.createdAt)
  }));
  return {
    snapshot,
    choice: getSerialCompleteChoice({
      trackedEntities,
      receivedEntityIds: new Set(snapshot?.trackedEntityIds),
      issuedEntityIds: new Set(snapshot?.issuedTrackedEntityIds),
      hasSerialSequence: false,
      jobQuantity
    })
  };
}

databaseTest(
  "offers a unit issued before receipt, and the completion receives what the dialog offers",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      const job = await numberedSerialJob(f, "issued", [
        "SN-001",
        "SN-002",
        "SN-003",
        "SN-004"
      ]);
      const [issued, neverLeftStock] = await units(f, job.makeMethodId);

      await seed(f, async (trx) => {
        // SN-001 was finished, then issued into another job: Consumed and
        // booked out of stock, as the MES issue writes it.
        await trx
          .updateTable("trackedEntity")
          .set({ status: "Consumed" })
          .where("id", "in", [issued!.id, neverLeftStock!.id])
          .execute();
        await trx
          .insertInto("itemLedger")
          .values({
            entryType: "Consumption",
            documentType: "Job Consumption",
            documentId: `${f.prefix}-parent-job`,
            itemId: f.assemblyId,
            quantity: -1,
            locationId: f.locationId,
            trackedEntityId: issued!.id,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const before = await dialogChoice(f, job, 4);
      // SN-002 is Consumed but never left stock, so it is not received.
      expect(before.snapshot?.issuedTrackedEntityIds).toEqual([issued!.id]);
      expect(before.choice).toEqual({
        mode: "serials",
        serials: ["SN-001", "SN-003", "SN-004"]
      });

      await sql`
        SELECT complete_job_to_inventory(
          p_job_id := ${job.jobId},
          p_quantity_complete := ${3}::numeric,
          p_company_id := ${f.companyId},
          p_user_id := ${USER}
        )
      `.execute(f.db);

      expect(await receivedSerials(f, job.jobId)).toEqual([
        "SN-001",
        "SN-003",
        "SN-004"
      ]);
      // A received issued unit is never offered again.
      const after = await dialogChoice(f, job, 4);
      expect(after.snapshot?.issuedTrackedEntityIds).toEqual([issued!.id]);
      expect(after.choice).toEqual({ mode: "locked" });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "leaves out an issued entity of more than one unit, which the completion never takes",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await numberedSerialJob(f, "multi", ["SN-101", "SN-102"]);
      const [multi, single] = await units(f, job.makeMethodId);

      await seed(f, async (trx) => {
        await trx
          .updateTable("trackedEntity")
          .set({ quantity: 2 })
          .where("id", "=", multi!.id)
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ status: "Consumed" })
          .where("id", "in", [multi!.id, single!.id])
          .execute();
        await trx
          .insertInto("itemLedger")
          .values(
            [multi!, single!].map((entity) => ({
              entryType: "Consumption" as const,
              documentType: "Job Consumption" as const,
              documentId: `${f.prefix}-parent-job`,
              itemId: f.assemblyId,
              quantity: -1,
              locationId: f.locationId,
              trackedEntityId: entity.id,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
      });

      const snapshot = await getJobReceiptSnapshot(f.db, job.jobId, f.companyId);
      expect(snapshot?.issuedTrackedEntityIds).toEqual([single!.id]);
    } finally {
      await f.cleanup();
    }
  }
);
