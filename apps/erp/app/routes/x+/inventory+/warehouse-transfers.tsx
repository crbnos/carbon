// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getWarehouseTransfers } from "~/modules/inventory";
import WarehouseTransfersTable from "~/modules/inventory/ui/WarehouseTransfers/WarehouseTransfersTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["warehouseTransfer"],
  breadcrumb: msg`Warehouse Transfers`,
  to: path.to.warehouseTransfers
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

  const warehouseTransfers = await getWarehouseTransfers(client, companyId, {
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
