import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import type { CompanyPermission } from "~/modules/users";
import {
  EmployeeTypeForm,
  employeeTypePermissionsValidator,
  employeeTypeValidator,
  getModules,
  insertEmployeeType,
  upsertEmployeeTypePermissions,
} from "~/modules/users";
import { makeEmptyPermissionsFromModules } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    create: "users",
  });

  const modules = await getModules(client);
  if (modules.error || modules.data === null) {
    throw redirect(
      path.to.employeeTypes,
      await flash(request, error(modules.error, "Failed to get modules"))
    );
  }

  return json({
    permissions: makeEmptyPermissionsFromModules(modules.data),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "users",
  });

  const validation = await validator(employeeTypeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, data } = validation.data;

  const permissions = JSON.parse(data) as {
    name: string;
    permission: CompanyPermission;
  }[];
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

  const createEmployeeType = await insertEmployeeType(client, {
    name,
    companyId,
  });
  if (createEmployeeType.error) {
    return json(
      {},
      await flash(
        request,
        error(createEmployeeType.error, "Failed to insert employee type")
      )
    );
  }

  const employeeTypeId = createEmployeeType.data?.id;
  if (!employeeTypeId) {
    return json(
      {},
      await flash(
        request,
        error(createEmployeeType, "Failed to insert employee type")
      )
    );
  }
  const insertEmployeeTypePermissions = await upsertEmployeeTypePermissions(
    client,
    employeeTypeId,
    companyId,
    permissions
  );

  if (insertEmployeeTypePermissions.error) {
    return json(
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
    permissions,
  };

  return <EmployeeTypeForm initialValues={initialValues} />;
}
