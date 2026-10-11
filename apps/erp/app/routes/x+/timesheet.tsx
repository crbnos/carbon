// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getLaborCategoriesList,
  getPendingReviewEntries,
  getTimesheetWeek,
  groupTimesheetRows
} from "~/modules/projects";
import TimesheetGrid from "~/modules/projects/ui/Timesheet/TimesheetGrid";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "timesheet");

// My Timesheet is personal: it sits outside the Projects and Service modules
// and needs only an employee role. It shows the user's time of every project
// type; a service order's rows are read-only (the visit page posts them).
export const handle: Handle = {
  breadcrumb: msg`My Timesheet`,
  to: path.to.timesheet
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const url = new URL(request.url);
  const weekOffset = Number.parseInt(url.searchParams.get("week") ?? "0", 10);
  const offset = Number.isFinite(weekOffset) ? weekOffset : 0;

  // The week runs Monday to Sunday on the company calendar, as the timecard
  // does, so the two line up day by day.
  const timeZone = await getCompanyTimeZone(client, companyId);
  const { from, to } = datetime.weekBounds(timeZone, offset);
  const weekStart = datetime.businessDay(from, timeZone).toString();
  const weekEnd = datetime.businessDay(to, timeZone).toString();
  const monday = parseDate(weekStart);
  const days = Array.from({ length: 7 }, (_, index) =>
    monday.add({ days: index }).toString()
  );

  const [entries, timecard, laborCategories, settings, job, pendingReview] =
    await Promise.all([
      getTimesheetWeek(client, {
        companyId,
        employeeId: userId,
        from: weekStart,
        to: weekEnd
      }),
      client
        .from("timeCardEntry")
        .select("clockIn, clockOut")
        .eq("employeeId", userId)
        .eq("companyId", companyId)
        .gte("clockIn", from)
        .lte("clockIn", to),
      getLaborCategoriesList(client, companyId),
      getCompanySettings(client, companyId),
      client
        .from("employeeJob")
        .select("flsaStatus")
        .eq("id", userId)
        .eq("companyId", companyId)
        .maybeSingle(),
      getPendingReviewEntries(client, { companyId, employeeId: userId })
    ]);

  if (entries.error) {
    logger.error("Failed to load the timesheet", {
      companyId,
      error: entries.error
    });
  }
  if (timecard.error) {
    logger.error("Failed to load the timecard", {
      companyId,
      error: timecard.error
    });
  }
  if (laborCategories.error) {
    logger.error("Failed to load labor categories", {
      companyId,
      error: laborCategories.error
    });
  }
  if (settings.error) {
    logger.error("Failed to load company settings", {
      companyId,
      error: settings.error
    });
  }
  if (job.error) {
    logger.error("Failed to load the employee job", {
      companyId,
      error: job.error
    });
  }
  if (pendingReview.error) {
    logger.error("Failed to load the entries to review", {
      companyId,
      error: pendingReview.error
    });
  }

  // DCAA mode (5a): the entry window, the certification text for the
  // employee's FLSA status, and the cells that have a correction trail.
  const isDcaa = settings.data?.timekeepingControls === "DCAA";
  let revisedEntryIds: string[] = [];
  const entryIds = (entries.data ?? []).map((entry) => entry.id);
  if (isDcaa && entryIds.length > 0) {
    const revised = await client
      .from("timesheetEntryRevision")
      .select("timesheetEntryId")
      .eq("companyId", companyId)
      .in("timesheetEntryId", entryIds);
    if (revised.error) {
      logger.error("Failed to load the timesheet revisions", {
        companyId,
        error: revised.error
      });
    }
    revisedEntryIds = [
      ...new Set((revised.data ?? []).map((row) => row.timesheetEntryId))
    ];
  }
  const controls = isDcaa
    ? {
        today: datetime.today(timeZone).toString(),
        windowDays: settings.data?.timesheetEntryWindowDays ?? 0,
        revisedEntryIds,
        certificationText:
          (job.data?.flsaStatus === "Exempt"
            ? settings.data?.certificationTextExempt
            : settings.data?.certificationTextNonExempt) ?? null,
        pendingReview: pendingReview.data ?? []
      }
    : null;

  // Hours clocked per day: each closed clock entry counts on the day it
  // started. Comparing two stored instants needs no time zone.
  const timecardHours: Record<string, number> = {};
  for (const entry of timecard.data ?? []) {
    if (!entry.clockOut) continue;
    const day = datetime.businessDay(entry.clockIn, timeZone).toString();
    const hours =
      (Date.parse(entry.clockOut) - Date.parse(entry.clockIn)) / 3_600_000;
    timecardHours[day] = (timecardHours[day] ?? 0) + Math.max(hours, 0);
  }

  return {
    weekOffset: offset,
    weekStart,
    weekEnd,
    days,
    rows: groupTimesheetRows(entries.data ?? []),
    timecardHours,
    laborCategories: laborCategories.data ?? [],
    controls
  };
}

export default function TimesheetRoute() {
  const data = useLoaderData<typeof loader>();
  return <TimesheetGrid {...data} />;
}
