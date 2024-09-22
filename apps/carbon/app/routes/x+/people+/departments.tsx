import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { DepartmentsTable, getDepartments } from "~/modules/people";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Departments",
  to: path.to.departments,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const departments = await getDepartments(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters,
  });

  if (departments.error) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(departments.error, "Failed to load departments")
      )
    );
  }

  return json({
    departments: departments.data ?? [],
    count: departments.count ?? 0,
  });
}

export default function Route() {
  const { departments, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <DepartmentsTable data={departments} count={count} />
      <Outlet />
    </VStack>
  );
}
