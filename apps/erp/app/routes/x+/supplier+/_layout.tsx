// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Supplier" }];
};

export const handle: Handle = {
  breadcrumb: msg`Purchasing`,
  to: path.to.purchasing,
  module: "purchasing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, { "purchasing.suppliers": "View" });

  const [
    supplierTypes
    // shippingTerms,
  ] = await Promise.all([
    api.purchasing.getSupplierTypes({}),
    api.inventory.getShippingTermsList({})
  ]);

  return {
    supplierTypes: supplierTypes.data?.rows ?? []
    // shippingTerms: shippingTerms.data ?? [],
  };
}

export default function SupplierRoute() {
  return (
    <div className="flex h-full w-full justify-center bg-card">
      <VStack spacing={4} className="h-full p-4 w-full max-w-[80rem]">
        <RecordOutlet />
      </VStack>
    </div>
  );
}
