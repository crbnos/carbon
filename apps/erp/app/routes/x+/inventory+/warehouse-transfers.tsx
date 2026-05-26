import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getWarehouseTransfers } from "~/modules/inventory/inventory.service.server";
import WarehouseTransfersTable from "~/modules/inventory/ui/WarehouseTransfers/WarehouseTransfersTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Warehouse Transfers`,
  to: path.to.warehouseTransfers
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const warehouseTransfers = await getWarehouseTransfers({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (warehouseTransfers.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(null, "Error loading warehouse transfers"))
    );
  }

  return {
    warehouseTransfers: warehouseTransfers.data ?? [],
    count: warehouseTransfers.count ?? 0
  };
}

export default function WarehouseTransfersRoute() {
  const { warehouseTransfers, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <WarehouseTransfersTable data={warehouseTransfers} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
