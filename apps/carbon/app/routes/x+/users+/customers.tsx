import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getCustomerTypes } from "~/modules/sales";
import { CustomerAccountsTable, getCustomers } from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Customers",
  to: path.to.customerAccounts,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [customers, customerTypes] = await Promise.all([
    getCustomers(client, companyId, { search, limit, offset, sorts, filters }),
    getCustomerTypes(client, companyId),
  ]);

  if (customers.error) {
    redirect(
      path.to.users,
      await flash(request, error(customers.error, "Failed to fetch customers"))
    );
  }

  return json({
    count: customers.count ?? 0,
    customers: customers.data ?? [],
    customerTypes: customerTypes.data ?? [],
  });
}

export default function UsersCustomersRoute() {
  const { count, customers, customerTypes } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomerAccountsTable
        data={customers}
        count={count}
        customerTypes={customerTypes}
      />
      <Outlet />
    </VStack>
  );
}
