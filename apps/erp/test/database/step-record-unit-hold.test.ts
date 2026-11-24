// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { sql, type Transaction } from "kysely";
import { expect } from "vitest";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  stockPart,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { holdUnits, raiseIssue, serialJob } from "./fixtures/job-unit-hold";
import { connectLocalTestDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

async function steps(f: Fixture, operationId: string) {
  return f.db
    .insertInto("jobOperationStep")
    .values(
      ["Check fit", "Check finish"].map((name) => ({
        operationId,
        companyId: f.companyId,
        createdBy: USER,
        name,
        type: "Checkbox" as const
      }))
    )
    .returning("id")
    .execute();
}

const link =
  (f: Fixture, issueId: string, unitId: string) =>
  (trx: Transaction<KyselyDatabase>) =>
    trx
      .insertInto("nonConformanceTrackedEntity")
      .values({
        companyId: f.companyId,
        nonConformanceId: issueId,
        trackedEntityId: unitId,
        createdBy: USER
      })
      .execute();

/** Queue a real write behind the uncommitted change to the hold. */
async function duringNewHold<T>(
  applyHold: (trx: Transaction<KyselyDatabase>) => Promise<unknown>,
  write: () => Promise<T>
): Promise<T> {
  const quality = await connectLocalTestDatabase();
  let pending: Promise<T> | undefined;
  try {
    await quality.transaction().execute(async (trx) => {
      await applyHold(trx);
      pending = write();
      await expect
        .poll(
          async () => {
            const { rows } = await sql<{ waiting: boolean }>`
          SELECT EXISTS (SELECT 1 FROM pg_locks
            WHERE NOT granted AND pg_backend_pid() = ANY(pg_blocking_pids(pid))) AS waiting
        `.execute(trx);
            return rows[0]?.waiting;
          },
          { timeout: 10_000 }
        )
        .toBe(true);
    });
    return await pending!;
  } finally {
    await Promise.allSettled([pending]);
    await quality.destroy();
  }
}

postgrestTest(
  "step record and complete-all wait for a newly linked serial hold",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      const job = await serialJob(f, 3);
      await holdUnits(f, true);
      const issue = await raiseIssue(f, 3);
      const allSteps = await steps(f, job.operationId);
      const record = (jobOperationStepId: string, index: number) => ({
        companyId: f.companyId,
        createdBy: USER,
        jobOperationStepId,
        index
      });
      const single = async () =>
        client.from("jobOperationStepRecord").upsert(
          {
            ...record(allSteps[0]!.id, 0),
            booleanValue: true
          },
          { onConflict: "jobOperationStepId, index", ignoreDuplicates: false }
        );
      const override = async () =>
        client.from("jobOperationStepRecord").upsert(
          allSteps.map((step) => record(step.id, 1)),
          { onConflict: "jobOperationStepId, index", ignoreDuplicates: true }
        );
      const first = await duringNewHold(
        link(f, issue, f.prefix + "-unit-1"),
        single
      );
      const second = await duringNewHold(
        link(f, issue, f.prefix + "-unit-2"),
        override
      );
      expect(first.error?.message).toContain("NCR-3");
      expect(second.error?.message).toContain("NCR-3");
      const records = () =>
        f.db
          .selectFrom("jobOperationStepRecord")
          .select(["index", "booleanValue"])
          .where("companyId", "=", f.companyId)
          .orderBy("index")
          .execute();
      await f.db
        .updateTable("nonConformance")
        .set({ status: "Closed" })
        .where("id", "=", issue)
        .execute();
      const reopened = await duringNewHold(
        (trx) =>
          trx
            .updateTable("nonConformance")
            .set({ status: "In Progress" })
            .where("id", "=", issue)
            .execute(),
        single
      );
      expect(reopened.error?.message).toContain("NCR-3");
      expect(await records()).toEqual([]);

      await holdUnits(f, false);
      expect((await single()).error).toBeNull();
      expect((await override()).error).toBeNull();
      expect(await records()).toEqual([
        { index: 0, booleanValue: true },
        { index: 1, booleanValue: null },
        { index: 1, booleanValue: null }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a step committed before Quality's hold survives while its later backflush refuses",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      const job = await serialJob(f, 2);
      await holdUnits(f, true);
      const issue = await raiseIssue(f, 2);
      const [step] = await steps(f, job.operationId);
      const unitId = f.prefix + "-unit-1";
      const record = {
        companyId: f.companyId,
        createdBy: USER,
        jobOperationStepId: step!.id,
        index: 0,
        booleanValue: true
      };
      expect(
        (
          await client
            .from("jobOperationStepRecord")
            .upsert(record, { onConflict: "jobOperationStepId, index" })
        ).error
      ).toBeNull();
      const post = () =>
        invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "partToOperation",
            id: job.operationId,
            materialId: job.materialId,
            itemId: f.partId,
            quantity: 2,
            adjustmentType: "Negative Adjmt.",
            stepRecord: {
              jobOperationStepId: step!.id,
              index: 0,
              trackedEntityId: unitId
            }
          },
          issueMaterial
        );
      const result = await duringNewHold(link(f, issue, unitId), post);
      expect(result.error?.message).toContain("NCR-2");
      const consumption = () =>
        f.db
          .selectFrom("itemLedger")
          .select(["quantity", "itemId"])
          .where("companyId", "=", f.companyId)
          .where("documentId", "=", job.jobId)
          .where("documentType", "=", "Job Consumption")
          .execute();
      expect(await consumption()).toEqual([]);
      expect(
        await f.db
          .selectFrom("jobOperationStepRecord")
          .select("booleanValue")
          .where("jobOperationStepId", "=", step!.id)
          .execute()
      ).toEqual([{ booleanValue: true }]);

      await holdUnits(f, false);
      expect((await post()).error).toBeNull();
      expect(await consumption()).toEqual([{ quantity: -2, itemId: f.partId }]);
    } finally {
      await f.cleanup();
    }
  }
);
