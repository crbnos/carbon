import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  EmployeesTable,
  getEmployees,
  getEmployeeTypes,
  getUnrevokedInviteEmails
} from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Employees`,
  to: path.to.employeeAccounts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [employees, employeeTypes, invites] = await Promise.all([
    getEmployees(client, companyId, { search, limit, offset, sorts, filters }),
    getEmployeeTypes(client, companyId),
    getUnrevokedInviteEmails(client, companyId)
  ]);

  if (employees.error) {
    throw redirect(
      path.to.users,
      await flash(request, error(employees.error, "Error loading employees"))
    );
  }
  if (employeeTypes.error) {
    throw redirect(
      path.to.users,
      await flash(
        request,
        error(employeeTypes.error, "Error loading employee types")
      )
    );
  }

  return {
    count: employees.count ?? 0,
    employees: employees.data ?? [],
    employeeTypes: employeeTypes.data,
    unrevokedInviteEmails: invites.data?.map((i) => i.email) ?? []
  };
}

export default function UsersEmployeesRoute() {
  const { count, employees, employeeTypes, unrevokedInviteEmails } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <EmployeesTable
        data={employees}
        count={count}
        employeeTypes={employeeTypes}
        unrevokedInviteEmails={unrevokedInviteEmails}
      />
      <Outlet />
    </VStack>
  );
}
