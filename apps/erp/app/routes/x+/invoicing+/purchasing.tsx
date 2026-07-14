import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getPurchaseInvoices,
  PurchaseInvoicesTable
} from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Purchasing Invoices`,
  to: path.to.invoicingPurchasing,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const purchaseInvoices = await getPurchaseInvoices(client, companyId, {
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
    count: purchaseInvoices.count ?? 0,
    purchaseInvoices: purchaseInvoices.data ?? []
  };
}

export default function InvoicingPurchaseInvoicesRoute() {
  const { count, purchaseInvoices } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PurchaseInvoicesTable data={purchaseInvoices} count={count} />
      <Outlet />
    </VStack>
  );
}
