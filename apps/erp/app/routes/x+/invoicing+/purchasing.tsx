// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { PurchaseInvoicesTable } from "~/modules/invoicing/ui";
import type { Handle } from "~/utils/handle";
import { purchaseInvoicesList } from "~/utils/list-registry/invoicing.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["purchaseInvoice"],
  breadcrumb: msg`Purchasing Invoices`,
  to: path.to.invoicingPurchasing,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, purchaseInvoicesList, {
    dataKey: "purchaseInvoices",
    onError: {
      redirectTo: path.to.invoicing,
      message: "Failed to fetch purchase invoices"
    }
  });
}

export default function InvoicingPurchaseInvoicesRoute() {
  const { count, purchaseInvoices, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PurchaseInvoicesTable
        data={purchaseInvoices}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
