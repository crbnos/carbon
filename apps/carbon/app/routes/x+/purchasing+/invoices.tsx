import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  PurchaseInvoicesTable,
  getPurchaseInvoices,
} from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Invoices",
  to: path.to.purchaseInvoices,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [purchaseInvoices] = await Promise.all([
    getPurchaseInvoices(client, companyId, {
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters,
    }),
  ]);

  if (purchaseInvoices.error) {
    redirect(
      path.to.invoicing,
      await flash(
        request,
        error(purchaseInvoices.error, "Failed to fetch purchase invoices")
      )
    );
  }

  return json({
    count: purchaseInvoices.count ?? 0,
    purchaseInvoices: purchaseInvoices.data ?? [],
  });
}

export default function PurchaseInvoicesSearchRoute() {
  const { count, purchaseInvoices } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PurchaseInvoicesTable data={purchaseInvoices} count={count} />
      <Outlet />
    </VStack>
  );
}
