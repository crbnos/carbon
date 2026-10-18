// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Customer" }];
};

export const handle: Handle = {
  breadcrumb: msg`Sales`,
  to: path.to.sales,
  module: "sales"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "sales"
  });

  const [
    customerTypes,
    customerStatuses
    // shippingTerms,
  ] = await Promise.all([
    api.sales.getCustomerTypes({}),
    api.sales.getCustomerStatuses({})

    // getShippingTermsList(client, companyId),
  ]);

  return {
    customerStatuses: customerStatuses.data?.rows ?? [],
    customerTypes: customerTypes.data?.rows ?? []
    // shippingTerms: shippingTerms.data ?? [],
  };
}

export default function CustomerRoute() {
  return (
    <div className="flex h-full w-full justify-center bg-card">
      <VStack spacing={4} className="h-full p-4 w-full max-w-[80rem]">
        <RecordOutlet />
      </VStack>
    </div>
  );
}
