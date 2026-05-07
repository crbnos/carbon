import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getCustomerTypes } from "~/modules/sales";
import {
  CustomerAccountsTable,
  getCustomers,
  getUnrevokedInviteEmails
} from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Customers`,
  to: path.to.customerAccounts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [customers, customerTypes, invites] = await Promise.all([
    getCustomers(client, companyId, { search, limit, offset, sorts, filters }),
    getCustomerTypes(client, companyId),
    getUnrevokedInviteEmails(client, companyId)
  ]);

  if (customers.error) {
    redirect(
      path.to.users,
      await flash(request, error(customers.error, "Failed to fetch customers"))
    );
  }

  return {
    count: customers.count ?? 0,
    customers: customers.data ?? [],
    customerTypes: customerTypes.data ?? [],
    unrevokedInviteEmails: invites.data?.map((i) => i.email) ?? []
  };
}

export default function UsersCustomersRoute() {
  const { count, customers, customerTypes, unrevokedInviteEmails } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomerAccountsTable
        data={customers}
        count={count}
        customerTypes={customerTypes}
        unrevokedInviteEmails={unrevokedInviteEmails}
      />
      <Outlet />
    </VStack>
  );
}
