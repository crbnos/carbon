// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

import { expect } from "vitest";
import {
  getOperationRuns,
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

      // Seconds per unit of each finished run. Weld's last run is a missed
      // clock-out; Pack has no spread, so its odd run is not an outlier.
      const weld = [80, 90, 100, 110, 120, 5000];
      const pack = [50, 50, 50, 50, 51];
      const runs = await f.db
        .insertInto("jobOperation")
        .values(
          // The seventh Weld run is the one two operators shared.
          [...weld, 100, ...pack].map((_, i) => ({
            jobId: job.jobId,
            jobMakeMethodId: source.jobMakeMethodId,
            processId: source.processId,
            description: i <= weld.length ? "Weld" : "Pack",
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
      const event = (
        jobOperationId: string,
        seconds: number,
        employeeId: string | null = USER
      ) => ({
        jobOperationId,
        type: "Labor" as const,
        startTime: new Date(start).toISOString(),
        endTime: new Date(start + seconds * 1000).toISOString(),
        employeeId,
        companyId: f.companyId,
        createdBy: USER
      });
      const shared = runs[weld.length]!;
      await f.db
        .insertInto("productionEvent")
        .values([
          ...weld.map((perUnit, i) => event(runs[i]!.id, perUnit * 2)),
          // Half the shared run's time names no operator.
          event(shared.id, 100),
          event(shared.id, 100, null),
          ...pack.map((perUnit, i) =>
            event(runs[weld.length + 1 + i]!.id, perUnit * 2)
          ),
          // The unfinished fixture operation never counts.
          event(job.operationId, 40)
        ])
        .execute();

      const args = {
        companyId: f.companyId,
        itemId: f.assemblyId,
        type: "Labor" as const,
        from: new Date(start - 86_400_000).toISOString(),
        to: new Date().toISOString()
      };
      const key = operationKey(source.processId, "Weld");
      const { operations, versions, operators } =
        await getOperationTimeDistributions(f.db, { ...args, operation: key });

      expect(operations).toMatchObject([
        {
          key,
          label: "Weld",
          count: 6,
          excluded: 1,
          min: 80,
          q1: 92.5,
          median: 100,
          q3: 107.5,
          max: 120,
          mean: 100,
          outliers: [{ jobId: job.jobId, jobReadableId: "J-1", seconds: 5000 }]
        },
        { label: "Pack", count: 5, excluded: 0, max: 51, outliers: [] }
      ]);
      expect(versions).toMatchObject([{ count: 6, excluded: 1, outliers: [] }]);
      // The shared run is no one operator's.
      expect(operators).toMatchObject([{ key: USER, count: 5, excluded: 1 }]);

      const unselected = await getOperationTimeDistributions(f.db, args);
      expect(unselected.operations).toHaveLength(2);
      expect(unselected.versions).toEqual([]);
      expect(unselected.operators).toEqual([]);

      const included = await getOperationTimeDistributions(f.db, {
        ...args,
        includeOutliers: true
      });
      expect(included.operations[0]).toMatchObject({
        count: 7,
        excluded: 0,
        max: 5000
      });

      // Oldest first: the shared run's two 100-second events end before the rest.
      const plotted = await getOperationRuns(f.db, { ...args, operation: key });
      expect(plotted.map((run) => run.seconds)).toEqual([
        100, 80, 90, 100, 110, 120
      ]);
      expect(plotted[1]).toMatchObject({
        jobId: job.jobId,
        version: versions[0]!.version,
        outlier: false,
        endedAt: new Date(start + 160_000).toISOString()
      });
      const everyRun = await getOperationRuns(f.db, {
        ...args,
        operation: key,
        includeOutliers: true
      });
      expect(everyRun.at(-1)).toMatchObject({ seconds: 5000, outlier: true });

      // A range that ends before the runs finished holds none of them.
      expect(
        (await getOperationTimeDistributions(f.db, { ...args, to: args.from }))
          .operations
      ).toEqual([]);

      // Setup is per run, and none was clocked.
      expect(
        (await getOperationTimeDistributions(f.db, { ...args, type: "Setup" }))
          .operations
      ).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
