// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { KyselyDatabase } from "./client.ts";
import { getTimesheetCloseReadiness } from "./timesheet-readiness.ts";

// Runs against the local database, like the authz tests:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- timesheet-readiness
//
// Each test runs inside one transaction that is always rolled back, so it
// writes nothing. The fixtures are inserted with `session_replication_role =
// replica` (FKs and triggers off) so they need no group, location or employee
// type behind them.
const url = process.env.SUPABASE_DB_URL;

describe.skipIf(!url)(
  "getTimesheetCloseReadiness against a migrated database",
  () => {
    const client = new Client({ connectionString: url });
    const db = new Kysely<KyselyDatabase>({
      dialect: new PostgresDialect({
        pool: {
          connect: async () =>
            Object.assign(client, { release: () => undefined }),
          end: async () => undefined
        }
      })
    });

    const suffix = randomUUID().slice(0, 8);
    const companyId = `t-${suffix}-company`;
    const employeeId = `t-${suffix}-employee`;
    const closerId = randomUUID();
    // 2030-01-07 and 2030-01-14 are Mondays, the only shift day.
    const period = {
      companyId,
      startDate: "2030-01-07",
      endDate: "2030-01-20"
    };

    beforeAll(async () => {
      await client.connect();
    });
    afterAll(async () => {
      await client.end();
    });
    afterEach(async () => {
      await client.query("ROLLBACK");
    });

    /** A DCAA company with one Monday-shift employee and one Draft entry on
     *  2030-01-14: one open entry and one missing day (2030-01-07). The closing
     *  user holds `accounting` only, with no `people` or `projects` view. */
    async function begin(mode: "DCAA" | "Standard") {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        `INSERT INTO "company" ("id", "name", "companyGroupId", "baseCurrencyCode", "timezone")
       VALUES ($1, $1, $1, 'USD', 'America/New_York')`,
        [companyId]
      );
      await client.query(
        `INSERT INTO "companySettings" ("id", "timekeepingControls") VALUES ($1, $2)
       ON CONFLICT ("id") DO UPDATE SET "timekeepingControls" = EXCLUDED."timekeepingControls"`,
        [companyId, mode]
      );
      await client.query(
        `INSERT INTO "employee" ("id", "companyId", "employeeTypeId", "active")
       VALUES ($1, $2, 'none', true)`,
        [employeeId, companyId]
      );
      const shift = await client.query<{ id: string }>(
        `INSERT INTO "shift" ("name", "startTime", "endTime", "locationId", "monday", "tuesday",
                            "wednesday", "thursday", "friday", "saturday", "sunday", "companyId", "createdBy")
       VALUES ('Readiness test', '08:00', '16:00', 'none', true, false,
               false, false, false, false, false, $1, 'system')
       RETURNING "id"`,
        [companyId]
      );
      await client.query(
        `INSERT INTO "employeeShift" ("employeeId", "shiftId", "companyId") VALUES ($1, $2, $3)`,
        [employeeId, shift.rows[0]!.id, companyId]
      );
      await client.query(
        `INSERT INTO "timesheetEntry" ("companyId", "employeeId", "entryDate", "projectId",
                                     "laborCategoryId", "hours", "status", "createdBy")
       VALUES ($1, $2, '2030-01-14', 'none', 'none', 8, 'Draft', 'system')`,
        [companyId, employeeId]
      );
      await client.query(
        `INSERT INTO "user" ("id", "email") VALUES ($1, $1 || '@readiness-test.invalid')`,
        [closerId]
      );
      await client.query(
        `INSERT INTO "userToCompany" ("userId", "companyId", "role") VALUES ($1, $2, 'employee')`,
        [closerId, companyId]
      );
      await client.query(
        `INSERT INTO "userPermission" ("id", "permissions")
       VALUES ($1, jsonb_build_object('accounting_view', jsonb_build_array($2::text)))`,
        [closerId, companyId]
      );
      await client.query("SET LOCAL session_replication_role = origin");
    }

    /** What the closing user's own client would count, under its RLS. */
    async function countAsCloser() {
      await client.query(
        `SELECT set_config('request.jwt.claims', jsonb_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [closerId]
      );
      await client.query("SET LOCAL ROLE authenticated");
      try {
        const entries = await client.query<{ count: string }>(
          `SELECT count(*) AS "count" FROM "timesheetEntry" WHERE "companyId" = $1`,
          [companyId]
        );
        const missing = await client.query<{ count: string }>(
          `SELECT count(*) AS "count" FROM get_missing_timesheet_days($1, $2::date, $3::date)`,
          [companyId, period.startDate, period.endDate]
        );
        return Number(entries.rows[0]?.count) + Number(missing.rows[0]?.count);
      } finally {
        await client.query("RESET ROLE");
      }
    }

    it("counts the open entries and the missing days in DCAA mode", async () => {
      await begin("DCAA");
      expect(await getTimesheetCloseReadiness(db, period)).toEqual({
        failing: true,
        count: 2
      });
    });

    it("gives the same count to a closing user without people or projects view", async () => {
      await begin("DCAA");
      // Under its own RLS, the closing user sees no entry and no missing day.
      expect(await countAsCloser()).toBe(0);
      // The check reads with the privileged client, so the count is complete.
      expect(await getTimesheetCloseReadiness(db, period)).toEqual({
        failing: true,
        count: 2
      });
    });

    it("passes in Standard mode", async () => {
      await begin("Standard");
      expect(await getTimesheetCloseReadiness(db, period)).toEqual({
        failing: false,
        count: 0
      });
    });

    it("does not count a Posted entry, and its day is not missing", async () => {
      await begin("DCAA");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        `UPDATE "timesheetEntry" SET "status" = 'Posted' WHERE "companyId" = $1`,
        [companyId]
      );
      await client.query("SET LOCAL session_replication_role = origin");
      // Only 2030-01-07 is left: a missing day.
      expect(await getTimesheetCloseReadiness(db, period)).toEqual({
        failing: true,
        count: 1
      });
    });
  }
);
