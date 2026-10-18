// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { EmployeeTypeForm } from "~/modules/users/ui";
import { employeeTypeValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    create: "users"
  });
  const { client, companyId } = auth;
  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.employeeAccounts,
    feature: "PERMISSIONS"
  });
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(employeeTypeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { name, data: grants } = input.data;
  const api = await carbon(args.request);
  const result = await api.users.createEmployeeType({
    name,
    grants: JSON.parse(grants)
  });
  return respond(args.request, result).redirect(path.to.employeeTypes, {
    message: "Employee type created",
    onError: path.to.newEmployeeType
  });
}

export default function NewEmployeeTypesRoute() {
  return <EmployeeTypeForm initialValues={{ name: "", grants: [] }} />;
}
