// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import {
  employeeJobValidator,
  getEmployeeJob,
  updateEmployeeJob
} from "~/modules/people";
import { PersonJob } from "~/modules/people/ui/Person";
import { notifyScheduleInputsChanged } from "~/modules/production";
import { getDatabaseClient } from "~/services/database.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  // Project time and field service add fields to a job, shown only once the
  // company uses them: a labor category, a service order.
  const [job, laborCategories, serviceOrders] = await Promise.all([
    getEmployeeJob(client, personId, companyId),
    client
      .from("laborCategory")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId),
    client
      .from("serviceOrder")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
  ]);
  if (job.error) {
    throw redirect(
      path.to.people,
      await flash(request, error(job.error, "Failed to load job"))
    );
  }

  return {
    job: job.data,
    usesProjectTime: (laborCategories.count ?? 0) > 0,
    usesFieldService: (serviceOrders.count ?? 0) > 0
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "people"
  });
  const { personId } = params;
  if (!personId) throw new Error("No person ID provided");

  const formData = await request.formData();
  const validation = await validator(employeeJobValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateJob = await updateEmployeeJob(getDatabaseClient(), personId, {
    ...validation.data,
    // This form always renders both switches, and an unchecked switch posts
    // nothing — so here a missing value is "off". (The validator keeps them
    // optional for API callers, where a missing value keeps the stored flag.)
    isOfficer: validation.data.isOfficer ?? false,
    timesheetRequired: validation.data.timesheetRequired ?? false,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateJob.error) {
    throw redirect(
      path.to.personJob(personId),
      await flash(request, error(updateJob.error, "Failed to update job"))
    );
  }

  await notifyScheduleInputsChanged(
    companyId,
    "employee-shift",
    "Shift assignment changed"
  );

  throw redirect(
    path.to.personJob(personId),
    await flash(request, success("Successfully updated job"))
  );
}

export default function PersonJobRoute() {
  const { job, usesProjectTime, usesFieldService } =
    useLoaderData<typeof loader>();
  const { personId } = useParams();

  const initialValues = {
    title: job.title ?? "",
    startDate: job.startDate ?? "",
    locationId: job.locationId ?? "",
    shiftId: job.shiftId ?? "",
    departmentId: job.departmentId ?? "",
    managerId: job.managerId ?? "",
    laborCategoryId: job.laborCategoryId ?? "",
    defaultStorageUnitId: job.defaultStorageUnitId ?? "",
    flsaStatus: job.flsaStatus ?? undefined,
    isOfficer: job.isOfficer ?? false,
    timesheetRequired: job.timesheetRequired ?? true,
    ...getCustomFields(job.customFields)
  };

  return (
    <PersonJob
      key={personId}
      initialValues={initialValues}
      usesProjectTime={usesProjectTime}
      usesFieldService={usesFieldService}
    />
  );
}
