import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { path } from "~/utils/path";

import { validationError, validator } from "@carbon/form";
import {
  employeeJobValidator,
  getEmployeeJob,
  updateEmployeeJob,
} from "~/modules/people";
import { PersonJob } from "~/modules/people/ui/Person";
import { getCustomFields, setCustomFields } from "~/utils/form";

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
