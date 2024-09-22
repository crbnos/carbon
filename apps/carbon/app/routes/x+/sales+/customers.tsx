import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  CustomersTable,
  getCustomerStatuses,
  getCustomers,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Customers",
  to: path.to.customers,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [customers, customerStatuses] = await Promise.all([
    getCustomers(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getCustomerStatuses(client, companyId),
  ]);

  if (customers.error) {
    redirect(
      path.to.sales,
      await flash(request, error(customers.error, "Failed to fetch customers"))
    );
  }

  return json({
    count: customers.count ?? 0,
    customers: customers.data ?? [],
    customerStatuses: customerStatuses.data ?? [],
  });
}

export default function SalesCustomersRoute() {
  const { count, customers, customerStatuses } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomersTable
        data={customers}
        count={count}
        customerStatuses={customerStatuses}
      />
      <Outlet />
    </VStack>
  );
}
