// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, hasPermission } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ActionFunctionArgs,
  data,
  type LoaderFunctionArgs,
  useLoaderData
} from "react-router";
import { timesheetCellValidator } from "~/modules/projects/projects.models";
import {
  getTimesheetWeekView,
  managesEmployee
} from "~/modules/projects/projects.service";
import TimesheetGrid from "~/modules/projects/ui/Timesheet/TimesheetGrid";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "employee-timesheet");

export const handle: Handle = {
  breadcrumb: msg`Timesheet`,
  to: path.to.projectTimesheetApprovals,
  module: "projects"
};

const ACCESS_REFUSED =
  "You can open the timesheet of an employee you manage only";

/**
 * Whether the user may open the employee's timesheet: the employee's manager
 * (`employeeJob.managerId`), or a user with `update: "projects"`.
 */
async function canManageTimesheet(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; employeeId: string }
) {
  if (await managesEmployee(client, args)) return true;
  return hasPermission(
    (await getUserClaims(args.userId, args.companyId))?.permissions,
    "projects",
    "update",
    args.companyId
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "projects"
  });
  const { employeeId } = params;
  if (!employeeId) throw new Error("Could not find employeeId");
  // Your own week is My Time, where you certify it.
  if (employeeId === userId) throw redirect(path.to.timesheet);

  if (!(await canManageTimesheet(client, { companyId, userId, employeeId }))) {
    logger.warn("Refused another employee's timesheet", {
      companyId,
      employeeId
    });
    throw redirect(
      path.to.timesheet,
      await flash(request, error(null, ACCESS_REFUSED))
    );
  }

  const url = new URL(request.url);
  const weekOffset = Number.parseInt(url.searchParams.get("week") ?? "0", 10);
  const [view, employee] = await Promise.all([
    getTimesheetWeekView(client, { companyId, employeeId, weekOffset }),
    client.from("user").select("fullName").eq("id", employeeId).maybeSingle()
  ]);
  if (employee.error) {
    logger.error("Failed to load the employee", {
      companyId,
      error: employee.error
    });
  }

  // The days the employee is recorded absent: the only days a manager can
  // create an entry for them (DCAA supervisor entry). Read after the access
  // check, so the people module's own read permission does not apply.
  const absences = await getDatabaseClient()
    .selectFrom("peopleAbsence")
    .select("date")
    .where("companyId", "=", companyId)
    .where("employeeId", "=", employeeId)
    .where("date", ">=", view.week.weekStart)
    .where("date", "<=", view.week.weekEnd)
    .execute();

  const controls = view.isDcaa
    ? {
        today: view.today,
        windowDays: view.settings?.timesheetEntryWindowDays ?? 0,
        revisedEntryIds: view.revisedEntryIds,
        // Only the employee certifies and reviews.
        certificationText: null,
        pendingReview: []
      }
    : null;

  return {
    ...view.week,
    controls,
    employee: {
      id: employeeId,
      name: employee.data?.fullName ?? "",
      absenceDays: absences.map((absence) => String(absence.date))
    }
  };
}

/**
 * Saves one cell of the employee's week as the manager
 * (`saveTimesheetEntry`, which checks who may change the week). The server
 * function needs a reason, sets the entry to Pending Employee Review, and
 * refuses a new entry on a day with no recorded absence. Answers `{ error }`,
 * which the grid reads. A budget overrun comes back as `warning` and never
 * refuses the entry.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { employeeId } = params;
  if (!employeeId) throw new Error("Could not find employeeId");

  const validation = await validator(timesheetCellValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ?? "The hours are invalid";
    return data({ error: { message } }, { status: 400 });
  }

  const api = await carbon(request);
  const result = await api.projects.saveTimesheetEntry({
    ...validation.data,
    employeeId
  });
  if (result.error) {
    return data(
      { error: { message: result.error.message } },
      { status: result.error.category === "forbidden" ? 403 : 400 }
    );
  }

  const { warning, ...saved } = result.data;
  return data({ error: null, data: saved, warning });
}

export default function EmployeeTimesheetRoute() {
  const data = useLoaderData<typeof loader>();
  return <TimesheetGrid {...data} />;
}
