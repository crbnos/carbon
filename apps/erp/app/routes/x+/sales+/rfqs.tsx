// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { isUnaffectedByNavigation, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getSalesRFQs } from "~/modules/sales";
import { SalesRFQsTable } from "~/modules/sales/ui/SalesRFQ";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["salesRfq"],
  breadcrumb: msg`RFQs`,
  to: path.to.salesRfqs
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { search: "all" })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const rfqs = await getSalesRFQs(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (rfqs.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(rfqs.error, "Failed to fetch RFQs"))
    );
  }

  return {
    count: rfqs.count ?? 0,
    rfqs: rfqs.data ?? []
  };
}

export default function RFQsRoute() {
  const { count, rfqs } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesRFQsTable data={rfqs} count={count} />
      <Outlet />
    </VStack>
  );
}
