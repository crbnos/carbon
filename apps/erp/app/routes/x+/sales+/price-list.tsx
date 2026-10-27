// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import PriceListTable from "~/modules/sales/ui/Pricing/PriceOverridesTable";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { priceListList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Price List`,
  to: path.to.salesPriceList
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, priceListList, {
    dataKey: "data",
    firstPage: async ({ client, companyId, params }) => {
      const hasScope = Boolean(
        params.get("customerId") ||
          params.get("customerTypeId") ||
          params.get("scope") === "all"
      );
      const groupsResult = await client
        .from("group")
        .select("id, name, isCustomerOrgGroup, isCustomerTypeGroup")
        .eq("companyId", companyId)
        .or("isCustomerOrgGroup.eq.true,isCustomerTypeGroup.eq.true")
        .order("isCustomerTypeGroup", { ascending: false })
        .order("name");

      const scopeOptions = (groupsResult.data ?? [])
        .filter((g) => !g.id.startsWith("11111111-1111"))
        .map((g) => ({
          value: g.id,
          label: g.name,
          helper: (g.isCustomerTypeGroup ? "Type" : "Customer") as
            | "Type"
            | "Customer"
        }));

      return { scopeOptions, hasScope };
    }
  });
}

export default function PriceListRoute() {
  const { data, count, infinite, scopeOptions, hasScope } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PriceListTable
        data={data}
        count={count}
        infinite={infinite}
        scopeOptions={scopeOptions}
        hasScope={hasScope}
      />
      <RecordOutlet />
    </VStack>
  );
}
