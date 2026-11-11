// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { checkIn } from "@carbon/ee/license/check-in.server";
import { CarbonEdition } from "@carbon/env";
import { Edition } from "@carbon/utils";
import { sql } from "kysely";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

/**
 * Hourly; the check-in itself acts once a day, or on its back-off schedule
 * after a failure. Enterprise only: Cloud and Community read no licence.
 */
export const licenseCheckInFunction = inngest.createFunction(
  { id: "license-check-in", retries: 0 },
  { cron: "7 * * * *" },
  async ({ step }) => {
    if (CarbonEdition !== Edition.Enterprise) return { skipped: "edition" };

    const counts = await step.run("count", async () => {
      const db = getJobDatabaseClient();
      // A seat is a distinct employee across all companies, without Carbon
      // staff. Customer and supplier portal users are not seats, as
      // in billing.
      const seats = await sql<{ n: number }>`
        select count(distinct u."id")::int as n
        from "userToCompany" utc
        join "user" u on u."id" = utc."userId"
        where utc."role" = 'employee'
          and u."email" not ilike '%@carbon.ms'
      `.execute(db);
      const companies = await sql<{ n: number }>`
        select count(*)::int as n from "company"
      `.execute(db);
      return {
        seatsUsed: seats.rows[0]?.n ?? 0,
        companiesCount: companies.rows[0]?.n ?? 0
      };
    });

    return step.run("check-in", () => checkIn(counts));
  }
);
