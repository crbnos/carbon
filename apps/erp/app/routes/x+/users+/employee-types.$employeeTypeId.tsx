// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, carbonFor, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { EmployeeTypeForm } from "~/modules/users/ui";
import { employeeTypeValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "users",
    role: "employee"
  });
  const { client, companyId } = auth;
  const api = carbonFor(auth);

  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.employeeAccounts,
    feature: "PERMISSIONS"
  });

  const { employeeTypeId } = params;
  if (!employeeTypeId) throw notFound("employeeTypeId not found");

  const [employeeType, grants] = await Promise.all([
    api.users.getEmployeeType({ employeeTypeId }),
    api.users.getAccessGrants({
      subjectType: "role",
      subjectId: employeeTypeId
    })
  ]);

  return {
    employeeType: employeeType?.data,
    grants: grants.data ?? []
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(employeeTypeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id, name, data: grants } = input.data;
  if (!id) throw notFound("id not found");
  const api = await carbon(args.request);
  const result = await api.users.updateEmployeeType({
    id,
    name,
    grants: JSON.parse(grants)
  });
  return respond(args.request, result).redirect(path.to.employeeTypes, {
    message: "Updated employee type",
    onError: path.to.employeeType(id)
  });
}

export default function EditEmployeeTypesRoute() {
  const { employeeType, grants } = useLoaderData<typeof loader>();

  const initialValues = {
    id: employeeType?.id ?? "",
    name: employeeType?.name ?? "",
    grants
  };

  return (
    <EmployeeTypeForm key={initialValues.id} initialValues={initialValues} />
  );
}
