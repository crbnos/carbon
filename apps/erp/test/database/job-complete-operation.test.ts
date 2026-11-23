// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. `completeOperation` reports a good quantity
// on an untracked operation: the quantity is recorded, the materials are
// backflushed, and the operation is finished once it reaches its target.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { describe, expect, it } from "vitest";
import { completeOperation } from "../../app/modules/production/production.server";
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
      throw new Error("completeOperation reads no cache");
    }
  });
}

async function readyJob(f: Fixture, key: string, operationQuantity: number) {
  const job = await jobFixture(f, key);
  await seed(f, async (trx) => {
    await trx
      .updateTable("job")
      .set({ status: "Ready", quantity: operationQuantity })
      .where("id", "=", job.jobId)
      .execute();
    await trx
      .updateTable("jobOperation")
      .set({ status: "Ready", operationQuantity, targetQuantity: null })
      .where("id", "=", job.operationId)
      .execute();
    // Two of the part per assembly.
    await trx
      .updateTable("jobMaterial")
      .set({ estimatedQuantity: 2 * operationQuantity })
      .where("id", "=", job.materialId)
      .execute();
  });
  return job;
}

async function operation(f: Fixture, id: string) {
  const row = await f.db
    .selectFrom("jobOperation")
    .select("status")
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  const produced = await f.db
    .selectFrom("productionQuantity")
    .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
    .where("jobOperationId", "=", id)
    .executeTakeFirst();
  return { status: row.status, produced: Number(produced?.quantity ?? 0) };
}

async function partOnHand(f: Fixture) {
  const row = await f.db
    .selectFrom("itemLedger")
    .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", f.partId)
    .executeTakeFirst();
  return Number(row?.quantity ?? 0);
}

describe.skipIf(!client)("completeOperation", () => {
  it("records, backflushes, and finishes the operation at its target", async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const job = await readyJob(f, "1", 2);
      const ctx = contextFor(f);

      const first = await completeOperation(ctx, {
        operationId: job.operationId,
        quantity: 1
      });
      expect(first).toEqual({
        data: { operationId: job.operationId, done: false, warning: null },
        error: null
      });
      expect(await operation(f, job.operationId)).toEqual({
        status: "Ready",
        produced: 1
      });
      expect(await partOnHand(f)).toBe(8);

      const second = await completeOperation(ctx, {
        operationId: job.operationId,
        quantity: 1
      });
      expect(second.error).toBeNull();
      expect(second.data?.done).toBe(true);
      expect(await operation(f, job.operationId)).toEqual({
        status: "Done",
        produced: 2
      });
      expect(await partOnHand(f)).toBe(6);
    } finally {
      await f.cleanup();
    }
  }, 60_000);

  it("refuses a serial-tracked operation before recording anything", async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await readyJob(f, "1", 1);
      await seed(f, (trx) =>
        trx
          .updateTable("jobMakeMethod")
          .set({ requiresSerialTracking: true })
          .where("jobId", "=", job.jobId)
          .execute()
      );

      const result = await completeOperation(contextFor(f), {
        operationId: job.operationId,
        quantity: 1
      });

      expect(result.error?.category).toBe("rule");
      expect(await operation(f, job.operationId)).toEqual({
        status: "Ready",
        produced: 0
      });
    } finally {
      await f.cleanup();
    }
  }, 60_000);

  it("refuses a locked job before recording anything", async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await readyJob(f, "1", 1);
      await seed(f, (trx) =>
        trx
          .updateTable("job")
          .set({ status: "Closed" })
          .where("id", "=", job.jobId)
          .execute()
      );

      const result = await completeOperation(contextFor(f), {
        operationId: job.operationId,
        quantity: 1
      });

      expect(result.error?.category).toBe("rule");
      expect((await operation(f, job.operationId)).produced).toBe(0);
    } finally {
      await f.cleanup();
    }
  }, 60_000);
});
