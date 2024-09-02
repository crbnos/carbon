import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  EmployeeTypeForm,
  employeeTypePermissionsValidator,
  employeeTypeValidator,
  getEmployeeType,
  getPermissionsByEmployeeType,
  upsertEmployeeType,
  upsertEmployeeTypePermissions,
} from "~/modules/users";
import { makeCompanyPermissionsFromEmployeeType } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee",
  });

  const { employeeTypeId } = params;
  if (!employeeTypeId) throw notFound("employeeTypeId not found");

  const [employeeType, employeeTypePermissions] = await Promise.all([
    getEmployeeType(client, employeeTypeId),
    getPermissionsByEmployeeType(client, employeeTypeId),
  ]);

  if (employeeType?.data?.protected) {
    throw redirect(
      path.to.employeeTypes,
      await flash(request, error(null, "Cannot edit a protected employee type"))
    );
  }

  return json({
    employeeType: employeeType?.data,
    employeeTypePermissions: makeCompanyPermissionsFromEmployeeType(
      employeeTypePermissions.data ?? [],
      companyId
    ),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "users",
  });

  const validation = await validator(employeeTypeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, name, data } = validation.data;
  if (!id) throw notFound("id not found");

  const permissions = JSON.parse(data);
  const jsonValidation =
    employeeTypePermissionsValidator.safeParse(permissions);
  if (jsonValidation.success === false) {
    return json(
      {},
      await flash(
        request,
        error(jsonValidation.error, "Failed to parse permissions")
      )
    );
  }

  const updateEmployeeType = await upsertEmployeeType(client, {
    id,
    name,
  });

  if (updateEmployeeType.error) {
    return json(
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
    return json(
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

export default function EditEmployeeTypesRoute() {
  const { employeeType, employeeTypePermissions } =
    useLoaderData<typeof loader>();

  const initialValues = {
    id: employeeType?.id ?? "",
    name: employeeType?.name ?? "",
    permissions: employeeTypePermissions,
  };

  return (
    <EmployeeTypeForm
      key={initialValues.id}
      // @ts-expect-error
      initialValues={initialValues}
    />
  );
}
