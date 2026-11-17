// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. Get Method deletes the job's operations, and
// a deleted operation takes its production events with it.

import {
  type Actor,
  createServiceContext
} from "@carbon/api/service-fn.server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as production from "../../app/modules/production/production.server";
import { jobMethodReplacementRefusal } from "../../app/modules/production/production.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

// Get Method runs as a posting, and the posting gate tells the system by its key.
vi.mock("@carbon/env", async (importOriginal) => {
  const { localServiceRoleKey } = await import("./fixtures/local-supabase");
  return {
    ...(await importOriginal<object>()),
    SUPABASE_SERVICE_ROLE_KEY: localServiceRoleKey() ?? "test"
  };
});

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

const SYSTEM: Actor = { type: "system", onBehalfOf: USER };

let f: Fixture;
let job: Awaited<ReturnType<typeof jobFixture>>;

beforeAll(async () => {
  if (!client) return;
  f = await alwaysPostFixture();
  job = await jobFixture(f);
  await seed(f, async (trx) => {
    await trx
      .updateTable("makeMethod")
      .set({ status: "Active" })
      .where("itemId", "=", f.assemblyId)
      .where("companyId", "=", f.companyId)
      .execute();
    // An operator started and stopped the operation.
    await trx
      .insertInto("productionEvent")
      .values({
        jobOperationId: job.operationId,
        type: "Labor",
        startTime: "2026-11-02T08:00:00Z",
        endTime: "2026-11-02T09:00:00Z",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
}, 60_000);

afterAll(async () => {
  if (!client) return;
  await f.cleanup();
}, 60_000);

const systemContext = () =>
  createServiceContext({
    actor: SYSTEM,
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
    system: () => client!,
    pg: () => f.db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

describeLocal("Get Method on a job with recorded production", () => {
  it("refuses to replace the method and keeps the operation and its time", async () => {
    const ctx = systemContext();

    const result = await production.copyMethodToJob(ctx, {
      type: "item",
      sourceId: f.assemblyId,
      targetId: job.jobId,
      parts: {
        billOfMaterial: true,
        billOfProcess: true,
        parameters: true,
        tools: true,
        steps: true,
        workInstructions: true
      }
    });

    const events = await f.db
      .selectFrom("productionEvent")
      .innerJoin("jobOperation", "jobOperation.id", "productionEvent.jobOperationId")
      .select("jobOperation.id")
      .where("jobOperation.jobId", "=", job.jobId)
      .execute();

    expect(result.error?.category).toBe("rule");
    expect(events.map((row) => row.id)).toEqual([job.operationId]);
  }, 60_000);

  it("checks only what the chosen parts replace", async () => {
    const ctx = systemContext();
    const refusal = (billOfMaterial: boolean, billOfProcess: boolean) =>
      jobMethodReplacementRefusal(
        ctx,
        { jobIds: [job.jobId] },
        { billOfMaterial, billOfProcess }
      ).then((error) => error?.category ?? null);

    // The time is on an operation: replacing only the bill of material keeps it.
    expect(await refusal(true, false)).toBeNull();
    expect(await refusal(false, true)).toBe("rule");

    // Material issued to the job blocks replacing the bill of material.
    await seed(f, (trx) =>
      trx
        .updateTable("jobMaterial")
        .set({ quantityIssued: 1 })
        .where("id", "=", job.materialId)
        .where("companyId", "=", f.companyId)
        .execute()
    );
    expect(await refusal(true, false)).toBe("rule");
  }, 60_000);
});
