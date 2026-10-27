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
  getNextSerialNumbers,
  getSerialNumberTiming,
  type SerialNumberTiming
} from "@carbon/database/sequence";
import { now } from "@internationalized/date";
import { sql } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import {
  completeJob,
  releaseCheckedJobs
} from "../../app/modules/production/production.server";
import { assignJobSerialNumbers } from "../../app/modules/production/production.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  stockPart,
  TIME_ZONE,
  USER,
  unwrap
} from "./fixtures/always-post";
import { connectLocalTestDatabase } from "./fixtures/local-database";
import { handlesOf } from "./fixtures/handles";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

// Release recalculates the job and numbers it through postings, and the
// posting gate tells the system by its key.
vi.mock("@carbon/env", async (importOriginal) => {
  const { localServiceRoleKey } = await import("./fixtures/local-supabase");
  return {
    ...(await importOriginal<object>()),
    SUPABASE_SERVICE_ROLE_KEY: localServiceRoleKey() ?? "test"
  };
});

const client = hasLocalDatabase ? localServiceRoleClient() : null;

function contextFor(f: Fixture, system: () => unknown = () => client) {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
    system: system as () => NonNullable<typeof client>,
    pg: () => f.db,
    kv: () => {
      throw new Error("completeJob reads no cache");
    }
  });
}

/** complete_job_to_inventory on the given connection or transaction. */
async function completeToInventory(
  db: Fixture["db"],
  args: { jobId: string; quantityComplete: number; companyId: string }
) {
  await sql`
    SELECT complete_job_to_inventory(
      p_job_id := ${args.jobId},
      p_quantity_complete := ${args.quantityComplete}::numeric,
      p_company_id := ${args.companyId},
      p_user_id := ${USER}
    )
  `.execute(db);
}

/** The serial sequence's next value: how many numbers were drawn. */
async function drawn(f: Fixture) {
  const sequence = await f.db
    .selectFrom("itemSerialSequence")
    .select("next")
    .where("itemId", "=", f.assemblyId)
    .executeTakeFirstOrThrow();
  return Number(sequence.next);
}

