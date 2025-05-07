import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { SalesInvoicesTable, getSalesInvoices } from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Invoices",
  to: path.to.salesInvoices,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const customerId = searchParams.get("customerId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [salesInvoices] = await Promise.all([
    getSalesInvoices(client, companyId, {
      search,
      customerId,
      limit,
      offset,
      sorts,
      filters,
    }),
  ]);

  if (salesInvoices.error) {
    redirect(
      path.to.invoicing,
      await flash(
        request,
        error(salesInvoices.error, "Failed to fetch sales invoices")
      )
    );
  }

  return json({
    count: salesInvoices.count ?? 0,
    salesInvoices: salesInvoices.data ?? [],
  });
}

export default function PurchaseInvoicesSearchRoute() {
  const { count, salesInvoices } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesInvoicesTable data={salesInvoices} count={count} />
      <Outlet />
    </VStack>
  );
}
