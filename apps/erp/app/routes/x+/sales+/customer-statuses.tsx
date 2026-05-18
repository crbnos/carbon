import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getCustomerStatuses } from "~/modules/sales";
import { CustomerStatusesTable } from "~/modules/sales/ui/CustomerStatuses";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Customer Statuses`,
  to: path.to.customerStatuses
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return await getCustomerStatuses({
    search,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function CustomerStatusesRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomerStatusesTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
