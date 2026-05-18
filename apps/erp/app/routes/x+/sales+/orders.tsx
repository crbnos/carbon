import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getSalesOrders } from "~/modules/sales";
import { SalesOrdersTable } from "~/modules/sales/ui/SalesOrder";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Orders`,
  to: path.to.salesOrders
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const customerId = searchParams.get("customerId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const salesOrders = await getSalesOrders({
    search,
    status,
    customerId,
    limit,
    offset,
    sorts,
    filters
  });

  if (salesOrders.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(salesOrders.error, "Failed to fetch sales orders")
      )
    );
  }

  return {
    count: salesOrders.count ?? 0,
    salesOrders: salesOrders.data ?? []
  };
}

export default function SalesOrdersSearchRoute() {
  const { count, salesOrders } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesOrdersTable data={salesOrders} count={count} />
      <Outlet />
    </VStack>
  );
}
