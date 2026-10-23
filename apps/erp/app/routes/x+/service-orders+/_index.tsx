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
import { getServiceOrders } from "~/modules/service/service.service";
import { ServiceOrdersTable } from "~/modules/service/ui/ServiceOrders";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters, takeQueryFilter } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Service Orders`,
  to: path.to.serviceOrders
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });

  const searchParams = new URL(request.url).searchParams;
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);
  // A technician is on the order's visits, not on the order.
  const technician = takeQueryFilter(filters, "technicianId");

  const orders = await getServiceOrders(client, companyId, {
    search: searchParams.get("search"),
    technicianId: technician.values.length === 1 ? technician.values[0] : null,
    limit,
    offset,
    sorts,
    filters: technician.filters
  });

  if (orders.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(orders.error, "Failed to load service orders"))
    );
  }

  return {
    count: orders.count ?? 0,
    serviceOrders: orders.data ?? []
  };
}

export default function ServiceOrdersRoute() {
  const { count, serviceOrders } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ServiceOrdersTable data={serviceOrders} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
