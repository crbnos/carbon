import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getSalesReturnOrders } from "~/modules/sales";
import { SalesReturnOrdersTable } from "~/modules/sales/ui/SalesReturnOrders";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`RMAs`,
  to: path.to.salesReturnOrders
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const customerId = searchParams.get("customerId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const salesReturnOrders = await getSalesReturnOrders(client, companyId, {
    search,
    status,
    customerId,
    limit,
    offset,
    sorts,
    filters
  });

  if (salesReturnOrders.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(salesReturnOrders.error, "Failed to fetch sales return orders")
      )
    );
  }

  return {
    count: salesReturnOrders.count ?? 0,
    salesReturnOrders: salesReturnOrders.data ?? []
  };
}

export default function SalesReturnOrdersSearchRoute() {
  const { count, salesReturnOrders } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesReturnOrdersTable data={salesReturnOrders} count={count} />
      <Outlet />
    </VStack>
  );
}
