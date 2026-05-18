import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getCustomerStatuses, getCustomers } from "~/modules/sales";
import { CustomersTable } from "~/modules/sales/ui/Customers";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Customers`,
  to: path.to.customers
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [customers, customerStatuses, tags] = await Promise.all([
    getCustomers({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getCustomerStatuses(),
    getTagsList("customer")
  ]);

  if (customers.error) {
    redirect(
      path.to.sales,
      await flash(request, error(customers.error, "Failed to fetch customers"))
    );
  }

  return {
    count: customers.count ?? 0,
    customers: customers.data ?? [],
    customerStatuses: customerStatuses.data ?? [],
    tags: tags.data ?? []
  };
}

export default function SalesCustomersRoute() {
  const { count, customers, customerStatuses, tags } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomersTable
        data={customers}
        count={count}
        customerStatuses={customerStatuses}
        tags={tags}
      />
      <Outlet />
    </VStack>
  );
}
