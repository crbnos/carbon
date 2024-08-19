import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

import { validationError, validator } from "@carbon/remix-validated-form";
import {
  PersonJob,
  employeeJobValidator,
  getEmployeeJob,
  updateEmployeeJob,
} from "~/modules/people";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people",
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const job = await getEmployeeJob(client, personId, companyId);
  if (job.error) {
    throw redirect(
      path.to.people,
      await flash(request, error(job.error, "Failed to load job"))
    );
  }

  return json({
    job: job.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "people",
  });
  const { personId } = params;
  if (!personId) throw new Error("No person ID provided");

  const formData = await request.formData();
  const validation = await validator(employeeJobValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateJob = await updateEmployeeJob(client, personId, {
    ...validation.data,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateJob.error) {
    throw redirect(
      path.to.personJob(personId),
      await flash(request, error(updateJob.error, "Failed to update job"))
    );
  }

  throw redirect(
    path.to.personJob(personId),
    await flash(request, success("Successfully updated job"))
  );
}

export default function PersonJobRoute() {
  const { job } = useLoaderData<typeof loader>();
  const { personId } = useParams();

  const initialValues = {
    title: job.title ?? "",
    startDate: job.startDate ?? "",
    locationId: job.locationId ?? "",
    shiftId: job.shiftId ?? "",
    managerId: job.managerId ?? "",
    ...getCustomFields(job.customFields),
  };

  return <PersonJob key={personId} initialValues={initialValues} />;
}
