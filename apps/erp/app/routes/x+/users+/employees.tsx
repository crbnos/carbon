import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  EmployeesTable,
  getEmployeeTypes,
  getEmployees,
} from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Employees",
  to: path.to.employeeAccounts,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee",
    bypassRls: true,
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [employees, employeeTypes] = await Promise.all([
    getEmployees(client, companyId, { search, limit, offset, sorts, filters }),
    getEmployeeTypes(client, companyId),
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

  return json({
    count: employees.count ?? 0,
    employees:
      employees.data?.filter((e) => !e.email?.includes("@carbon.ms")) ?? [],
    employeeTypes: employeeTypes.data,
  });
}

export default function UsersEmployeesRoute() {
  const { count, employees, employeeTypes } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <EmployeesTable
        data={employees}
        count={count}
        employeeTypes={employeeTypes}
      />
      <Outlet />
    </VStack>
  );
}
