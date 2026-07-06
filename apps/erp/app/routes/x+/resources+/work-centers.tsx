import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getDepartmentsList } from "~/modules/people";
import {
  getLocationsList,
  getWorkCenters,
  WorkCentersTable
} from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Work Centers`,
  to: path.to.workCenters
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [workCenters, departments, locations] = await Promise.all([
    getWorkCenters(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getDepartmentsList(client, companyId),
    getLocationsList(client, companyId)
  ]);

  if (workCenters.error) {
    redirect(
      path.to.resources,
      await flash(
        request,
        error(workCenters.error, "Failed to fetch work centers")
      )
    );
  }

  return {
    count: workCenters.count ?? 0,
    departments: departments.data ?? [],
    workCenters: workCenters.data ?? [],
    locations: locations.data ?? []
  };
}

export default function WorkCentersRoute() {
  const { count, departments, locations, workCenters } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <WorkCentersTable
        data={workCenters}
        count={count}
        departments={departments}
        locations={locations}
      />
      <Outlet />
    </VStack>
  );
}
