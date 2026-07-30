import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  EmployeeTypeForm,
  employeeTypePermissionsValidator,
  employeeTypeValidator,
  getEmployeeType,
  getPermissionsByEmployeeType,
  upsertEmployeeType,
  upsertEmployeeTypePermissions
} from "~/modules/users";
import { makeCompanyPermissionsFromEmployeeType } from "~/modules/users/users.server";
import { path } from "~/utils/path";
import { getCompanyId, invalidateUserSelectQueries } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee"
  });

  const { employeeTypeId } = params;
  if (!employeeTypeId) throw notFound("employeeTypeId not found");

  const [employeeType, employeeTypePermissions] = await Promise.all([
    getEmployeeType(client, employeeTypeId),
    getPermissionsByEmployeeType(client, employeeTypeId)
  ]);

  return {
    employeeType: employeeType?.data,
    employeeTypePermissions: makeCompanyPermissionsFromEmployeeType(
      employeeTypePermissions.data ?? [],
      companyId
    )
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  const validation = await validator(employeeTypeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, name, data: permissionData } = validation.data;
  if (!id) throw notFound("id not found");

  const permissions = JSON.parse(permissionData);
  const jsonValidation =
    employeeTypePermissionsValidator.safeParse(permissions);
  if (jsonValidation.success === false) {
    return data(
      {},
      await flash(
        request,
        error(jsonValidation.error, "Failed to parse permissions")
      )
    );
  }

  const updateEmployeeType = await upsertEmployeeType(client, {
    id,
    name
  });

  if (updateEmployeeType.error) {
    return data(
      {},
      await flash(
        request,
        error(updateEmployeeType.error, "Failed to update employee type")
      )
    );
  }

  const updateEmployeeTypePermissions = await upsertEmployeeTypePermissions(
    client,
    id,
    companyId,
    permissions
  );

  if (updateEmployeeTypePermissions.error) {
    return data(
      {},
      await flash(
        request,
        error(
          updateEmployeeTypePermissions.error,
          "Failed to update employee type permissions"
        )
      )
    );
  }

  throw redirect(
    path.to.employeeTypes,
    await flash(request, success("Updated employee type"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateUserSelectQueries(getCompanyId());
  return await serverAction();
}

export default function EditEmployeeTypesRoute() {
  const { employeeType, employeeTypePermissions } =
    useLoaderData<typeof loader>();

  const initialValues = {
    id: employeeType?.id ?? "",
    name: employeeType?.name ?? "",
    permissions: employeeTypePermissions
  };

  return (
    <EmployeeTypeForm
      key={initialValues.id}
      // @ts-expect-error
      initialValues={initialValues}
    />
  );
}
