// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

import { expect } from "vitest";
import {
  getOperationTimeDistributions,
  operationKey
} from "../../app/modules/production/operation-time-analysis";
import { alwaysPostFixture, jobFixture, USER } from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

databaseTest(
  "operation times are per unit, with runs beyond the fences set aside",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await jobFixture(f, "1");
      const source = await f.db
        .selectFrom("jobOperation")
        .select(["jobMakeMethodId", "processId"])
        .where("id", "=", job.operationId)
        .executeTakeFirstOrThrow();

      // Seconds per unit of each finished run; the last is a missed clock-out.
      const perUnit = [80, 90, 100, 110, 120, 5000];
      const runs = await f.db
        .insertInto("jobOperation")
        .values(
          perUnit.map((_, i) => ({
            jobId: job.jobId,
            jobMakeMethodId: source.jobMakeMethodId,
            processId: source.processId,
            description: "Weld",
            order: i + 2,
            status: "Done" as const,
            quantityComplete: 2,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .returning("id")
        .execute();
      const start = Date.now() - 86_400_000;
      const event = (jobOperationId: string, seconds: number) => ({
        jobOperationId,
        type: "Labor" as const,
        startTime: new Date(start).toISOString(),
        endTime: new Date(start + seconds * 1000).toISOString(),
        employeeId: USER,
        companyId: f.companyId,
        createdBy: USER
      });
      await f.db
        .insertInto("productionEvent")
        .values([
          ...runs.map((run, i) => event(run.id, perUnit[i]! * 2)),
          // The unfinished fixture operation never counts.
          event(job.operationId, 40)
        ])
        .execute();

      const args = {
        companyId: f.companyId,
        itemId: f.assemblyId,
        type: "Labor" as const,
        groupBy: "operation" as const,
        from: new Date(start - 86_400_000).toISOString(),
        to: new Date().toISOString()
      };
      const [weld, ...others] = await getOperationTimeDistributions(f.db, args);
      expect(others).toEqual([]);
      expect(weld).toMatchObject({
        key: operationKey(source.processId, "Weld"),
        label: "Weld",
        count: 5,
        excluded: 1,
        min: 80,
        q1: 90,
        median: 100,
        q3: 110,
        max: 120,
        mean: 100
      });
      expect(weld!.outliers).toMatchObject([
        { jobId: job.jobId, jobReadableId: "J-1", seconds: 5000 }
      ]);

      const [included] = await getOperationTimeDistributions(f.db, {
        ...args,
        includeOutliers: true
      });
      expect(included).toMatchObject({ count: 6, excluded: 0, max: 5000 });

      const [operator] = await getOperationTimeDistributions(f.db, {
        ...args,
        groupBy: "operator",
        operation: weld!.key
      });
      expect(operator).toMatchObject({ key: USER, count: 5, excluded: 1 });

      // A range that ends before the runs finished holds none of them.
      expect(
        await getOperationTimeDistributions(f.db, { ...args, to: args.from })
      ).toEqual([]);

      // Setup is per run, and none was clocked.
      expect(
        await getOperationTimeDistributions(f.db, { ...args, type: "Setup" })
      ).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
