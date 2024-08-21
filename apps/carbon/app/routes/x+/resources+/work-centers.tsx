import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { WorkCentersTable, getWorkCenters } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Work Centers",
  to: path.to.workCenters,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const workCenters = await getWorkCenters(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters,
  });

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
  });
}

export default function WorkCentersRoute() {
  const { count, workCenters } = useLoaderData<typeof loader>();
  console.log({ workCenters });

  return (
    <VStack spacing={0} className="h-full">
      <WorkCentersTable data={workCenters} count={count} />
      <Outlet />
    </VStack>
  );
}
