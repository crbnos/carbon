import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { PurchaseOrdersTable, getPurchaseOrders } from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Orders",
  to: path.to.purchaseOrders,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [purchasOrders] = await Promise.all([
    getPurchaseOrders(client, companyId, {
      search,
      status,
      supplierId,
      limit,
      offset,
      sorts,
      filters,
    }),
  ]);

  if (purchasOrders.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(purchasOrders.error, "Failed to fetch purchase orders")
      )
    );
  }

  return json({
    count: purchasOrders.count ?? 0,
    purchasOrders: purchasOrders.data ?? [],
  });
}

export default function PurchaseOrdersSearchRoute() {
  const { count, purchasOrders } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PurchaseOrdersTable data={purchasOrders} count={count} />
      <Outlet />
    </VStack>
  );
}
