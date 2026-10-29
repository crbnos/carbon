// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// Reordering a job's operations is one statement scoped to the job. It used to
// be one UPDATE per operation, so a reorder that failed halfway left the job
// with half of its new order.

import { databaseTest } from "./fixtures/local-database";
import { expect } from "vitest";
import { updateJobOperationOrder } from "../../app/modules/production/production.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  USER
} from "./fixtures/always-post";

async function orders(f: Fixture, jobId: string) {
  const rows = await f.db
    .selectFrom("jobOperation")
    .select(["id", "order"])
    .where("jobId", "=", jobId)
    .where("companyId", "=", f.companyId)
    .execute();
  return Object.fromEntries(rows.map((row) => [row.id, Number(row.order)]));
}

databaseTest(
  "a job's operations are reordered together, or not at all",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await jobFixture(f, "1");
      const otherJob = await jobFixture(f, "2");
      const first = await f.db
        .selectFrom("jobOperation")
        .select(["jobMakeMethodId", "processId"])
        .where("id", "=", job.operationId)
        .executeTakeFirstOrThrow();
      const [second, third] = await f.db
        .insertInto("jobOperation")
        .values(
          ["Inspect", "Pack"].map((description, i) => ({
            jobId: job.jobId,
            jobMakeMethodId: first.jobMakeMethodId,
            processId: first.processId,
            description,
            order: i + 2,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .returning("id")
        .execute();

      await updateJobOperationOrder(f.db, f.companyId, USER, job.jobId, [
        { id: job.operationId, sortOrder: 3 },
        { id: second.id, sortOrder: 1 },
        { id: third.id, sortOrder: 2 }
      ]);
      const reordered = {
        [job.operationId]: 3,
        [second.id]: 1,
        [third.id]: 2
      };
      expect(await orders(f, job.jobId)).toEqual(reordered);

      // Another job's operation in the list refuses the whole reorder.
      await expect(
        updateJobOperationOrder(f.db, f.companyId, USER, job.jobId, [
          { id: second.id, sortOrder: 10 },
          { id: otherJob.operationId, sortOrder: 11 }
        ])
      ).rejects.toThrow("1 of 2 rows are not on this document");
      expect(await orders(f, job.jobId)).toEqual(reordered);
      expect(await orders(f, otherJob.jobId)).toEqual({
        [otherJob.operationId]: 1
      });
    } finally {
      await f.cleanup();
    }
  }
);
