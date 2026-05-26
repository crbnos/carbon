import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { EmployeeTypesTable } from "~/modules/users";
import { getEmployeeTypes } from "~/modules/users/users.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Employee Types`,
  to: path.to.employeeTypes
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "users",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const employeeTypes = await getEmployeeTypes({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  return {
    data: employeeTypes.data ?? [],
    count: employeeTypes.count ?? 0
  };
}

export default function EmployeeTypesRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <EmployeeTypesTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
