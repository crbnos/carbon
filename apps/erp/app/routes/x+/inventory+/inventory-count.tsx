import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getInventoryCounts, InventoryCountsTable } from "~/modules/inventory";
import { getLocationsList } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Inventory Count`,
  to: path.to.inventoryCounts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [inventoryCounts, locations] = await Promise.all([
    getInventoryCounts(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getLocationsList(client, companyId)
  ]);

  if (inventoryCounts.error) {
    throw redirect(
      path.to.inventory,
      await flash(
        request,
        error(inventoryCounts.error, "Error loading inventory count")
      )
    );
  }

  return {
    inventoryCounts: inventoryCounts.data ?? [],
    count: inventoryCounts.count ?? 0,
    locations: locations.data ?? []
  };
}

export default function InventoryCountRoute() {
  const { inventoryCounts, count, locations } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <InventoryCountsTable
        data={inventoryCounts}
        count={count ?? 0}
        locations={locations}
      />
      <Outlet />
    </VStack>
  );
}
