// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import SalesInvoicesTable from "~/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable";
import type { Handle } from "~/utils/handle";
import { salesInvoicesList } from "~/utils/list-registry/invoicing.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["salesInvoice"],
  breadcrumb: msg`Sales Invoices`,
  to: path.to.invoicingSales,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, salesInvoicesList, {
    dataKey: "salesInvoices",
    onError: {
      redirectTo: path.to.invoicing,
      message: "Failed to fetch sales invoices"
    }
  });
}

export default function InvoicingSalesInvoicesRoute() {
  const { count, salesInvoices, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesInvoicesTable
        data={salesInvoices}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
