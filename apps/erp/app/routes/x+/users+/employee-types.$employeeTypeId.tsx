// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { actionsGained, pageById } from "@carbon/database/access";
import { requireFeature } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { EmployeeTypeForm } from "~/modules/users/ui";
import { employeeTypeValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, api } = await authorize(request, {
    view: "users",
    role: "employee"
  });

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

  const rows = grants.data ?? [];
  return {
    employeeType: employeeType?.data,
    grants: rows,
    convertedGrowth: rows.flatMap((row) => {
      const gained = actionsGained(row.level, row.convertedFrom);
      if (gained.length === 0) return [];
      const id = row.page ?? row.module.toLowerCase();
      return [
        { label: pageById(id)?.label ?? row.module, level: row.level, gained }
      ];
    })
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(employeeTypeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id, name, data: grants } = input.data;
  if (!id) throw notFound("id not found");
  const { api } = await authorize(args.request);
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
  const { employeeType, grants, convertedGrowth } =
    useLoaderData<typeof loader>();

  const initialValues = {
    id: employeeType?.id ?? "",
    name: employeeType?.name ?? "",
    grants
  };

  return (
    <EmployeeTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      convertedGrowth={convertedGrowth}
    />
  );
}
