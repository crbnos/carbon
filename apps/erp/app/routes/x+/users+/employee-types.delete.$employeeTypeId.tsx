// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, api } = await authorize(request, {
    "users.employeeTypes": "View"
  });

  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.employeeAccounts,
    feature: "PERMISSIONS"
  });

  const { employeeTypeId } = params;
  if (!employeeTypeId) throw notFound("EmployeeTypeId not found");

  const employeeType = await api.users.getEmployeeType({ employeeTypeId });
  if (employeeType.error) {
    throw redirect(
      path.to.employeeTypes,
      await flash(
        request,
        error(employeeType.error, "Failed to get employee type")
      )
    );
  }

  return {
    employeeType: employeeType.data
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["employeeTypeId"]
  });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.users.deleteEmployeeType({
    id: input.params.employeeTypeId
  });
  return respond(args.request, result).redirect(path.to.employeeTypes, {
    message: "Successfully deleted employee type"
  });
}

export default function DeleteEmployeeTypeRoute() {
  const { employeeTypeId } = useParams();
  const { employeeType } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog(path.to.employeeTypes);
  const { t } = useLingui();

  if (!employeeType) return null;
  if (!employeeTypeId) throw new Error("employeeTypeId is not found");

  return (
    <ConfirmDelete
      action={path.to.deleteEmployeeType(employeeTypeId)}
      name={employeeType.name}
      text={t`Are you sure you want to delete the employee type: ${employeeType.name}? This cannot be undone.`}
      isOpen={dialog.open}
      onCancel={dialog.close}
    />
  );
}
