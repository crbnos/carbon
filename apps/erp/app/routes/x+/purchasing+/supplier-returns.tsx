import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getPurchaseReturnOrders } from "~/modules/purchasing";
import { PurchaseReturnOrdersTable } from "~/modules/purchasing/ui/PurchaseReturnOrders";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Supplier Returns`,
  to: path.to.purchaseReturnOrders
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const purchaseReturnOrders = await getPurchaseReturnOrders(
    client,
    companyId,
    {
      search,
      status,
      supplierId,
      limit,
      offset,
      sorts,
      filters
    }
  );

  if (purchaseReturnOrders.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(
          purchaseReturnOrders.error,
          "Failed to fetch purchase return orders"
        )
      )
    );
  }

  return {
    count: purchaseReturnOrders.count ?? 0,
    purchaseReturnOrders: purchaseReturnOrders.data ?? []
  };
}

export default function PurchaseReturnOrdersSearchRoute() {
  const { count, purchaseReturnOrders } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PurchaseReturnOrdersTable data={purchaseReturnOrders} count={count} />
      <Outlet />
    </VStack>
  );
}
