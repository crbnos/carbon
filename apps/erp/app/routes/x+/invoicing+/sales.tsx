import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getSalesInvoices } from "~/modules/invoicing";
import SalesInvoicesTable from "~/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Sales Invoices`,
  to: path.to.invoicingSales,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const customerId = searchParams.get("customerId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const salesInvoices = await getSalesInvoices(client, companyId, {
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
    count: salesInvoices.count ?? 0,
    salesInvoices: salesInvoices.data ?? []
  };
}

export default function InvoicingSalesInvoicesRoute() {
  const { count, salesInvoices } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesInvoicesTable data={salesInvoices} count={count} />
      <Outlet />
    </VStack>
  );
}
