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
import { PurchaseInvoicesTable } from "~/modules/invoicing/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["purchaseInvoice"],
  breadcrumb: msg`Purchasing Invoices`,
  to: path.to.invoicingPurchasing,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    "invoicing.purchaseInvoices": "View"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const purchaseInvoices = await api.invoicing.getPurchaseInvoices({
    search,
    supplierId,
    limit,
    offset,
    sorts,
    filters
  });

  if (purchaseInvoices.error) {
    redirect(
      path.to.invoicing,
      await flash(
        request,
        error(purchaseInvoices.error, "Failed to fetch purchase invoices")
      )
    );
  }

  return {
    count: purchaseInvoices.data?.count ?? 0,
    purchaseInvoices: purchaseInvoices.data?.rows ?? []
  };
}

export default function InvoicingPurchaseInvoicesRoute() {
  const { count, purchaseInvoices } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PurchaseInvoicesTable data={purchaseInvoices} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
