// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// Cancelling a job sets it Cancelled, then returns the material picked to its
// lineside bin and closes its picking list. The status goes first, guarded on
// the statuses a job can be cancelled from, so a refused cancel returns
// nothing. The status write goes through the local stack's PostgREST, so these
// tests also skip without one.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { SUPABASE_SERVICE_ROLE_KEY } from "@carbon/env";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { postPicking } from "../../app/modules/inventory/inventory.service";
import { createClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { cancelJob } from "../../app/modules/production/production.server";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  stockPart,
  USER,
  unwrap
} from "./fixtures/always-post";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const caller = hasLocalDatabase ? localServiceRoleClient() : null;
const cancelTest = (name: string, fn: () => Promise<void>) =>
  databaseTest(name, async () => {
    if (!caller) return;
    await fn();
  });

/** A Ready job with one of its two parts picked from stock to a lineside bin,
 *  so its picking list is still open. */
async function pickedJob(f: Fixture) {
  const job = await jobFixture(f);
  const linesideId = `${f.prefix}-lineside`;
  const pickingListId = `${f.prefix}-pick`;
  const lineId = `${f.prefix}-pick-line`;
  await seed(f, async (trx) => {
    await trx
      .updateTable("job")
      .set({ status: "Ready" })
      .where("id", "=", job.jobId)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("storageUnit")
      .values({
        id: linesideId,
        name: "Lineside",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("pickingList")
      .values({
        id: pickingListId,
        pickingListId: "PL-1",
        status: "In Progress",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("pickingListLine")
      .values({
        id: lineId,
        pickingListId,
        jobId: job.jobId,
        jobMaterialId: job.materialId,
        jobOperationId: job.operationId,
        itemId: f.partId,
        quantityToPick: 2,
        toStorageUnitId: linesideId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(
    await invokePosting(handlesOf(f.ctx), "post-picking", {
            type: "inventory",
            pickingListId,
            pickingListLineId: lineId,
            quantity: 1,
            locationId: f.locationId
          }, postPicking)
  );
  return { ...job, linesideId, pickingListId, lineId };
}

/** The part's on-hand in one bin; `null` is the location's unassigned stock. */
async function onHand(f: Fixture, storageUnitId: string | null) {
  let query = f.db
    .selectFrom("itemLedger")
    .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", f.partId);
  query =
    storageUnitId === null
      ? query.where("storageUnitId", "is", null)
      : query.where("storageUnitId", "=", storageUnitId);
  return Number((await query.executeTakeFirst())?.quantity ?? 0);
}

async function pick(f: Fixture, job: Awaited<ReturnType<typeof pickedJob>>) {
  const [line, list] = await Promise.all([
    f.db
      .selectFrom("pickingListLine")
      .select(["status", "quantityReturned"])
      .where("id", "=", job.lineId)
      .executeTakeFirstOrThrow(),
    f.db
      .selectFrom("pickingList")
      .select("status")
      .where("id", "=", job.pickingListId)
      .executeTakeFirstOrThrow()
  ]);
  return {
    line: line.status,
    returned: Number(line.quantityReturned),
    list: list.status
  };
}

async function job(f: Fixture, jobId: string) {
  return f.db
    .selectFrom("job")
    .select(["status", "assignee"])
    .where("id", "=", jobId)
    .executeTakeFirstOrThrow();
}

/**
 * The cancel's context for company `f`. The service-role client is only ever
 * handed to the picking posting, which tells the system by its key; its
 * requests fail, so it must not need one.
 */
function cancelContext(
  f: Fixture,
  systemKey = SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key"
) {
  const system = createClient("http://localhost:54321", systemKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (async () => {
        throw new Error("The cancel sends no service-role request");
      }) as typeof fetch
    }
  });
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: caller as never,
    system: () => system as never,
    pg: () => f.db,
    kv: () => {
      throw new Error("The cancel uses no kv");
    }
  });
}

cancelTest(
  "a cancel sets Cancelled, returns the picked material, then closes the picking list",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const picked = await pickedJob(f);
      expect(await onHand(f, picked.linesideId)).toBe(1);
      expect(await onHand(f, null)).toBe(9);

      const result = await cancelJob(cancelContext(f), {
        jobId: picked.jobId
      });

      expect(result).toEqual({
        data: { jobId: picked.jobId, warning: null },
        error: null
      });
      expect(await job(f, picked.jobId)).toEqual({
        status: "Cancelled",
        assignee: null
      });
      expect(await onHand(f, picked.linesideId)).toBe(0);
      expect(await onHand(f, null)).toBe(10);
      expect(await pick(f, picked)).toEqual({
        line: "Cancelled",
        returned: 1,
        list: "Cancelled"
      });
    } finally {
      await f.cleanup();
    }
  }
);

cancelTest(
  "a cancel whose material cannot be returned stays Cancelled and says so",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const picked = await pickedJob(f);

      // Not the service-role key: the picking posting refuses the caller, so
      // the return fails after the status changed.
      const result = await cancelJob(
        cancelContext(f, "not-the-service-role-key"),
        { jobId: picked.jobId }
      );

      expect(result.error).toBeNull();
      expect(result.data?.warning).toBe(
        "The job is cancelled, but its picked material was not returned to stock."
      );
      expect((await job(f, picked.jobId)).status).toBe("Cancelled");
      expect(await onHand(f, picked.linesideId)).toBe(1);
      expect(await pick(f, picked)).toEqual({
        line: "Picked",
        returned: 0,
        list: "In Progress"
      });
    } finally {
      await f.cleanup();
    }
  }
);

