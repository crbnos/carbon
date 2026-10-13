// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { certificationTextFor } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getPendingReviewEntries } from "~/modules/projects";
import { getTimesheetWeekView } from "~/modules/projects/projects.server";
import TimesheetGrid from "~/modules/projects/ui/Timesheet/TimesheetGrid";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "timesheet");

// My Time is personal: it sits outside the Projects and Service modules
// and needs only an employee role. It shows the user's time of every project
// type; a service order's rows are read-only (the visit page posts them).
export const handle: Handle = {
  breadcrumb: msg`My Time`,
  to: path.to.timesheet
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const url = new URL(request.url);
  const weekOffset = Number.parseInt(url.searchParams.get("week") ?? "0", 10);

  const [view, job, pendingReview] = await Promise.all([
    getTimesheetWeekView(client, {
      companyId,
      employeeId: userId,
      weekOffset
    }),
    client
      .from("employeeJob")
      .select("flsaStatus")
      .eq("id", userId)
      .eq("companyId", companyId)
      .maybeSingle(),
    getPendingReviewEntries(client, { companyId, employeeId: userId })
  ]);
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
  // employee's FLSA status, and the changes waiting for the employee.
  const controls = view.isDcaa
    ? {
        today: view.today,
        windowDays: view.settings?.timesheetEntryWindowDays ?? 0,
        revisedEntryIds: view.revisedEntryIds,
        certificationText: certificationTextFor(
          job.data?.flsaStatus,
          view.settings
        ),
        pendingReview: pendingReview.data ?? []
      }
    : null;

  return { ...view.week, controls };
}

export default function TimesheetRoute() {
  const data = useLoaderData<typeof loader>();
  return <TimesheetGrid {...data} />;
}
