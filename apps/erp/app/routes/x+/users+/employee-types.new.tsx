// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { makeEmptyPermissionsFromModules } from "@carbon/ee/permissions.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { EmployeeTypeForm } from "~/modules/users/ui";
import { employeeTypeValidator } from "~/modules/users/users.models";
import { getModules } from "~/modules/users/users.service";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "users"
  });

  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.employeeAccounts,
    feature: "PERMISSIONS"
  });

  const modules = await getModules(client);
  if (modules.error || modules.data === null) {
    throw redirect(
      path.to.employeeTypes,
      await flash(request, error(modules.error, "Failed to get modules"))
    );
  }

  return {
    permissions: makeEmptyPermissionsFromModules(modules.data)
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(employeeTypeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { name, data: permissions } = input.data;
  const api = await carbon(args.request);
  const result = await api.users.createEmployeeType({
    name,
    permissions: JSON.parse(permissions)
  });
  return respond(args.request, result).redirect(path.to.employeeTypes, {
    message: "Employee type created",
    onError: path.to.newEmployeeType
  });
}

export default function NewEmployeeTypesRoute() {
  const { permissions } = useLoaderData<typeof loader>();

  const initialValues = {
    name: "",
    data: "",
    permissions
  };

  return <EmployeeTypeForm initialValues={initialValues} />;
}
