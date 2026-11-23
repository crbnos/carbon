// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// Creating a batch and changing its members, through the service functions the
// batch builder and drawer call. The `batch-operations` server function does
// the work over Kysely; it is handed the caller's client and tells the system
// by its key, so the caller is a service-role supabase-js client that sends no
// request.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { SUPABASE_SERVICE_ROLE_KEY } from "@carbon/env";
import { databaseTest } from "./fixtures/local-database";
import { createClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import {
  createBatch,
  updateBatch
} from "../../app/modules/production/production.server";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";

function batchContext(f: Fixture) {
  const client = createClient(
    "http://localhost:54321",
    SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key",
    {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (async () => {
        throw new Error("A batch change sends no PostgREST request");
      }) as typeof fetch
    }
  });
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client as never,
    system: () => client as never,
    pg: () => f.db,
    kv: () => {
      throw new Error("A batch change uses no kv");
    }
  });
}

/** Three jobs whose operations run on one batchable process. */
async function batchableOperations(f: Fixture) {
  const jobs = await Promise.all(
    ["1", "2", "3"].map((key) => jobFixture(f, key))
  );
  const processId = `${f.prefix}-process-1`;
  await seed(f, async (trx) => {
    await trx
      .updateTable("process")
      .set({ batchable: true })
      .where("id", "=", processId)
      .execute();
    await trx
      .updateTable("jobOperation")
      .set({ processId })
      .where(
        "id",
        "in",
        jobs.map((job) => job.operationId)
      )
      .execute();
    await trx
      .insertInto("sequence")
      .values({
        table: "jobOperationBatch",
        name: "Batch",
        prefix: "BAT-",
        companyId: f.companyId
      })
      .execute();
  });
  return jobs.map((job) => job.operationId);
}

async function batchOf(f: Fixture, operationIds: string[]) {
  const rows = await f.db
    .selectFrom("jobOperation")
    .select(["id", "jobOperationBatchId"])
    .where("id", "in", operationIds)
    .execute();
  return Object.fromEntries(rows.map((row) => [row.id, row.jobOperationBatchId]));
}

databaseTest(
  "a batch is created from operations of one batchable process, and takes more",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const [first, second, third] = await batchableOperations(f);
      const ctx = batchContext(f);

      const created = await createBatch(ctx, {
        locationId: f.locationId,
        jobOperationIds: [first, second]
      });
      expect(created.error).toBeNull();
      const batchId = created.data?.batchId;
      expect(created.data?.readableId).toMatch(/^BAT-/);
      const batch = await f.db
        .selectFrom("jobOperationBatch")
        .select("status")
        .where("id", "=", batchId!)
        .executeTakeFirstOrThrow();
      expect(batch.status).toBe("Planned");

      const added = await updateBatch(ctx, {
        batchId: batchId!,
        type: "add",
        jobOperationIds: [third]
      });
      expect(added).toEqual({ data: { batchId }, error: null });
      expect(await batchOf(f, [first, second, third])).toEqual({
        [first]: batchId,
        [second]: batchId,
        [third]: batchId
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a batch refuses an operation it cannot run, and changes nothing",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const [first, second, third] = await batchableOperations(f);
      const ctx = batchContext(f);
      await seed(f, async (trx) => {
        await trx
          .updateTable("process")
          .set({ batchable: false })
          .where("id", "=", `${f.prefix}-process-1`)
          .execute();
      });

      const refused = await createBatch(ctx, {
        locationId: f.locationId,
        jobOperationIds: [first, second]
      });
      expect(refused.error?.category).toBe("rule");
      expect(refused.error?.message).toBe("The process is not batchable");
      expect(await batchOf(f, [first, second])).toEqual({
        [first]: null,
        [second]: null
      });

      // On a batchable process again: a started operation cannot join.
      await seed(f, async (trx) => {
        await trx
          .updateTable("process")
          .set({ batchable: true })
          .where("id", "=", `${f.prefix}-process-1`)
          .execute();
        await trx
          .updateTable("jobOperation")
          .set({ status: "In Progress" })
          .where("id", "=", third)
          .execute();
      });
      const created = await createBatch(ctx, {
        locationId: f.locationId,
        jobOperationIds: [first, second]
      });
      const batchId = created.data?.batchId;
      const add = await updateBatch(ctx, {
        batchId: batchId!,
        type: "add",
        jobOperationIds: [third]
      });
      expect(add.error?.category).toBe("rule");
      expect(add.error?.message).toBe(
        `Operation ${third} has already started`
      );
      expect((await batchOf(f, [third]))[third]).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);
