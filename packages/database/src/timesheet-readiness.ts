// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The "Timesheets complete" close check (Government Contracting 5a). Server
// only: it reads the database. The caller passes the privileged Kysely client,
// so the count does not depend on what the closing user may see: a user
// without `people` or `projects` view gets the same number as an
// administrator. The check reveals only a count, scoped by `companyId`.

import { type Kysely, sql, type Transaction } from "kysely";
import type { KyselyDatabase } from "./client";

/** A timesheet entry in one of these is not posted yet. */
export const OPEN_TIMESHEET_STATUSES = [
  "Draft",
  "Submitted",
  "Approved",
  "Rejected",
  "Pending Employee Review"
] as const;

/**
 * In Standard timekeeping it always passes. In DCAA mode it counts the
 * entries dated in the period that are not Posted, plus the scheduled work
 * days in it with no entry (`get_missing_timesheet_days`).
 */
export async function getTimesheetCloseReadiness(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  args: { companyId: string; startDate: string; endDate: string }
): Promise<{ failing: boolean; count: number }> {
  const { companyId, startDate, endDate } = args;
  const settings = await db
    .selectFrom("companySettings")
    .select("timekeepingControls")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (settings?.timekeepingControls !== "DCAA") {
    return { failing: false, count: 0 };
  }

  const [openEntries, missingDays] = await Promise.all([
    db
      .selectFrom("timesheetEntry")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("companyId", "=", companyId)
      .where("status", "in", [...OPEN_TIMESHEET_STATUSES])
      .where("entryDate", ">=", startDate)
      .where("entryDate", "<=", endDate)
      .executeTakeFirstOrThrow(),
    sql<{ count: string }>`
      SELECT count(*) AS "count"
      FROM get_missing_timesheet_days(${companyId}, ${startDate}::date, ${endDate}::date)
    `.execute(db)
  ]);
  const count =
    Number(openEntries.count) + Number(missingDays.rows[0]?.count ?? 0);
  return { failing: count > 0, count };
}
