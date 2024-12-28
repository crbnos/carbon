import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  notFound,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import type { CompanyPermission } from "~/modules/users";
import {
  EmployeePermissionsForm,
  employeeValidator,
  getEmployee,
  getEmployeeTypes,
  userPermissionsValidator,
} from "~/modules/users";
import {
  getClaims,
  makeCompanyPermissionsFromClaims,
  updateEmployee,
} from "~/modules/users/users.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee",
  });

  const { employeeId } = params;
  if (!employeeId) throw notFound("employeeId not found");

  const client = getCarbonServiceRole();
  const [rawClaims, employee, employeeTypes] = await Promise.all([
    getClaims(client, employeeId, companyId),
    getEmployee(client, employeeId, companyId),
    getEmployeeTypes(client, companyId),
  ]);

  if (rawClaims.error || employee.error || rawClaims.data === null) {
    redirect(
      path.to.employeeAccounts,
      await flash(
        request,
        error(
          { rawClaims: rawClaims.error, employee: employee.error },
          "Failed to load employee"
        )
      )
    );
  }
  const claims = makeCompanyPermissionsFromClaims(
    rawClaims.data as Json[],
    companyId
  );

  if (claims === null) {
    redirect(
      path.to.employeeAccounts,
      await flash(request, error(null, "Failed to parse claims"))
    );
  }

  return json({
    permissions: claims?.permissions,
    employee: employee.data,
    employeeTypes: employeeTypes.data ?? [],
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "users",
  });

  const validation = await validator(employeeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, employeeType, data } = validation.data;
  const permissions = JSON.parse(data) as Record<string, CompanyPermission>;

  if (
    !Object.values(permissions).every(
      (permission) => userPermissionsValidator.safeParse(permission).success
    )
  ) {
    return json(
      {},
      await flash(request, error(permissions, "Failed to parse permissions"))
    );
  }

  const result = await updateEmployee(client, {
    id,
    employeeType,
    permissions,
    companyId,
  });

  throw redirect(path.to.employeeAccounts, await flash(request, result));
}

export default function UsersEmployeeRoute() {
  const { permissions, employee, employeeTypes } =
    useLoaderData<typeof loader>();

  const initialValues = {
    id: employee?.id || "",
    employeeType: employee?.employeeTypeId,
    permissions: permissions || {},
  };

  return (
    <EmployeePermissionsForm
      key={initialValues.id}
      name={employee?.name || ""}
      employeeTypes={employeeTypes}
      // @ts-ignore
      initialValues={initialValues}
    />
  );
}
