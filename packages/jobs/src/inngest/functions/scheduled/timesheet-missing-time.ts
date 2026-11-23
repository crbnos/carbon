// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The daily missing-time check (Government Contracting 5a). In DCAA
// timekeeping mode every employee enters time each day. Each morning this
// notifies the employees who entered none for yesterday, and their managers.
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5a.md (Task 29).

import type { Events } from "@carbon/lib/events";
import { NotificationEvent } from "@carbon/notifications";
import { formatDate } from "@carbon/utils";
import { sql } from "kysely";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

export type MissingTimeRow = {
  companyId: string;
  employeeId: string;
  /** `YYYY-MM-DD`: yesterday on the company's calendar. */
  date: string;
  managerId: string | null;
  employeeName: string | null;
};

type NotifyEvent = {
  name: "carbon/notify";
  data: Events["carbon/notify"]["data"];
};

// One send carries at most 512 KB; a notice is a few hundred bytes.
const SEND_CHUNK = 500;

/**
 * One notice per employee ("No time entered for <date>") and one per manager,
 * naming their employees. A manager who is also on the list gets both.
 */
export function buildMissingTimeEvents(rows: MissingTimeRow[]): NotifyEvent[] {
  const events: NotifyEvent[] = [];
  const byManager = new Map<
    string,
    { companyId: string; managerId: string; date: string; names: string[] }
  >();

  for (const row of rows) {
    const day = formatDate(row.date);
    events.push({
      name: "carbon/notify",
      data: {
        event: NotificationEvent.TimesheetMissing,
        companyId: row.companyId,
        documentId: row.date,
        recipient: { type: "users", userIds: [row.employeeId] },
        body: `No time entered for ${day}`
      }
    });

    if (!row.managerId || row.managerId === row.employeeId) continue;
    const key = `${row.companyId}|${row.managerId}|${row.date}`;
    const group = byManager.get(key) ?? {
      companyId: row.companyId,
      managerId: row.managerId,
      date: row.date,
      names: []
    };
    group.names.push(row.employeeName ?? row.employeeId);
    byManager.set(key, group);
  }

  for (const group of byManager.values()) {
    events.push({
      name: "carbon/notify",
      data: {
        event: NotificationEvent.TimesheetMissing,
        companyId: group.companyId,
        documentId: group.date,
        recipient: { type: "users", userIds: [group.managerId] },
        body: `No time entered for ${formatDate(group.date)}: ${group.names
          .sort((a, b) => a.localeCompare(b))
          .join(", ")}`
      }
    });
  }

  return events;
}

export const timesheetMissingTimeFunction = inngest.createFunction(
  // Woken by the database, not the clock: pg_cron asks each day at 12:00 UTC
  // whether any company runs DCAA timekeeping
  // (`util.timesheet_missing_time_has_work`) and only then sends this event.
  { id: "timesheet-missing-time", retries: 2, concurrency: { limit: 1 } },
  { event: "carbon/timesheet-missing-time.process" },
  async ({ step }) => {
    // One query: every DCAA company, yesterday on its own calendar
    // (`company_today`), and the scheduled days with no entry.
    const rows = await step.run("find-missing-time", async () => {
      const { rows } = await sql<MissingTimeRow>`
        SELECT
          cs."id" AS "companyId",
          m."employeeId",
          m."date"::text AS "date",
          m."managerId",
          u."fullName" AS "employeeName"
        FROM "companySettings" cs
        CROSS JOIN LATERAL get_missing_timesheet_days(
          cs."id",
          company_today(cs."id") - 1,
          company_today(cs."id") - 1
        ) m
        LEFT JOIN "user" u ON u."id" = m."employeeId"
        WHERE cs."timekeepingControls" = 'DCAA'
        ORDER BY cs."id", m."employeeId"
      `.execute(getJobDatabaseClient());
      return rows;
    });

    const events = buildMissingTimeEvents(rows);
    for (let index = 0; index * SEND_CHUNK < events.length; index++) {
      await step.sendEvent(
        `notify-missing-time-${index}`,
        events.slice(index * SEND_CHUNK, (index + 1) * SEND_CHUNK)
      );
    }

    return { missing: rows.length, notices: events.length };
  }
);