/** A serial assembly with a sequence (SN-001, SN-002, ...) and the timing set. */
async function serialSetup(f: Fixture, timing: SerialNumberTiming) {
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

/** The item's own timing, overriding the company's (null follows it). */
async function itemTiming(f: Fixture, timing: SerialNumberTiming | null) {
  await seed(f, async (trx) => {
    await trx
      .updateTable("itemSerialSequence")
      .set({ serialNumberTiming: timing })
      .where("itemId", "=", f.assemblyId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
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

  it("leaves a seed holding several units unnumbered on a single-unit touch", async () => {
    const f = await alwaysPostFixture();
    try {
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "single", 3);
      const [seedUnit] = await units(f, job.makeMethodId);

      const numbered = await f.db.transaction().execute((trx) =>
        assignSerialNumberIfMissing(trx, {
          trackedEntityId: seedUnit!.id,
          companyId: f.companyId,
          onlyIfSingleUnit: true
        })
      );

      expect(numbered).toBeNull();
      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({ readableId: null, quantity: 3 })
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("leaves a unit of another make method unnumbered on a touch scoped to one", async () => {
    const f = await alwaysPostFixture();
    try {
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "scoped", 1);
      const other = await untouchedSerialJob(f, "scoped-other", 1);
      const [seedUnit] = await units(f, job.makeMethodId);

      const numbered = await f.db.transaction().execute((trx) =>
        assignSerialNumberIfMissing(trx, {
          trackedEntityId: seedUnit!.id,
          companyId: f.companyId,
          onlyIfSingleUnit: true,
          jobMakeMethodId: other.makeMethodId
        })
      );

      expect(numbered).toBeNull();
      expect(await drawn(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("numbers a Batch lot when the job is created, whatever the timing", async () => {
    const f = await alwaysPostFixture();
    try {
      await serialSetup(f, "production");
      await seed(f, async (trx) => {
        await trx
          .updateTable("item")
          .set({ itemTrackingType: "Batch" })
          .where("id", "=", f.assemblyId)
          .execute();
      });
      const job = await untouchedSerialJob(f, "batch", 3);

      await assignJobSerialNumbers(client!, f.db, {
        jobId: job.jobId,
        itemId: f.assemblyId,
        companyId: f.companyId,
        userId: USER,
        at: "jobCreation"
      });

      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({ readableId: "SN-001", quantity: 3 })
      ]);
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
      // The receipt takes units in creation order: the seed (cut to one
      // unit) and the first unit split off it. The last unit is untouched.
      const after = await units(f, job.makeMethodId);
      expect(after).toHaveLength(3);
      expect(after[2]).toMatchObject({ readableId: null, quantity: 1 });
    } finally {
      await f.cleanup();
    }
  });

  it("leaves the units of an item with no serial sequence alone", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "jobCreation");
      await seed(f, async (trx) => {
        await trx
          .deleteFrom("itemSerialSequence")
          .where("itemId", "=", f.assemblyId)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      const job = await untouchedSerialJob(f, "3", 3);

      const result = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 2
      });
      expect(result.error).toBeNull();

      // Received against the seed, which stays one unnumbered entity.
      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({ readableId: null, quantity: 3 })
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("numbers a job left unnumbered when its timing changed back to job creation", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      // Created under production, so its units are still one unnumbered seed.
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "3b", 3);
      await itemTiming(f, "jobCreation");

      // Through PostgREST, as the ERP and MES write it, so the interceptors run.
      const done = await client!
        .from("jobOperation")
        .update({ status: "Done" })
        .eq("id", job.operationId)
        .eq("companyId", f.companyId);
      expect(done.error).toBeNull();

      expect(await receivedUnits(f, job.jobId)).toEqual([
        { readableId: "SN-001", quantity: 1 },
        { readableId: "SN-002", quantity: 1 },
        { readableId: "SN-003", quantity: 1 }
      ]);
      expect(await units(f, job.makeMethodId)).toHaveLength(3);
    } finally {
      await f.cleanup();
    }
  });

  it("refuses a completion the job cannot cover, and spends no number", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "4", 2);

      // Two units exist and none is left to create: three cannot be received.
      const result = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 3
      });

      expect(result.error?.category).toBe("rule");
      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({ readableId: null, quantity: 2 })
      ]);
      expect(await drawn(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("spends no number when the completion is refused after numbering", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "refused", 3);

      // The receipt into a storage unit that does not exist fails after the
      // units are split and numbered.
      const result = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 2,
        storageUnitId: "no-such-storage-unit",
        locationId: f.locationId
      });

      expect(result.error?.category).toBe("rule");
      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({ readableId: null, quantity: 3 })
      ]);
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

  it("numbers nothing for a completion another one received while it waited", async () => {
    const f = await alwaysPostFixture();
    const second = await connectLocalTestDatabase();
    const watcher = await connectLocalTestDatabase();
    let commit = () => {};
    const committed = new Promise<void>((resolve) => {
      commit = resolve;
    });
    let holding = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "race", 4);
      const args = {
        jobId: job.jobId,
        quantityComplete: 2,
        companyId: f.companyId
      };

      // The first completion numbers and receives two units, and keeps its
      // locks until it commits.
      const first = f.db.transaction().execute(async (trx) => {
        await completeToInventory(trx, args);
        holding();
        await committed;
      });
      await held;

      // The same completion again waits for the job row, then finds the two
      // units already received.
      const repeat = completeToInventory(second, args);
      for (let attempt = 0; ; attempt++) {
        const { rows } = await sql<{ waiting: number }>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query ILIKE '%complete_job_to_inventory%'`.execute(
          watcher
        );
        if (rows[0]!.waiting > 0) break;
        if (attempt === 200) throw new Error("The repeat never waited");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      commit();
      await first;

      await repeat;
      expect(await receivedUnits(f, job.jobId)).toHaveLength(2);
      const sequence = await f.db
        .selectFrom("itemSerialSequence")
        .select("next")
        .where("itemId", "=", f.assemblyId)
        .executeTakeFirstOrThrow();
      expect(Number(sequence.next)).toBe(2);
    } finally {
      commit();
      await second.destroy();
      await watcher.destroy();
      await f.cleanup();
    }
  });

  it("keeps the numbered completion and warns when returning picked material fails", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "sweep", 3);

      // A system client that is neither the service role nor signed in as the
      // user: the picked-material return refuses it after the completion committed.
      const result = await completeJob(
        contextFor(f, () => ({})),
        { jobId: job.jobId, quantityComplete: 2 }
      );

      expect(result).toEqual({
        data: {
          jobId: job.jobId,
          warning: "Job completed, but returning picked material failed"
        },
        error: null
      });
      expect(await receivedUnits(f, job.jobId)).toEqual([
        { readableId: "SN-001", quantity: 1 },
        { readableId: "SN-002", quantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("creates the units no row holds when a completion follows the shop floor", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "6", 3);
      const [seedUnit] = await units(f, job.makeMethodId);

      // The shop floor completes one unit: the seed keeps one unit and the
      // next unit carries the other two.
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "jobOperationSerialComplete",
            trackedEntityId: seedUnit!.id,
            quantity: 1,
            jobOperationId: job.operationId
          },
          issue
        )
      );
      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({ readableId: "SN-001", quantity: 1 }),
        expect.objectContaining({ readableId: null, quantity: 2 })
      ]);
      // A fourth unit added to the job afterwards is held by no row.
      await seed(f, async (trx) => {
        await trx
          .updateTable("job")
          .set({ quantity: 4 })
          .where("id", "=", job.jobId)
          .execute();
      });

      const result = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 4
      });
      expect(result.error).toBeNull();

      expect(await receivedUnits(f, job.jobId)).toEqual([
        { readableId: "SN-001", quantity: 1 },
        { readableId: "SN-002", quantity: 1 },
        { readableId: "SN-003", quantity: 1 },
        { readableId: "SN-004", quantity: 1 }
      ]);
      expect(await units(f, job.makeMethodId)).toHaveLength(4);
    } finally {
      await f.cleanup();
    }
  });

  it("scraps one unit of an unsplit seed, and the job still owes it", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "7", 3);
      const [seedUnit] = await units(f, job.makeMethodId);
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "jobOperationScrap",
            jobOperationId: job.operationId,
            quantity: 1,
            scrapReasonId: scrapReason.id,
            trackedEntityId: seedUnit!.id
          },
          issue
        )
      );
      // The replacement carries the seed's two other units and the one owed.
      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({
          readableId: "SN-001",
          quantity: 1,
          status: "Scrapped"
        }),
        expect.objectContaining({
          readableId: null,
          quantity: 3,
          status: "Reserved"
        })
      ]);

      const result = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 3
      });
      expect(result.error).toBeNull();

      expect(await receivedUnits(f, job.jobId)).toEqual([
        { readableId: "SN-002", quantity: 1 },
        { readableId: "SN-003", quantity: 1 },
        { readableId: "SN-004", quantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("completes a job with no serial sequence after its seed was scrapped", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      await seed(f, async (trx) => {
        await trx
          .deleteFrom("itemSerialSequence")
          .where("itemId", "=", f.assemblyId)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      const job = await untouchedSerialJob(f, "7b", 3);
      const [seedUnit] = await units(f, job.makeMethodId);
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "jobOperationScrap",
            jobOperationId: job.operationId,
            quantity: 1,
            scrapReasonId: scrapReason.id,
            trackedEntityId: seedUnit!.id
          },
          issue
        )
      );

      const result = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 3
      });
      expect(result.error).toBeNull();

      // Received against the seed the replacement carries on.
      expect(await receivedUnits(f, job.jobId)).toEqual([
        { readableId: null, quantity: 3 }
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("receives a finished unit and the seed's other units for an item with no serial sequence", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      await seed(f, async (trx) => {
        await trx
          .deleteFrom("itemSerialSequence")
          .where("itemId", "=", f.assemblyId)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      const job = await untouchedSerialJob(f, "7c", 3);
      const [seedUnit] = await units(f, job.makeMethodId);

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "jobOperationSerialComplete",
            trackedEntityId: seedUnit!.id,
            quantity: 1,
            jobOperationId: job.operationId
          },
          issue
        )
      );

      const result = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 3
      });
      expect(result.error).toBeNull();

      // The finished unit on its own, the other two against the seed.
      const received = await receivedUnits(f, job.jobId);
      expect(received.sort((a, b) => a.quantity - b.quantity)).toEqual([
        { readableId: null, quantity: 1 },
        { readableId: null, quantity: 2 }
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("receives no more than an item with no serial sequence holds, and grows its seed to a raised job quantity", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      await seed(f, async (trx) => {
        await trx
          .deleteFrom("itemSerialSequence")
          .where("itemId", "=", f.assemblyId)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      const job = await untouchedSerialJob(f, "7e", 3);
      // The job quantity is raised after its seed of three was made.
      await seed(f, async (trx) => {
        await trx
          .updateTable("job")
          .set({ quantity: 4 })
          .where("id", "=", job.jobId)
          .execute();
      });

      const beyond = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 5
      });
      expect(beyond.error?.category).toBe("rule");
      expect(await receivedUnits(f, job.jobId)).toEqual([]);

      const result = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 4
      });
      expect(result.error).toBeNull();
      expect(await receivedUnits(f, job.jobId)).toEqual([
        { readableId: null, quantity: 4 }
      ]);
      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({ quantity: 4, status: "Available" })
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("refuses to scrap a unit already received to stock", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "7d", 3);
      const completed = await completeJob(contextFor(f), {
        jobId: job.jobId,
        quantityComplete: 1
      });
      expect(completed.error).toBeNull();
      const received = (await units(f, job.makeMethodId)).find(
        (unit) => unit.readableId === "SN-001"
      );
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();

      const result = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "jobOperationScrap",
          jobOperationId: job.operationId,
          quantity: 1,
          scrapReasonId: scrapReason.id,
          trackedEntityId: received!.id
        },
        issue
      );

      expect(result.error?.status).toBe(400);
      expect(
        (await units(f, job.makeMethodId)).find(
          (unit) => unit.id === received!.id
        )
      ).toMatchObject({ quantity: 1, status: "Available" });
    } finally {
      await f.cleanup();
    }
  });

  it("refuses to scrap another job's unit, and leaves that unit whole", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "8", 3);
      const otherJob = await untouchedSerialJob(f, "9", 3);
      const [otherSeed] = await units(f, otherJob.makeMethodId);
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();

      const result = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "jobOperationScrap",
          jobOperationId: job.operationId,
          quantity: 1,
          scrapReasonId: scrapReason.id,
          trackedEntityId: otherSeed!.id
        },
        issue
      );

      expect(result.error?.status).toBe(400);
      expect(await units(f, otherJob.makeMethodId)).toEqual([
        expect.objectContaining({
          readableId: null,
          quantity: 3,
          status: "Reserved"
        })
      ]);
      expect(await drawn(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("refuses to complete another job's unit, and leaves that unit whole", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "10", 3);
      const otherJob = await untouchedSerialJob(f, "11", 3);
      const [otherSeed] = await units(f, otherJob.makeMethodId);

      const result = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "jobOperationSerialComplete",
          trackedEntityId: otherSeed!.id,
          quantity: 1,
          jobOperationId: job.operationId
        },
        issue
      );

      expect(result.error?.status).toBe(400);
      expect(await units(f, otherJob.makeMethodId)).toEqual([
        expect.objectContaining({
          readableId: null,
          quantity: 3,
          status: "Reserved"
        })
      ]);
      const quantities = await f.db
        .selectFrom("productionQuantity")
        .select("id")
        .where("jobOperationId", "=", job.operationId)
        .execute();
      expect(quantities).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  it("numbers and receives untouched units when the last operation is marked Done", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "production");
      const job = await untouchedSerialJob(f, "5", 3);

      // Through PostgREST, as the ERP and MES write it, so the interceptors run.
      const done = await client!
        .from("jobOperation")
        .update({ status: "Done" })
        .eq("id", job.operationId)
        .eq("companyId", f.companyId);
      expect(done.error).toBeNull();

      expect(await receivedUnits(f, job.jobId)).toEqual([
        { readableId: "SN-001", quantity: 1 },
        { readableId: "SN-002", quantity: 1 },
        { readableId: "SN-003", quantity: 1 }
      ]);
      expect(await units(f, job.makeMethodId)).toHaveLength(3);
    } finally {
      await f.cleanup();
    }
  });

  it("numbers every unit when the job is released under the release timing", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      await serialSetup(f, "jobRelease");
      const job = await untouchedSerialJob(f, "8", 3);
      await seed(f, async (trx) => {
        await trx
          .updateTable("job")
          .set({ status: "Planned" })
          .where("id", "=", job.jobId)
          .execute();
      });

      // Creation leaves the job's units alone under this timing.
      await assignJobSerialNumbers(client!, f.db, {
        jobId: job.jobId,
        itemId: f.assemblyId,
        companyId: f.companyId,
        userId: USER,
        at: "jobCreation"
      });
      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({ readableId: null, quantity: 3 })
      ]);

      const released = await releaseCheckedJobs(contextFor(f), {
        jobIds: [job.jobId],
        purchaseOrdersBySupplierId: {}
      });
      expect(released.error).toBeNull();
      expect(released.data?.failure).toBeNull();

      expect(
        (await units(f, job.makeMethodId)).map((unit) => [
          unit.readableId,
          Number(unit.quantity)
        ])
      ).toEqual([
        ["SN-001", 1],
        ["SN-002", 1],
        ["SN-003", 1]
      ]);
    } finally {
      await f.cleanup();
    }
  }, 60_000);

  it("follows an item's own timing before the company's", async () => {
    const f = await alwaysPostFixture();
    try {
      // The company numbers at creation; this item at production.
      await serialSetup(f, "jobCreation");
      await itemTiming(f, "production");
      expect(
        await getSerialNumberTiming(f.db, f.companyId, f.assemblyId)
      ).toBe("production");
      expect(await getSerialNumberTiming(f.db, f.companyId)).toBe(
        "jobCreation"
      );

      const job = await untouchedSerialJob(f, "9", 2);
      await assignJobSerialNumbers(client!, f.db, {
        jobId: job.jobId,
        itemId: f.assemblyId,
        companyId: f.companyId,
        userId: USER
      });
      expect(await units(f, job.makeMethodId)).toEqual([
        expect.objectContaining({ readableId: null, quantity: 2 })
      ]);
      await completeToInventory(f.db, {
        jobId: job.jobId,
        quantityComplete: 2,
        companyId: f.companyId
      });
      expect(await receivedUnits(f, job.jobId)).toEqual([
        { readableId: "SN-001", quantity: 1 },
        { readableId: "SN-002", quantity: 1 }
      ]);

      // The company numbers at production; this item at creation, so the
      // job's units are numbered when it is created.
      await seed(f, async (trx) => {
        await trx
          .updateTable("companySettings")
          .set({ serialNumberTiming: "production" })
          .where("id", "=", f.companyId)
          .execute();
      });
      await itemTiming(f, "jobCreation");
      const second = await untouchedSerialJob(f, "10", 2);
      await assignJobSerialNumbers(client!, f.db, {
        jobId: second.jobId,
        itemId: f.assemblyId,
        companyId: f.companyId,
        userId: USER
      });
      const numberedAtCreation = await units(f, second.makeMethodId);
      expect(
        numberedAtCreation
          .map((unit) => [unit.readableId, Number(unit.quantity)])
          .sort()
      ).toEqual([
        ["SN-003", 1],
        ["SN-004", 1]
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it("formats serials in SQL with the company's date and the job's location", async () => {
    const f = await alwaysPostFixture();
    try {
      await serialSetup(f, "production");
      await seed(f, async (trx) => {
        await trx
          .updateTable("itemSerialSequence")
          .set({ prefix: "%{location}-%{yyyy}-", suffix: "-X", next: 41 })
          .where("itemId", "=", f.assemblyId)
          .execute();
      });

      const serials = await f.db.transaction().execute((trx) =>
        getNextSerialNumbers(trx, {
          itemId: f.assemblyId,
          companyId: f.companyId,
          count: 2,
          locationCode: "  HQ ",
          locationName: "Headquarters"
        })
      );

      const year = now(TIME_ZONE).year;
      expect(serials).toEqual([`HQ-${year}-042-X`, `HQ-${year}-043-X`]);
    } finally {
      await f.cleanup();
    }
  });
});
