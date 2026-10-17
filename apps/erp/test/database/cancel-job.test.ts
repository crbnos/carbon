// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// Cancelling a job returns the material picked to its lineside bin and closes
// its picking list before the status changes. The return used to be skipped:
// the sweep only ran for a job already Completed or Cancelled, and the cancel
// sweeps first. The status write goes through PostgREST, so the caller is a
// real supabase-js client whose HTTP requests are recorded.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { SUPABASE_SERVICE_ROLE_KEY } from "@carbon/env";
import { databaseTest } from "./fixtures/local-database";
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

/**
 * The cancel's context for company `f`. The caller's PostgREST requests are
 * recorded and answered with no rows. The service-role client is only ever
 * handed to the picking server function, which tells the system by its key.
 */
function cancelContext(
  f: Fixture,
  systemKey = SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key"
) {
  const writes: { table: string; body: Record<string, unknown> }[] = [];
  const caller = createClient("http://localhost:54321", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          writes.push({
            table: new URL(String(input)).pathname.split("/").pop() ?? "",
            body: JSON.parse(String(init.body))
          });
          return new Response(null, { status: 204 });
        }
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }) as typeof fetch
    }
  });
  const system = createClient("http://localhost:54321", systemKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (async () => {
        throw new Error("The cancel sends no service-role request");
      }) as typeof fetch
    }
  });
  const ctx = createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: caller as never,
    system: () => system as never,
    pg: () => f.db,
    kv: () => {
      throw new Error("The cancel uses no kv");
    }
  });
  return { ctx, writes };
}

databaseTest(
  "a cancel returns the picked material, closes the picking list, then sets Cancelled",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const job = await pickedJob(f);
      expect(await onHand(f, job.linesideId)).toBe(1);
      expect(await onHand(f, null)).toBe(9);

      const { ctx, writes } = cancelContext(f);
      const result = await cancelJob(ctx, { jobId: job.jobId });

      expect(result).toEqual({ data: { jobId: job.jobId }, error: null });
      expect(await onHand(f, job.linesideId)).toBe(0);
      expect(await onHand(f, null)).toBe(10);
      expect(await pick(f, job)).toEqual({
        line: "Cancelled",
        returned: 1,
        list: "Cancelled"
      });
      expect(writes).toEqual([
        {
          table: "job",
          body: expect.objectContaining({ status: "Cancelled", assignee: null })
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a cancel whose material cannot be returned changes nothing else",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const job = await pickedJob(f);

      // Not the service-role key: the picking server function refuses the
      // caller, so the return fails.
      const { ctx, writes } = cancelContext(f, "not-the-service-role-key");
      const { error } = await cancelJob(ctx, { jobId: job.jobId });

      expect(error?.message).toBe(
        "Cancel aborted: returning picked material failed"
      );
      expect(await onHand(f, job.linesideId)).toBe(1);
      expect(await pick(f, job)).toEqual({
        line: "Picked",
        returned: 0,
        list: "In Progress"
      });
      expect(writes).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a job that has left fromStatuses is refused before its material is returned",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const job = await pickedJob(f);

      const { ctx, writes } = cancelContext(f);
      const { error } = await cancelJob(ctx, {
        jobId: job.jobId,
        fromStatuses: ["Draft", "Planned"]
      });

      expect(error?.category).toBe("conflict");
      expect(await onHand(f, job.linesideId)).toBe(1);
      expect(await pick(f, job)).toEqual({
        line: "Picked",
        returned: 0,
        list: "In Progress"
      });
      expect(writes).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "another company's job is not found, and nothing of it changes",
  async () => {
    const f = await alwaysPostFixture();
    const other = await alwaysPostFixture();
    try {
      await stockPart(other, 10);
      const job = await pickedJob(other);

      const { ctx, writes } = cancelContext(f);
      const { error } = await cancelJob(ctx, { jobId: job.jobId });

      expect(error?.category).toBe("notFound");
      expect(await onHand(other, job.linesideId)).toBe(1);
      expect(await pick(other, job)).toEqual({
        line: "Picked",
        returned: 0,
        list: "In Progress"
      });
      expect(writes).toEqual([]);
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  }
);

// Without `cancelling` the job sweep is completion's (`completeJob`): an open
// job still needs what is staged for it.
databaseTest(
  "a job sweep that is not a cancel leaves an open job's picks at lineside",
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
