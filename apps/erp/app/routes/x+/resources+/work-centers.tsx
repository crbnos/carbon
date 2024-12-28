import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  WorkCentersTable,
  getLocationsList,
  getWorkCenters,
} from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Work Centers",
  to: path.to.workCenters,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
    bypassRls: true,
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [workCenters, locations] = await Promise.all([
    getWorkCenters(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getLocationsList(client, companyId),
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

  return json({
    count: workCenters.count ?? 0,
    workCenters: workCenters.data ?? [],
    locations: locations.data ?? [],
  });
}

export default function WorkCentersRoute() {
  const { count, locations, workCenters } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <WorkCentersTable
        data={workCenters}
        count={count}
        locations={locations}
      />
      <Outlet />
    </VStack>
  );
}
