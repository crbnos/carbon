// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { DimensionsTable } from "~/modules/accounting/ui/Dimensions";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Dimensions`,
  to: path.to.dimensions
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const page = await api.accounting.getDimensions({
    search,
    limit,
    offset,
    sorts,
    filters
  });
  return {
    data: page.data?.rows ?? null,
    count: page.data?.count ?? null,
    error: page.error
  };
}

export default function DimensionsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <DimensionsTable data={data ?? []} count={count ?? 0} />
      <RecordOutlet />
    </VStack>
  );
}
