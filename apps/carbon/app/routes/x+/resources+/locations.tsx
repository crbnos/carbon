import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { LocationsTable, getLocations } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Locations",
  to: path.to.locations,
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

  const locations = await getLocations(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters,
  });

  if (locations.error) {
    throw redirect(
      path.to.resources,
      await flash(request, error(locations.error, "Failed to load locations"))
    );
  }

  return json({
    locations: locations.data ?? [],
    count: locations.count ?? 0,
  });
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
