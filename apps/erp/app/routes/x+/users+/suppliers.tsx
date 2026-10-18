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
import { SupplierAccountsTable } from "~/modules/users/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Suppliers`,
  to: path.to.supplierAccounts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "users",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [suppliers, supplierTypes, invites] = await Promise.all([
    api.users.getSuppliers({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.purchasing.getSupplierTypes({}),
    api.users.getUnrevokedInviteEmails({})
  ]);
  if (suppliers.error) {
    throw redirect(
      path.to.users,
      await flash(request, error(suppliers.error, "Error loading suppliers"))
    );
  }
  if (supplierTypes.error) {
    throw redirect(
      path.to.users,
      await flash(
        request,
        error(supplierTypes.error, "Error loading supplier types")
      )
    );
  }

  return {
    count: suppliers.data?.count ?? 0,
    suppliers: suppliers.data?.rows,
    supplierTypes: supplierTypes.data?.rows,
    unrevokedInviteEmails: invites.data?.map((i) => i.email) ?? []
  };
}

export default function UsersSuppliersRoute() {
  const { count, suppliers, supplierTypes, unrevokedInviteEmails } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SupplierAccountsTable
        data={suppliers}
        count={count}
        supplierTypes={supplierTypes}
        unrevokedInviteEmails={unrevokedInviteEmails}
      />
      <RecordOutlet />
    </VStack>
  );
}
