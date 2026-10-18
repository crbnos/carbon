// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { CustomersTable } from "~/modules/sales/ui/Customers";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["customer"],
  breadcrumb: msg`Customers`,
  to: path.to.customers
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "sales",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [customers, customerStatuses, tags] = await Promise.all([
    api.sales.getCustomers({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.sales.getCustomerStatuses({}),
    api.shared.getTagsList({ table: "customer" })
  ]);

  if (customers.error) {
    redirect(
      path.to.sales,
      await flash(request, error(customers.error, "Failed to fetch customers"))
    );
  }

  return {
    count: customers.data?.count ?? 0,
    customers: customers.data?.rows ?? [],
    customerStatuses: customerStatuses.data?.rows ?? [],
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
      <RecordOutlet />
    </VStack>
  );
}
