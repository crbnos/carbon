// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Alert,
  AlertDescription,
  AlertTitle,
  RecordOutlet,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { LuInfo } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getTaxCodesList } from "~/modules/accounting/accounting.service";
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
      const [customerStatuses, tags, taxCodes] = await Promise.all([
        getCustomerStatuses(client, companyId),
        getTagsList(client, companyId, "customer"),
        getTaxCodesList(client, companyId)
      ]);

      // Once the company has a tax code, count the customers still taxed by
      // the legacy bare percent: a percent above zero and no tax code.
      const customersWithoutTaxCode = taxCodes.data?.length
        ? ((
            await client
              .from("customer")
              .select("id, customerTax!inner(taxCodeId)", {
                count: "exact",
                head: true
              })
              .eq("companyId", companyId)
              .gt("taxPercent", 0)
              .is("customerTax.taxCodeId", null)
          ).count ?? 0)
        : 0;

      return {
        customerStatuses: customerStatuses.data ?? [],
        tags: tags.data ?? [],
        customersWithoutTaxCode
      };
    },
    onError: { redirectTo: path.to.sales, message: "Failed to fetch customers" }
  });
}

export default function SalesCustomersRoute() {
  const {
    count,
    customers,
    infinite,
    customerStatuses,
    tags,
    customersWithoutTaxCode
  } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      {customersWithoutTaxCode > 0 && (
        <div className="w-full p-4 pb-0">
          <Alert variant="info">
            <LuInfo className="h-4 w-4" />
            <AlertTitle>
              <Trans>Move to tax codes</Trans>
            </AlertTitle>
            <AlertDescription>
              <Plural
                value={customersWithoutTaxCode}
                one="# customer has a tax percent and no tax code. Select it and choose Assign Tax Code."
                other="# customers have a tax percent and no tax code. Select them and choose Assign Tax Code."
              />
            </AlertDescription>
          </Alert>
        </div>
      )}
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
