import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { SalesOrdersTable, getSalesOrders } from "~/modules/sales";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Orders",
  to: path.to.salesOrders,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const customerId = searchParams.get("customerId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [salesOrders] = await Promise.all([
    getSalesOrders(client, companyId, {
      search,
      status,
      customerId,
      limit,
      offset,
      sorts,
      filters,
    }),
  ]);

  if (salesOrders.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(salesOrders.error, "Failed to fetch sales orders")
      )
    );
  }

  return json({
    count: salesOrders.count ?? 0,
    salesOrders: salesOrders.data ?? [],
  });
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
