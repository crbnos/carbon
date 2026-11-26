// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getProcessPool, type KyselyDatabase } from "@carbon/database/client";
import { Kysely, PostgresDialect, sql } from "kysely";
import { beforeAll, describe, expect, it } from "vitest";
import { newestRunSaves, utcInstant } from "./run-order.ts";

describe("newestRunSaves", () => {
  const start = "2026-11-25T10:00:00.000002Z";

  it("skips the save when a run that started later has saved", () => {
    expect(newestRunSaves(start, "2026-11-25T10:00:00.000003Z")).toBe(false);
  });

  it("saves when the last saved run started earlier", () => {
    expect(newestRunSaves(start, "2026-11-25T10:00:00.000001Z")).toBe(true);
  });

  it("saves when no run has saved yet", () => {
    expect(newestRunSaves(start, null)).toBe(true);
  });
});

// The decision compares the database's text as strings, which orders as the
// instants do only if utcInstant keeps every microsecond in one UTC form.
// Runs against the local database:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/planning test -- src/run-order
describe.skipIf(!process.env.SUPABASE_DB_URL)(
  "utcInstant against the database",
  () => {
    // Built in beforeAll (the pool reads SUPABASE_DB_URL), never destroyed:
    // that would end the process pool.
    let db: Kysely<KyselyDatabase>;
    beforeAll(() => {
      db = new Kysely<KyselyDatabase>({
        dialect: new PostgresDialect({ pool: getProcessPool() })
      });
    });

    it("orders instants a microsecond apart in any session time zone", async () => {
      const { rows } = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL TimeZone = 'Asia/Kolkata'`.execute(trx);
        return sql<{ earlier: string; later: string }>`
          SELECT
            ${utcInstant(sql`'2026-11-25 05:00:00.999999-05'::timestamptz`)} AS "earlier",
            ${utcInstant(sql`'2026-11-25 11:01:00.000000+01'::timestamptz`)} AS "later"
        `.execute(trx);
      });
      expect(rows[0]).toEqual({
        earlier: "2026-11-25T10:00:00.999999Z",
        later: "2026-11-25T10:01:00.000000Z"
      });
      expect(newestRunSaves(rows[0]!.earlier, rows[0]!.later)).toBe(false);
    });

    it("reads back the same instant it is written as", async () => {
      const { rows } = await sql<{ roundTrip: boolean }>`
        SELECT ${utcInstant(sql`now()`)}::timestamptz = now() AS "roundTrip"
      `.execute(db);
      expect(rows[0]).toEqual({ roundTrip: true });
    });
  }
);