cancelTest(
  "a job that has left fromStatuses is refused, and none of its material is returned",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const picked = await pickedJob(f);

      const { error } = await cancelJob(cancelContext(f), {
        jobId: picked.jobId,
        fromStatuses: ["Draft", "Planned"]
      });

      expect(error?.category).toBe("conflict");
      expect((await job(f, picked.jobId)).status).toBe("Ready");
      expect(await onHand(f, picked.linesideId)).toBe(1);
      expect(await pick(f, picked)).toEqual({
        line: "Picked",
        returned: 0,
        list: "In Progress"
      });
    } finally {
      await f.cleanup();
    }
  }
);

cancelTest(
  "a Completed job is not cancelled, and its picks stay where they are",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const picked = await pickedJob(f);
      await seed(f, (trx) =>
        trx
          .updateTable("job")
          .set({ status: "Completed" })
          .where("id", "=", picked.jobId)
          .where("companyId", "=", f.companyId)
          .execute()
      );

      const { error } = await cancelJob(cancelContext(f), {
        jobId: picked.jobId
      });

      expect(error?.category).toBe("conflict");
      expect((await job(f, picked.jobId)).status).toBe("Completed");
      expect(await onHand(f, picked.linesideId)).toBe(1);
    } finally {
      await f.cleanup();
    }
  }
);

cancelTest(
  "another company's job is not found, and nothing of it changes",
  async () => {
    const f = await alwaysPostFixture();
    const other = await alwaysPostFixture();
    try {
      await stockPart(other, 10);
      const picked = await pickedJob(other);

      const { error } = await cancelJob(cancelContext(f), {
        jobId: picked.jobId
      });

      expect(error?.category).toBe("notFound");
      expect((await job(other, picked.jobId)).status).toBe("Ready");
      expect(await onHand(other, picked.linesideId)).toBe(1);
      expect(await pick(other, picked)).toEqual({
        line: "Picked",
        returned: 0,
        list: "In Progress"
      });
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  }
);

// The job sweep runs only for a Completed or Cancelled job: an open job still
// needs what is staged for it.
databaseTest(
  "a job sweep leaves an open job's picks at lineside",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const job = await pickedJob(f);

      unwrap(
        await invokePosting(handlesOf(f.ctx), "post-picking", {
                    type: "returnJobRemainders",
                    jobId: job.jobId
                  }, postPicking)
      );

      expect(await onHand(f, job.linesideId)).toBe(1);
      expect((await pick(f, job)).returned).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);
