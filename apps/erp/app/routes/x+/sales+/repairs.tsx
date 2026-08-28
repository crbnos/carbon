import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getRepairOrders } from "~/modules/sales";
import { RepairOrdersTable } from "~/modules/sales/ui/Repairs";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Repairs`,
  to: path.to.repairOrders
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
  const supplierId = searchParams.get("supplierId");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return await getRepairOrders(client, companyId, {
    search,
    status,
    customerId,
    supplierId,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function RepairOrdersRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <RepairOrdersTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
