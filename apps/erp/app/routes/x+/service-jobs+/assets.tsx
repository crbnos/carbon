// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { WarrantyStatus } from "~/modules/service/service.models";
import { warrantyStatuses } from "~/modules/service/service.models";
import { CustomerAssetsTable } from "~/modules/service/ui/CustomerAssets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters, takeQueryFilter } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Customer Assets`,
  to: path.to.customerAssets
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    "service.customerAssets": "View"
  });

  const searchParams = new URL(request.url).searchParams;
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);
  // The warranty status is computed from the two end dates on the company's
  // day, so it is not a column the generic filters can apply.
  const warranty = takeQueryFilter(filters, "warrantyStatus");
  const warrantyStatus =
    warranty.values.length === 1 &&
    (warrantyStatuses as readonly string[]).includes(warranty.values[0]!)
      ? (warranty.values[0] as WarrantyStatus)
      : null;

  // The service function reads the company's today for the warranty status.
  const assets = await api.service.getCustomerAssets({
    search,
    warrantyStatus,
    limit,
    offset,
    sorts,
    filters: warranty.filters
  });

  if (assets.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(assets.error, "Failed to load customer assets")
      )
    );
  }

  return {
    count: assets.data?.count ?? 0,
    assets: assets.data?.rows ?? []
  };
}

export default function CustomerAssetsRoute() {
  const { count, assets } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomerAssetsTable data={assets} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
