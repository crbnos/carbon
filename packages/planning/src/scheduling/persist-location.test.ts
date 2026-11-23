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
  class RecordingDriver extends DummyDriver {
    statements: CompiledQuery[] = [];
    override async acquireConnection(): Promise<DatabaseConnection> {
      return {
        executeQuery: async <R>(query: CompiledQuery) => {
          this.statements.push(query);
          return { rows: [] as R[] };
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
});
