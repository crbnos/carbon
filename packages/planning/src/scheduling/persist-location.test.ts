// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from "kysely";
import { describe, expect, it } from "vitest";
import {
  jobsClearingReservations,
  persistLocationWrites
} from "./persist-location.ts";

describe("jobsClearingReservations", () => {
  it("is every job the run wrote plus every job that failed, once each", () => {
    expect(
      jobsClearingReservations(
        [{ jobId: "job-a" }, { jobId: "job-b" }],
        ["job-c", "job-a"]
      )
    ).toEqual(["job-a", "job-b", "job-c"]);
  });

  it("still names a failed job when no job wrote", () => {
    expect(jobsClearingReservations([], ["job-c"])).toEqual(["job-c"]);
  });
});

describe("persistLocationWrites", () => {
  // Records every statement; a transaction is run on the same connection.
  // `rowsFor` answers the reads.
  class RecordingDriver extends DummyDriver {
    statements: CompiledQuery[] = [];
    constructor(
      private rowsFor: (query: CompiledQuery) => unknown[] = () => []
    ) {
      super();
    }
    override async acquireConnection(): Promise<DatabaseConnection> {
      return {
        executeQuery: async <R>(query: CompiledQuery) => {
          this.statements.push(query);
          return { rows: this.rowsFor(query) as R[] };
        },
        // biome-ignore lint/correctness/useYield: never streamed
        streamQuery: async function* () {
          throw new Error("not streamed");
        }
      };
    }
  }

  it("clears only a stale mark stamped no later than the run started", async () => {
    const driver = new RecordingDriver();
    const db = new Kysely<DB>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => driver,
        createIntrospector: (k) => new PostgresIntrospector(k),
        createQueryCompiler: () => new PostgresQueryCompiler()
      }
    });
    const runStartedAt = "2026-01-05T10:00:00.000Z";

    await persistLocationWrites(
      db,
      [
        {
          jobId: "job-a",
          jobStatus: "Ready",
          materialLinks: [],
          dependencies: null,
          readyOperationIds: [],
          placements: [],
          reservations: [],
          projectedCompletionAt: "2026-01-06T10:00:00.000Z"
        }
      ],
      { companyId: "co", userId: "u", locationId: "loc", runStartedAt },
      []
    );

    const jobUpdate = driver.statements.find((q) =>
      q.sql.includes('update "job"')
    );
    const sql = jobUpdate?.sql.replace(/\s+/g, " ") ?? "";
    // A mark stamped after the run started (MARK racing this run) survives.
    const kept = (column: string) =>
      new RegExp(
        `"${column}" = case when \\(j\\."scheduleOutdatedAt" is null or j\\."scheduleOutdatedAt" <= \\$(\\d+)::timestamptz\\) then null else j\\."${column}" end`
      );
    const reason = sql.match(kept("scheduleOutdatedReason"));
    const at = sql.match(kept("scheduleOutdatedAt"));
    expect(reason && jobUpdate?.parameters[Number(reason[1]) - 1]).toBe(
      runStartedAt
    );
    expect(at && jobUpdate?.parameters[Number(at[1]) - 1]).toBe(runStartedAt);
  });

  const kysely = (driver: RecordingDriver) =>
    new Kysely<DB>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => driver,
        createIntrospector: (k) => new PostgresIntrospector(k),
        createQueryCompiler: () => new PostgresQueryCompiler()
      }
    });
  const writes = [
    {
      jobId: "job-a",
      jobStatus: "Ready",
      materialLinks: [],
      dependencies: null,
      readyOperationIds: ["op-1"],
      placements: [],
      reservations: [
        {
          resourceKind: "WorkCenter" as const,
          resourceId: "wc1",
          operationId: "op-1",
          startAt: 0,
          endAt: 3_600_000
        }
      ],
      projectedCompletionAt: "2026-01-06T10:00:00.000Z"
    }
  ];
  const runStartedAt = "2026-01-05T10:00:00.000000Z";
  const isLastSavedRead = (q: CompiledQuery) =>
    q.sql.includes('from "locationScheduleRun"');

  // The start of the last run that saved the location: a microsecond after
  // this run's start, one before it, or never saved.
  it.each([
    [
      "a run that started later already saved",
      "2026-01-05T10:00:00.000001Z",
      true
    ],
    [
      "the last saved run started earlier",
      "2026-01-05T09:59:59.999999Z",
      false
    ],
    ["no run has saved the location yet", null, false]
  ])(
    "when %s, the run decides whether to skip its save",
    async (_label, startedAt, skipped) => {
      const driver = new RecordingDriver((q) =>
        isLastSavedRead(q) ? [{ startedAt }] : []
      );

      const result = await persistLocationWrites(
        kysely(driver),
        writes,
        { companyId: "co", userId: "u", locationId: "loc", runStartedAt },
        []
      );

      expect(result).toEqual({ skipped });
      // The check reads the location's last saved start under the location lock.
      const sqls = driver.statements.map((q) => q.sql.replace(/\s+/g, " "));
      const read = driver.statements.findIndex(isLastSavedRead);
      expect(read).toBeGreaterThan(
        sqls.findIndex((q) => q.includes("pg_advisory_xact_lock"))
      );
      expect(driver.statements[read]?.parameters).toEqual(["loc", "co"]);
      const writesAfter = sqls
        .slice(read + 1)
        .filter((q) => /^(update|insert|delete)/i.test(q.trim()))
        .map((q) => q.trim().split(" ").slice(0, 3).join(" "));
      if (skipped) {
        // Nothing: no reservations, ops, jobs or marks, no new start recorded.
        expect(writesAfter).toEqual([]);
      } else {
        expect(writesAfter).toEqual([
          'insert into "locationScheduleRun"',
          'update "jobOperation" set',
          'delete from "capacityReservation"',
          'insert into "capacityReservation"',
          'update "job" as'
        ]);
        const record = driver.statements.find((q) =>
          q.sql.startsWith('insert into "locationScheduleRun"')
        );
        expect(record?.parameters).toEqual([
          "loc",
          "co",
          runStartedAt,
          runStartedAt
        ]);
      }
    }
  );
});
