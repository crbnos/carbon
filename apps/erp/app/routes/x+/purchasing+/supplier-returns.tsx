// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { PurchaseReturnOrdersTable } from "~/modules/purchasing/ui/PurchaseReturnOrders";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["purchaseReturnOrder"],
  breadcrumb: msg`Supplier Returns`,
  to: path.to.purchaseReturnOrders
};

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "purchasing"
  });
  const api = carbonFor(auth);

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const purchaseReturnOrders = await api.purchasing.getPurchaseReturnOrders({
    search,
    status,
    supplierId,
    limit,
    offset,
    sorts,
    filters
  });

  if (purchaseReturnOrders.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(
          purchaseReturnOrders.error,
          "Failed to fetch purchase return orders"
        )
      )
    );
  }

  return {
    count: purchaseReturnOrders.data?.count ?? 0,
    purchaseReturnOrders: purchaseReturnOrders.data?.rows ?? []
  };
}

export default function PurchaseReturnOrdersSearchRoute() {
  const { count, purchaseReturnOrders } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PurchaseReturnOrdersTable data={purchaseReturnOrders} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
