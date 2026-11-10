// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getCustomerTypes } from "~/modules/sales/sales.service";
import { CustomerAccountsTable } from "~/modules/users/ui";
import {
  getCustomers,
  getUnrevokedInviteEmails
} from "~/modules/users/users.service";
import type { Handle } from "~/utils/handle";
import { SINGLE_LOAD_LIMIT } from "~/utils/pagination";
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

  const { sorts, filters } = getGenericQueryFilters(searchParams);

  const [customers, customerTypes, invites] = await Promise.all([
    getCustomers(client, companyId, {
      search,
      // A single-load list: its default sort is on the joined user, which a
      // cursor cannot follow.
      limit: SINGLE_LOAD_LIMIT,
      offset: 0,
      sorts,
      filters
    }),
    getCustomerTypes(client, companyId),
    getUnrevokedInviteEmails(client, companyId)
  ]);

  if (customers.error) {
    throw redirect(
      path.to.users,
      await flash(request, error(customers.error, "Failed to fetch customers"))
    );
  }

  return {
    count: customers.count ?? 0,
    customers: customers.data ?? [],
    isTruncated: (customers.data?.length ?? 0) >= SINGLE_LOAD_LIMIT,
    customerTypes: customerTypes.data ?? [],
    unrevokedInviteEmails: invites.data?.map((i) => i.email) ?? []
  };
}

export default function UsersCustomersRoute() {
  const {
    count,
    customers,
    isTruncated,
    customerTypes,
    unrevokedInviteEmails
  } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomerAccountsTable
        data={customers}
        count={count}
        isTruncated={isTruncated}
        customerTypes={customerTypes}
        unrevokedInviteEmails={unrevokedInviteEmails}
      />
      <RecordOutlet />
    </VStack>
  );
}
