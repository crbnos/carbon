import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import type { CompanyPermission } from "~/modules/users";
import {
  EmployeePermissionsForm,
  employeeValidator,
  getEmployee,
  getEmployeeTypes,
  getPermissionsByEmployeeType,
  userPermissionsValidator
} from "~/modules/users";
import {
  getClaims,
  makeCompanyPermissionsFromClaims,
  makeCompanyPermissionsFromEmployeeType,
  updateEmployee
} from "~/modules/users/users.server";
import { path } from "~/utils/path";
import { getCompanyId, invalidateUserSelectQueries } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee"
  });

  const { employeeId } = params;
  if (!employeeId) throw notFound("employeeId not found");

  const client = getCarbonServiceRole();
  const [rawClaims, employee, employeeTypes] = await Promise.all([
    getClaims(client, employeeId, companyId),
    getEmployee(client, employeeId, companyId),
    getEmployeeTypes(client, companyId)
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

  const types = employeeTypes.data ?? [];
  const permissionsByType = await Promise.all(
    types.map((t) => getPermissionsByEmployeeType(client, t.id))
  );
  const employeeTypePermissions: Record<
    string,
    Record<string, CompanyPermission>
  > = {};
  types.forEach((t, i) => {
    const result = permissionsByType[i];
    const raw = makeCompanyPermissionsFromEmployeeType(
      result.data ?? [],
      companyId
    );
    const perms: Record<string, CompanyPermission> = {};
    for (const [mod, entry] of Object.entries(raw)) {
      perms[mod.toLowerCase()] = entry.permission;
    }
    employeeTypePermissions[t.id] = perms;
  });

  return {
    permissions: claims?.permissions,
    employee: employee.data,
    employeeTypes: types,
    employeeTypePermissions
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  const validation = await validator(employeeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, employeeType, data: permissionData } = validation.data;
  const permissions = JSON.parse(permissionData) as Record<
    string,
    CompanyPermission
  >;

  if (
    !Object.values(permissions).every(
      (permission) => userPermissionsValidator.safeParse(permission).success
    )
  ) {
    return data(
      {},
      await flash(request, error(permissions, "Failed to parse permissions"))
    );
  }

  const result = await updateEmployee(client, {
    id,
    employeeType,
    permissions,
    companyId
  });

  throw redirect(path.to.employeeAccounts, await flash(request, result));
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateUserSelectQueries(getCompanyId());
  return await serverAction();
}

export default function UsersEmployeeRoute() {
  const { permissions, employee, employeeTypes, employeeTypePermissions } =
    useLoaderData<typeof loader>();

  const initialValues = {
    id: employee?.id || "",
    employeeType: employee?.employeeTypeId,
    permissions: permissions || {}
  };

  return (
    <EmployeePermissionsForm
      key={initialValues.id}
      name={employee?.name || ""}
      employeeTypes={employeeTypes}
      employeeTypePermissions={employeeTypePermissions}
      // @ts-expect-error
      initialValues={initialValues}
    />
  );
}
