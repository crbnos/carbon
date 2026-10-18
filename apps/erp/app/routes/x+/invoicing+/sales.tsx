// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import SalesInvoicesTable from "~/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["salesInvoice"],
  breadcrumb: msg`Sales Invoices`,
  to: path.to.invoicingSales,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "invoicing"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const customerId = searchParams.get("customerId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const salesInvoices = await api.invoicing.getSalesInvoices({
    search,
    customerId,
    limit,
    offset,
    sorts,
    filters
  });

  if (salesInvoices.error) {
    redirect(
      path.to.invoicing,
      await flash(
        request,
        error(salesInvoices.error, "Failed to fetch sales invoices")
      )
    );
  }

  return {
    count: salesInvoices.data?.count ?? 0,
    salesInvoices: salesInvoices.data?.rows ?? []
  };
}

export default function InvoicingSalesInvoicesRoute() {
  const { count, salesInvoices } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesInvoicesTable data={salesInvoices} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
