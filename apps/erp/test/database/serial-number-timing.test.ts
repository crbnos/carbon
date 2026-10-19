// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. Under serialNumberTiming = 'production' a
// job's units stay unnumbered until first touched, and completing the job is a
// first touch: completeJob splits and numbers the units the receipt takes.

import { createServiceContext } from "@carbon/api/service-fn.server";
import {
  assignSerialNumberIfMissing,
  getSerialNumberTiming
} from "@carbon/database/sequence";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { completeJob } from "../../app/modules/production/production.server";
import { numberSerialUnitsForCompletion } from "../../app/modules/production/production.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  stockPart,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const client = hasLocalDatabase ? localServiceRoleClient() : null;

function contextFor(f: Fixture) {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
    system: () => client!,
    pg: () => f.db,
    kv: () => {
      throw new Error("completeJob reads no cache");
    }
  });
}

/** A serial assembly with a sequence (SN-001, SN-002, ...) and the timing set. */
async function serialSetup(f: Fixture, timing: "jobCreation" | "production") {
  await seed(f, async (trx) => {
    await trx
      .updateTable("item")
      .set({ itemTrackingType: "Serial" })
      .where("id", "=", f.assemblyId)
      .execute();
    await trx
      .insertInto("itemSerialSequence")
      .values({
        itemId: f.assemblyId,
        prefix: "SN-",
        suffix: "",
        next: 0,
        size: 3,
        step: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("companySettings")
      .set({ serialNumberTiming: timing })
      .where("id", "=", f.companyId)
      .execute();
  });
}

/** A Ready serial job of `quantity` units holding ONE unnumbered seed. */
async function untouchedSerialJob(f: Fixture, key: string, quantity: number) {
  const job = await jobFixture(f, key);
  const makeMethod = await f.db
    .selectFrom("jobMakeMethod")
    .select("id")
    .where("jobId", "=", job.jobId)
    .where("parentMaterialId", "is", null)
    .executeTakeFirstOrThrow();
  await seed(f, async (trx) => {
    await trx
      .updateTable("job")
      .set({ status: "Ready", quantity })
      .where("id", "=", job.jobId)
      .execute();
    await trx
      .updateTable("jobMakeMethod")
      .set({ requiresSerialTracking: true })
      .where("id", "=", makeMethod.id)
      .execute();
    await trx
      .updateTable("jobOperation")
      .set({ status: "Ready", operationQuantity: quantity })
      .where("id", "=", job.operationId)
      .execute();
    // Exactly one seed for the root make method, whatever the job insert made.
    await trx
      .deleteFrom("trackedEntity")
      .where("companyId", "=", f.companyId)
      .where(sql<boolean>`attributes->>'Job Make Method' = ${makeMethod.id}`)
      .execute();
    await trx
      .insertInto("trackedEntity")
      .values({
        quantity,
        status: "Reserved",
        sourceDocument: "Job",
        sourceDocumentId: job.jobId,
        sourceDocumentReadableId: `J-${key}`,
        itemId: f.assemblyId,
        attributes: { Job: job.jobId, "Job Make Method": makeMethod.id },
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return { ...job, makeMethodId: makeMethod.id };
}

async function units(f: Fixture, makeMethodId: string) {
  return f.db
    .selectFrom("trackedEntity")
    .select(["id", "readableId", "quantity", "status"])
    .where("companyId", "=", f.companyId)
    .where(sql<boolean>`attributes->>'Job Make Method' = ${makeMethodId}`)
    .orderBy("createdAt")
    .execute();
}

async function receivedUnits(f: Fixture, jobId: string) {
  const rows = await f.db
    .selectFrom("itemLedger")
    .innerJoin("trackedEntity", "trackedEntity.id", "itemLedger.trackedEntityId")
    .select(["trackedEntity.readableId", "itemLedger.quantity"])
    .where("itemLedger.companyId", "=", f.companyId)
    .where("itemLedger.documentType", "=", "Job Receipt")
    .where("itemLedger.documentId", "=", jobId)
    .orderBy("trackedEntity.readableId")
    .execute();
  return rows.map((row) => ({
    readableId: row.readableId,
    quantity: Number(row.quantity)
  }));
}

describe.skipIf(!client)("serial number timing", () => {
  it("reads the company's timing, defaulting to job creation", async () => {
    const f = await alwaysPostFixture();
    try {
      expect(await getSerialNumberTiming(f.db, f.companyId)).toBe(
        "jobCreation"
      );
      await serialSetup(f, "production");
      expect(await getSerialNumberTiming(f.db, f.companyId)).toBe("production");
      expect(await getSerialNumberTiming(f.db, `${f.companyId}-none`)).toBe(
        "jobCreation"
      );
    } finally {
      await f.cleanup();
    }
  });

  it("numbers a unit once, at its first touch", async () => {
    const f = await alwaysPostFixture();
    try {
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "1", 1);
      const [seedUnit] = await units(f, job.makeMethodId);

      const first = await f.db
        .transaction()
        .execute((trx) =>
          assignSerialNumberIfMissing(trx, {
            trackedEntityId: seedUnit!.id,
            companyId: f.companyId
          })
        );
      const second = await f.db
        .transaction()
        .execute((trx) =>
          assignSerialNumberIfMissing(trx, {
            trackedEntityId: seedUnit!.id,
            companyId: f.companyId
          })
        );

      expect(first).toBe("SN-001");
      expect(second).toBeNull();
      expect((await units(f, job.makeMethodId))[0]?.readableId).toBe("SN-001");
    } finally {
      await f.cleanup();
    }
  });

  it("splits and numbers the units a completion takes, and receives them", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "2", 3);

      const result = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 2
      });
      expect(result.error).toBeNull();

      expect(await receivedUnits(f, job.jobId)).toEqual([
        { readableId: "SN-001", quantity: 1 },
        { readableId: "SN-002", quantity: 1 }
      ]);
      // The seed is the job's last unit, still unnumbered and untouched.
      const after = await units(f, job.makeMethodId);
      expect(after).toHaveLength(3);
      expect(after[0]).toMatchObject({ readableId: null, quantity: 1 });
    } finally {
      await f.cleanup();
    }
  });

  it("leaves a job alone under the default timing", async () => {
    const f = await alwaysPostFixture();
    try {
      await serialSetup(f, "jobCreation");
      const job = await untouchedSerialJob(f, "3", 3);

      const numbered = await numberSerialUnitsForCompletion(f.db, {
        jobId: job.jobId,
        quantityComplete: 2,
        companyId: f.companyId
      });

      expect(numbered).toEqual({ numbered: 0 });
      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({ readableId: null, quantity: 3 })
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("spends no number when the job cannot cover the completion", async () => {
    const f = await alwaysPostFixture();
    try {
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "4", 2);

      const numbered = await numberSerialUnitsForCompletion(f.db, {
        jobId: job.jobId,
        quantityComplete: 3,
        companyId: f.companyId
      });

      expect(numbered).toEqual({ numbered: 0 });
      const sequence = await f.db
        .selectFrom("itemSerialSequence")
        .select("next")
        .where("itemId", "=", f.assemblyId)
        .executeTakeFirstOrThrow();
      expect(Number(sequence.next)).toBe(0);
    } finally {
      await f.cleanup();
    }
  });
});
