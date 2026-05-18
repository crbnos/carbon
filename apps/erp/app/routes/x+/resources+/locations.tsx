import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getLocations, LocationsTable } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Locations`,
  to: path.to.locations
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "resources",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const locations = await getLocations({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (locations.error) {
    throw redirect(
      path.to.resources,
      await flash(request, error(locations.error, "Failed to load locations"))
    );
  }

  return {
    locations: locations.data ?? [],
    count: locations.count ?? 0
  };
}

export default function LocationsRoute() {
  const { locations, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <LocationsTable data={locations} count={count} />
      <Outlet />
    </VStack>
  );
}
