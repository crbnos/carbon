import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import type { CompanyPermission } from "~/modules/users";
import {
  EmployeeTypeForm,
  employeeTypePermissionsValidator,
  employeeTypeValidator,
  getModules,
  insertEmployeeType,
  upsertEmployeeTypePermissions
} from "~/modules/users";
import { makeEmptyPermissionsFromModules } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "users"
  });

  const modules = await getModules();
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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    create: "users"
  });

  const validation = await validator(employeeTypeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, data: permissionData } = validation.data;

  const permissions = JSON.parse(permissionData) as {
    name: string;
    permission: CompanyPermission;
  }[];
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

  const createEmployeeType = await insertEmployeeType({
    name,
    companyId
  });
  if (createEmployeeType.error) {
    return data(
      {},
      await flash(
        request,
        error(createEmployeeType.error, "Failed to insert employee type")
      )
    );
  }

  const employeeTypeId = createEmployeeType.data?.id;
  if (!employeeTypeId) {
    return data(
      {},
      await flash(
        request,
        error(createEmployeeType, "Failed to insert employee type")
      )
    );
  }
  const insertEmployeeTypePermissions = await upsertEmployeeTypePermissions(
    employeeTypeId,
    permissions
  );

  if (insertEmployeeTypePermissions.error) {
    return data(
      {},
      await flash(
        request,
        error(
          insertEmployeeTypePermissions.error,
          "Failed to insert employee type permissions"
        )
      )
    );
  }

  throw redirect(
    path.to.employeeTypes,
    await flash(request, success("Employee type created"))
  );
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
