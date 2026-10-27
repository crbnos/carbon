// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getCustomerStatuses } from "~/modules/sales/sales.service";
import { CustomersTable } from "~/modules/sales/ui/Customers";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { customersList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["customer"],
  breadcrumb: msg`Customers`,
  to: path.to.customers
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, customersList, {
    dataKey: "customers",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => {
      const [customerStatuses, tags] = await Promise.all([
        getCustomerStatuses(client, companyId),
        getTagsList(client, companyId, "customer")
      ]);
      return {
        customerStatuses: customerStatuses.data ?? [],
        tags: tags.data ?? []
      };
    },
    onError: { redirectTo: path.to.sales, message: "Failed to fetch customers" }
  });
}

export default function SalesCustomersRoute() {
  const { count, customers, infinite, customerStatuses, tags } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomersTable
        data={customers}
        count={count}
        infinite={infinite}
        customerStatuses={customerStatuses}
        tags={tags}
      />
      <RecordOutlet />
    </VStack>
  );
}
