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

    return step.run("check-in", () =>
      checkIn(async () => {
        // A seat is a distinct employee across all companies, without Carbon
        // staff. Customer and supplier portal users are not seats.
        const { rows } = await sql<{
          seatsUsed: number;
          companiesCount: number;
        }>`
          select
            (select count(distinct u."id")::int
               from "userToCompany" utc
               join "user" u on u."id" = utc."userId"
              where utc."role" = 'employee'
                and u."email" not ilike '%@carbon.ms') as "seatsUsed",
            (select count(*)::int from "company") as "companiesCount"
        `.execute(getJobDatabaseClient());
        return rows[0] ?? { seatsUsed: 0, companiesCount: 0 };
      })
    );
  }
);
