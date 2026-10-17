// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { employeeJobValidator } from "~/modules/people/people.models";
import { getEmployeeJob } from "~/modules/people/people.service";
import { PersonJob } from "~/modules/people/ui/Person";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
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

  return {
    job: job.data
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(employeeJobValidator).request(args, {
    params: ["personId"]
  });
  if ("invalid" in input) return input.invalid;
  const { personId } = input.params;
  const api = await carbon(args.request);
  const result = await api.people.updatePersonJob({
    ...input.data,
    employeeId: personId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(path.to.personJob(personId), {
    message: "Successfully updated job"
  });
}

export default function PersonJobRoute() {
  const { job } = useLoaderData<typeof loader>();
  const { personId } = useParams();

  const initialValues = {
    title: job.title ?? "",
    startDate: job.startDate ?? "",
    locationId: job.locationId ?? "",
    shiftId: job.shiftId ?? "",
    departmentId: job.departmentId ?? "",
    managerId: job.managerId ?? "",
    ...getCustomFields(job.customFields)
  };

  return <PersonJob key={personId} initialValues={initialValues} />;
}
